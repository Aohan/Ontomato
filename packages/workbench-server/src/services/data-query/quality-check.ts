import { tApp } from "../../i18n";
import type { AbcQuestionMode } from "@ontomato/contracts/system-model";
import type { QcStepEvent, QcResult } from "@ontomato/contracts/query-thinking";
import { getApiConfig, buildHeaders, buildUrl } from "../../config/data-query-api";
import { streamBackendSSE } from "./sse-transport";

import { createLogger } from "../../logging/logger";

const logger = createLogger("quality-check");

export interface StreamSelfCheckOptions {
  sessionId: string;
  token?: string;
  apiKey?: string;
  userId?: string;
  locale?: string;
  abcQuestionMode: AbcQuestionMode;
  signal?: AbortSignal;
  onStep?: (step: QcStepEvent) => void;
  onFinish?: (result: QcResult) => void;
  onError?: (error: Error) => void;
}

/**
 * Streaming quality check (SSE)
 * Calls the backend /check/queryBySessionId endpoint and receives quality-check progress and the final result in real time
 */
export async function streamSelfCheckSSE(
  options: StreamSelfCheckOptions
): Promise<QcResult | null> {
  const { sessionId, token, apiKey, userId, locale, signal, onStep, onFinish, onError } = options;

  const config = getApiConfig();
  const endpoint =
    options.abcQuestionMode === "harness" ? `${config.endpoints.check}-v2` : config.endpoints.check;
  const url = buildUrl(config, endpoint);
  const headers = buildHeaders(config, token, userId, locale, apiKey);

  logger.info(tApp("queryFixed.267", { v0: (sessionId), v1: (url) }));

  let opened = false;
  let sawAnyStep = false;
  let finishedPushed = false;

  const result: QcResult = { steps: [] };

  const consumeEvent = (parsed: any) => {
    if (!parsed || typeof parsed !== "object") return;

    // Step events
    const hasSummary = typeof parsed.summary === "string" && parsed.summary.trim().length > 0;
    const hasMeaning = typeof parsed.meaning === "string" && parsed.meaning.trim().length > 0;

    if (hasSummary || hasMeaning) {
      sawAnyStep = true;
      const step: QcStepEvent = {};
      if (hasSummary) step.summary = parsed.summary.trim();
      if (hasMeaning) step.meaning = parsed.meaning.trim();
      result.steps.push(step);
      onStep?.(step);
    }

    // Conclusion events
    const hasConclusion =
      typeof parsed.conclusion === "string" && parsed.conclusion.trim().length > 0;
    const hasScore = typeof parsed.score !== "undefined" && parsed.score !== null;
    const hasFittedQuestion =
      typeof parsed.fittedQuestion === "string" && parsed.fittedQuestion.trim().length > 0;

    if (hasConclusion || hasScore || hasFittedQuestion) {
      if (hasScore) result.score = Number(parsed.score);
      if (hasFittedQuestion) result.fittedQuestion = String(parsed.fittedQuestion).trim();
      if (hasConclusion) result.conclusion = String(parsed.conclusion).trim();

      finishedPushed = true;
      onFinish?.(result);
    }
  };

  try {
    for await (const parsed of streamBackendSSE(
      endpoint,
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...headers },
        body: JSON.stringify({ sessionId }),
        signal,
      },
      () => {
        opened = true;
      }
    )) {
      consumeEvent(parsed);
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error(opened ? tApp("queryFixed.268") : tApp("queryFixed.269"), error);
    onError?.(error);
  }

  // Has progress but no conclusion
  if (!finishedPushed && sawAnyStep) {
    logger.warn(tApp("queryFixed.270"));
  }

  return opened ? result : null;
}
