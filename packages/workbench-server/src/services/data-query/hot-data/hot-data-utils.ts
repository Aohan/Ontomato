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
 * 静态与动态判定提示词约定同一输出形状。只有 isAnswerable=false 是合法不足；
 * 空回复、解析不出 JSON、isAnswerable 不是布尔、可回答却没有有效卡片都是协议违约。
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

/** MetricView 同步返回体、结果帧和热卡片快照共用的失败形状。 */
export function assertMetricViewSuccess(json: unknown): void {
  if (!json || typeof json !== "object" || Array.isArray(json)) return;
  const record = json as Record<string, unknown>;
  if (record.success !== false) return;
  const message = typeof record.message === "string" ? record.message.trim() : "";
  throw new Error(message || t("query.error.backendFailedWithoutReason"));
}

/**
 * 解析 MetricView 返回体（同步返回体与动态热数据流的结果帧同形）为热数据项。
 * 同步与流式两处调用方共用：后端返回体三形态（data / result / 顶层数组）兼容与
 * md + http(s) url 过滤是同一规则，一处漂移另一处会静默丢卡。
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
 * 按流读取动态热数据（/metricView/generateGeneralContent）：首帧 {sessionId, nodeId}
 * 报号，最后一帧是原同步接口的返回体。对结果帧的处理与同步返回体一致。
 */
export async function streamDocuments(params: {
  endpoint: string;
  question: string;
  token?: string;
  userId?: string;
  locale?: string;
  signal?: AbortSignal;
  apiKey?: string;
  /** 首帧会话位置一到就上报，不等流结束（问数后端会话的定位与取消·设计 3、6） */
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

  // 按约定最后一帧必须是结果帧：流正常结束却没收到结果帧是协议错误，
  // 返回空列表会被当成"没命中"掩盖故障，必须抛错。
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
 * 过滤出可用的热数据卡片
 * 有效的热数据项需要包含非空 md 内容和合法的 url
 */
export function normalizeHotDocs(items: HotDataItem[]): HotDataItem[] {
  return items.filter((item) => {
    if (!item.md || item.md.trim() === "") return false;
    if (!/^https?:\/\//i.test(item.url)) return false;
    return true;
  });
}

/**
 * 计算命中条数（从热数据 payload 中统计）
 */
export function calcHitCountFromPayload(items: HotDataItem[]): number {
  return items.length;
}

/**
 * 格式化直接回答详情（用于 thinking buffer 展示）
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
