import type {
  BranchKey,
  ThinkingBranchCard as HotDataItem,
} from "@ontomato/contracts/query-thinking";
import { getApiConfig, buildHeaders, buildUrl } from "../../../config/data-query-api";
import { createLogger } from "../../../logging/logger";
import { backendPost } from "../../../utils/backend-client";
import { extractBackendLocation, streamBackendSSE } from "../sse-transport";
import { t, tApp } from "../../../i18n";

const logger = createLogger("hot-data-utils");

export function stripAnalysisTags(text: string): string {
  return text
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
}

export function extractFirstJSONObject<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

export interface HotCard {
  atomicAsk: string;
  url: string;
}

export interface HotJudgeResult {
  sufficient: boolean;
  cards: HotCard[];
}

const HOT_JUDGE_REPLY_PREVIEW_LENGTH = 200;

function hotJudgeProtocolError(key: string, raw: string): Error {
  return new Error(t(key, { preview: raw.slice(0, HOT_JUDGE_REPLY_PREVIEW_LENGTH) }));
}

/**
 * The static and dynamic judgment prompts agree on one output shape. Only isAnswerable=false is a legitimate insufficiency;
 * empty replies, unparseable JSON, a non-boolean isAnswerable, or answerable without valid cards are protocol violations.
 */
export function interpretHotJudgeReply(content: unknown): HotJudgeResult {
  const raw = String(content ?? "").trim();
  const cleaned = stripAnalysisTags(raw).trim();
  if (!cleaned) {
    throw hotJudgeProtocolError("query.error.hotJudgeEmptyReply", raw);
  }

  const obj = extractFirstJSONObject<{
    isAnswerable?: boolean;
    usedCards?: { atomicAsk?: string; url?: string }[];
  }>(cleaned);
  if (!obj) {
    throw hotJudgeProtocolError("query.error.hotJudgeNotJson", raw);
  }
  if (typeof obj.isAnswerable !== "boolean") {
    throw hotJudgeProtocolError("query.error.hotJudgeAnswerableNotBoolean", raw);
  }
  if (!obj.isAnswerable) {
    return { sufficient: false, cards: [] };
  }

  const rawCards = Array.isArray(obj.usedCards) ? obj.usedCards : [];
  const cards: HotCard[] = [];
  for (const card of rawCards) {
    const atomicAsk = String(card?.atomicAsk ?? "").trim();
    const url = String(card?.url ?? "").trim();
    if (!atomicAsk || !url) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    cards.push({ atomicAsk, url });
  }
  if (cards.length === 0) {
    throw hotJudgeProtocolError("query.error.hotJudgeNoValidCards", raw);
  }
  return { sufficient: true, cards };
}

export const BRANCH_CN: Record<BranchKey, string> = {
  static: t("query.branch.static"),
  hot: t("query.branch.hot"),
  abc: t("query.branch.abc"),
};

/** Failure shape shared by the MetricView synchronous response body, result frames, and hot-card snapshots. */
export function assertMetricViewSuccess(json: unknown): void {
  if (!json || typeof json !== "object" || Array.isArray(json)) return;
  const record = json as Record<string, unknown>;
  if (record.success !== false) return;
  const message = typeof record.message === "string" ? record.message.trim() : "";
  throw new Error(message || t("query.error.backendFailedWithoutReason"));
}

/**
 * Parses a MetricView response body (the synchronous body and the result frames of the dynamic hot-data stream share one shape) into hot data items.
 * Shared by both the synchronous and streaming callers: compatibility with the three backend body forms (data / result / top-level array) and
 * the md + http(s) url filter are one rule; if either copy drifts the other silently drops cards.
 */
export function parseMetricViewItems(json: unknown): HotDataItem[] {
  assertMetricViewSuccess(json);
  const record = json as Record<string, unknown> | null;
  const arr = Array.isArray(record?.data)
    ? record.data
    : Array.isArray(record?.result)
      ? record.result
      : Array.isArray(json)
        ? json
        : [];
  const result: HotDataItem[] = [];
  for (const x of arr) {
    if (typeof x === "object" && x !== null) {
      const item = x as Record<string, unknown>;
      const md = typeof item.md === "string" ? item.md.trim() : "";
      const url = typeof item.url === "string" ? item.url.trim() : "";
      if (!md || !/^https?:\/\//i.test(url)) continue;
      const hotItem: HotDataItem = {
        md,
        url,
      };
      if (item.originQuestion !== undefined)
        hotItem.originQuestion = String(item.originQuestion || "");
      if (item.originSubQuery !== undefined) hotItem.originSubQuery = item.originSubQuery;
      if (item.originCheckResult !== undefined) hotItem.originCheckResult = item.originCheckResult;
      if (Array.isArray(item.parameterInstanceDesc))
        hotItem.parameterInstanceDesc = item.parameterInstanceDesc as string[];
      result.push(hotItem);
    }
  }
  return result;
}

export async function findDocuments(params: {
  endpoint: string;
  question: string;
  token?: string;
  userId?: string;
  locale?: string;
  signal?: AbortSignal;
  apiKey?: string;
}): Promise<HotDataItem[]> {
  const config = getApiConfig();
  const url = buildUrl(config, params.endpoint);

  logger.debug(tApp("queryFixed.256", { v0: (url), v1: (params.question.slice(0, 50)) }));

  const response = await backendPost(
    params.endpoint,
    url,
    { question: params.question },
    {
      token: params.token,
      userId: params.userId,
      locale: params.locale,
      signal: params.signal,
      apiKey: params.apiKey,
    }
  );

  let json: unknown;
  try {
    json = JSON.parse(response.text);
  } catch {
    throw new Error(t("query.error.responseNotJson"));
  }
  const result = parseMetricViewItems(json);
  logger.debug(t("query.hotData.foundCount", { count: result.length }));
  return result;
}

export interface StreamDocumentsResult {
  items: HotDataItem[];
  sessionId?: string;
  backendNodeId?: string;
}

/**
 * Reads dynamic hot data as a stream (/metricView/generateGeneralContent): the first frame reports {sessionId, nodeId}
 * and the last frame is the response body of the original synchronous endpoint. Result frames are handled exactly like the synchronous body.
 */
export async function streamDocuments(params: {
  endpoint: string;
  question: string;
  token?: string;
  userId?: string;
  locale?: string;
  signal?: AbortSignal;
  apiKey?: string;
  /** Reports the session location as soon as the first frame arrives, without waiting for the stream to end (backend session locating and cancellation · design 3, 6) */
  onBackendLocation: (location: { sessionId: string; backendNodeId?: string }) => void;
}): Promise<StreamDocumentsResult> {
  const config = getApiConfig();
  const url = buildUrl(config, params.endpoint);

  logger.debug(tApp("queryFixed.257", { v0: (url), v1: (params.question.slice(0, 50)) }));

  const stream = streamBackendSSE(params.endpoint, url, {
    method: "POST",
    headers: buildHeaders(config, params.token, params.userId, params.locale, params.apiKey),
    body: JSON.stringify({ question: params.question }),
    signal: params.signal,
  });

  let sessionId: string | undefined;
  let backendNodeId: string | undefined;
  let resultFrame: unknown;
  for await (const event of stream) {
    const location = extractBackendLocation(event);
    if (location?.sessionId) {
      sessionId = location.sessionId;
      if (location.backendNodeId !== undefined) backendNodeId = location.backendNodeId;
      params.onBackendLocation({ sessionId, backendNodeId });
    }
    if (typeof (event as { success?: unknown }).success === "boolean") {
      resultFrame = event;
    }
  }

  // By convention the last frame must be a result frame: a stream that ends normally without one is a protocol error.
  // Returning an empty list would mask the failure as "no hit", so it must throw.
  if (resultFrame === undefined) {
    throw new Error(tApp("queryFixed.258"));
  }

  const items = parseMetricViewItems(resultFrame);
  logger.debug(t("query.hotData.foundCount", { count: items.length }));
  return { items, sessionId, backendNodeId };
}

export async function findKnowledge(params: {
  question: string;
  token?: string;
  userId?: string;
  locale?: string;
  signal?: AbortSignal;
  apiKey?: string;
}): Promise<string> {
  const config = getApiConfig();
  const url = buildUrl(config, config.endpoints.findKnowledge);

  const response = await backendPost(
    config.endpoints.findKnowledge,
    url,
    { question: params.question },
    {
      token: params.token,
      userId: params.userId,
      locale: params.locale,
      signal: params.signal,
      apiKey: params.apiKey,
    }
  );

  const raw = response.text?.trim() || "";
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed.trim() : raw;
  } catch {
    return raw;
  }
}

/**
 * Filters out usable hot data cards
 * A valid hot data item needs non-empty md content and a legal url
 */
export function normalizeHotDocs(items: HotDataItem[]): HotDataItem[] {
  return items.filter((item) => {
    if (!item.md || item.md.trim() === "") return false;
    if (!/^https?:\/\//i.test(item.url)) return false;
    return true;
  });
}

/**
 * Counts hit entries (tallied from the hot data payload)
 */
export function calcHitCountFromPayload(items: HotDataItem[]): number {
  return items.length;
}

/**
 * Formats direct-answer details (for thinking buffer display)
 */
export function formatDirectAnswerDetail(params: {
  branch: BranchKey;
  docs: HotDataItem[];
  cardsCount: number;
  sufficient: boolean;
}): string {
  const { docs, cardsCount, sufficient } = params;
  if (!sufficient) {
    if (docs.length === 0) return t("query.hotData.noAvailableHotData");
    return t("query.hotData.insufficientCoverage", { docs: docs.length, cards: cardsCount });
  }
  return t("query.hotData.sufficientCoverage", { docs: docs.length, cards: cardsCount });
}
