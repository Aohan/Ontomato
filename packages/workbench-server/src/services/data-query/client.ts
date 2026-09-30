import { getApiConfig, buildHeaders, buildUrl } from "../../config/data-query-api";
import type { ApiConfig } from "../../config/data-query-api";
import { environment } from "../../config/environment";
import { createLogger } from "../../logging/logger";
import { getCircuitStatus, BackendUnavailableError } from "../../utils/backend-client";
import { t, tApp } from "../../i18n";
import { parseQueryAnswerPayloads, type QueryAnswerPayload } from "./protocol";
import { extractBackendLocation, streamBackendSSE } from "./sse-transport";

const logger = createLogger("data-query");

export interface SubQuestion {
  subQuestion: string;
  classes?: string[];
  subgraph?: unknown;
}

interface DataChunkBase {
  dsl?: {
    problem?: string;
    [key: string]: unknown;
  };
  thinking?: string;
  schemaDefs?: unknown[];
  classAttrs?: unknown;
  outputKeyDescriptionMDTable?: string;
  code?: string;
  afterCalculatorConsanguinityList?: unknown[];
  source?: "stream" | "final";
  finalIndex?: number;
}

export type DataChunk =
  | (DataChunkBase & {
      data: QueryAnswerPayload[];
      error?: never;
    })
  | (DataChunkBase & {
      error: string;
      data?: never;
    });

export interface StreamOptions {
  signal?: AbortSignal;
  onThinking?: (text: string) => void;
  onProgress?: (message: string, stage?: string) => void;
  onData?: (chunk: DataChunk, index: number) => void;
  token?: string;
  userId?: string;
  locale?: string;
  apiKey?: string;
  isV0?: boolean;
  classNames?: string[];
}

function extractCodeFromDataValue(data: unknown): string | undefined {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    if (typeof record.code === "string" && record.code) return record.code;
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      const code = extractCodeFromDataValue(item);
      if (code) return code;
    }
  }

  return undefined;
}

function extractCodeFromEvent(event: any): string | undefined {
  if (event.data && typeof event.data === "object" && !Array.isArray(event.data)) {
    if (typeof event.data.code === "string" && event.data.code) return event.data.code;
  }
  const dataCode = extractCodeFromDataValue(event.data);
  if (dataCode) return dataCode;
  if (typeof event.code === "string" && event.code) return event.code;
  return undefined;
}

function hasNonErrorDataChunkPayload(event: any): boolean {
  return !!(
    event &&
    typeof event === "object" &&
    !Array.isArray(event) &&
    (event.dsl !== undefined ||
      event.data !== undefined ||
      event.schemaDefs !== undefined ||
      event.code !== undefined ||
      event.afterCalculatorConsanguinityList !== undefined)
  );
}

function hasDataChunkPayload(event: any): boolean {
  return hasNonErrorDataChunkPayload(event) || event?.error !== undefined;
}

function buildDataChunkFromEvent(
  event: any,
  source: "stream" | "final",
  finalIndex?: number
): DataChunk | null {
  if (!hasDataChunkPayload(event)) return null;

  const error =
    typeof event.error === "string" && event.error.trim() ? event.error.trim() : undefined;
  if (event.error !== undefined && !error) {
    throw new Error(tApp("queryFixed.215"));
  }

  const common: DataChunkBase = {
    dsl: event.dsl,
    thinking: event.thinking,
    schemaDefs: event.schemaDefs,
    classAttrs: event.classAttrs,
    outputKeyDescriptionMDTable: event.outputKeyDescriptionMDTable,
    code: extractCodeFromEvent(event),
    afterCalculatorConsanguinityList: event.afterCalculatorConsanguinityList,
    source,
    finalIndex,
  };

  if (error) {
    return { ...common, error };
  }

  if (event.data === undefined) {
    throw new Error(tApp("queryFixed.216"));
  }

  return {
    ...common,
    data: parseQueryAnswerPayloads(event.data, tApp("queryFixed.217")),
  };
}

export async function* streamQuestionSplit(
  question: string,
  options?: StreamOptions
): AsyncGenerator<{
  subQuestion?: SubQuestion;
  sessionId?: string;
  backendNodeId?: string;
  subQueries?: SubQuestion[];
}> {
  const apiConfig = getApiConfig();
  if (!apiConfig.baseUrl) {
    throw new Error("API baseUrl is not configured");
  }

  const endpoint = apiConfig.endpoints.split;
  const { isOpen } = getCircuitStatus(endpoint);
  if (isOpen) {
    throw new BackendUnavailableError(endpoint);
  }

  const url = buildUrl(apiConfig, apiConfig.endpoints.split);
  const headers = buildHeaders(
    apiConfig,
    options?.token,
    options?.userId,
    options?.locale,
    options?.apiKey
  );

  logger.debug("[Split API stream] URL:", url);
  logger.debug("[Split API stream] Token:", options?.token ? "provided" : "not provided");

  options?.onProgress?.(t("query.progress.splitting"), "split");

  const stream = streamBackendSSE(endpoint, url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      question,
      isV0: options?.isV0 ?? false,
      ...(options?.classNames?.length ? { classNames: options.classNames } : {}),
    }),
    signal: options?.signal,
  });

  const allSubQuestions: SubQuestion[] = [];
  let sessionId: string | undefined;
  let backendNodeId: string | undefined;
  let hasReceivedBatch = false;
  let locationReported = false;

  for await (const ev of stream) {
    if (options?.signal?.aborted) break;

    const event = ev as any;

    if (environment.level() === "debug") {
      logger.debug("[Split API] Received event:", JSON.stringify(event).slice(0, 500));
    }

    if (event.error) {
      throw new Error(event.error);
    }

    // Report on the first frame: the first frame of the backend's new-session stream is {sessionId, nodeId};
    // hand it over on receipt so the caller (the abc branch) can report the location immediately without waiting for the split result. The first frame is handed over only once.
    const location = extractBackendLocation(event);
    if (!locationReported && location?.sessionId) {
      sessionId = location.sessionId;
      backendNodeId = location.backendNodeId;
      locationReported = true;
      yield { sessionId, backendNodeId };
    }

    if (event.subQueries && Array.isArray(event.subQueries)) {
      for (const sq of event.subQueries) {
        const questionText = sq.subQuestion || sq.query || sq.question;
        if (questionText) {
          const subQ: SubQuestion = {
            subQuestion: questionText,
            classes: sq.classes,
            subgraph: sq.subgraph || sq.showSubGraph,
          };
          if (!allSubQuestions.some((existing) => existing.subQuestion === subQ.subQuestion)) {
            allSubQuestions.push(subQ);
            yield { subQuestion: subQ };
          }
        }
      }
      yield { sessionId, backendNodeId, subQueries: allSubQuestions };
      break;
    }

    if (event.subQuestion && !hasReceivedBatch) {
      const subQ: SubQuestion = {
        subQuestion: event.subQuestion,
        classes: event.classes,
        subgraph: event.subgraph || event.showSubGraph,
      };
      if (!allSubQuestions.some((existing) => existing.subQuestion === subQ.subQuestion)) {
        allSubQuestions.push(subQ);
        yield { subQuestion: subQ };
      }
    }
  }

  // "Throw when no session number was obtained" is guaranteed only here: it throws when the stream ends without one, so callers stop re-checking.
  if (!sessionId) {
    throw new Error(tApp("queryFixed.218"));
  }

  if (allSubQuestions.length === 0) {
    logger.warn(tApp("queryFixed.219"), { sessionId });
    const fallbackSubQuestion: SubQuestion = { subQuestion: question };
    allSubQuestions.push(fallbackSubQuestion);
    yield { subQuestion: fallbackSubQuestion };
  }

  options?.onProgress?.(t("query.progress.splitDone", { n: allSubQuestions.length }), "split_done");

  // If the summary information has not been yielded yet, yield it now
  if (allSubQuestions.length > 0) {
    yield { sessionId, backendNodeId, subQueries: allSubQuestions };
  }
}

export async function* streamDataChunks(
  sessionId: string,
  options?: StreamOptions & { config?: ApiConfig }
): AsyncGenerator<DataChunk> {
  const apiConfig = options?.config || getApiConfig();
  if (!apiConfig.baseUrl) {
    throw new Error("API baseUrl is not configured");
  }

  const endpoint = apiConfig.endpoints.stream;
  const { isOpen } = getCircuitStatus(endpoint);
  if (isOpen) {
    throw new BackendUnavailableError(endpoint);
  }

  const url = buildUrl(apiConfig, apiConfig.endpoints.stream);
  const headers = buildHeaders(
    apiConfig,
    options?.token,
    options?.userId,
    options?.locale,
    options?.apiKey
  );

  options?.onProgress?.(t("query.progress.querying"), "data");

  const stream = streamBackendSSE(endpoint, url, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId }),
    signal: options?.signal,
  });

  let dataCount = 0;

  for await (const ev of stream) {
    if (options?.signal?.aborted) break;

    const event = ev as any;

    if (Array.isArray(event)) {
      for (let finalIndex = 0; finalIndex < event.length; finalIndex++) {
        const chunk = buildDataChunkFromEvent(event[finalIndex], "final", finalIndex);
        if (!chunk) continue;

        dataCount++;
        options?.onData?.(chunk, dataCount);
        options?.onProgress?.(t("query.progress.dataReceived", { n: dataCount }), "data_chunk");

        yield chunk;
      }
      continue;
    }

    if (event.error && !hasNonErrorDataChunkPayload(event)) {
      throw new Error(event.error);
    }

    if (event.thinking) {
      options?.onThinking?.(event.thinking);
    }

    const chunk = buildDataChunkFromEvent(event, "stream");
    if (chunk) {
      dataCount++;

      options?.onData?.(chunk, dataCount);
      options?.onProgress?.(t("query.progress.dataReceived", { n: dataCount }), "data_chunk");

      yield chunk;
    }
  }

  options?.onProgress?.(t("query.progress.dataDone", { n: dataCount }), "data_done");
}
