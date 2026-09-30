import type { AbcBranchContext, BaseQueryOutput, OutKeyRef } from "./types";
import { getApiConfig, buildHeaders, buildUrl } from "../../../config/data-query-api";
import {
  AuthFailedError,
  BackendUnavailableError,
  getCircuitStatus,
} from "../../../utils/backend-client";
import { buildTableFromRows, type Dataset } from "../adapter";
import { t, tForLocale, tApp } from "../../../i18n";
import { createAbcLogger, type AbcLogger } from "../abc-logger";
import { extractBackendLocation, streamBackendSSE } from "../sse-transport";
import {
  extractHarnessMessage,
  normalizeHarnessDataContent,
  type HarnessEvent,
} from "./abc-harness-payload";
import {
  logger,
  previewText,
  describeUnknownData,
  getContentKeys,
} from "./abc-harness-diagnostics";
import { normalizeRows, collectColumns, buildDataset } from "./abc-harness-dataset";
import {
  getHarnessLabels,
  formatHarnessProcessSection,
  formatDataResultSection,
  joinMarkdownSections,
} from "./abc-harness-markdown";
import { polishHarnessAnswer } from "./abc-harness-answer";

const ABC_HARNESS_ENDPOINT = "/abcHarness";

export async function runAbcHarnessBranch(
  ctx: AbcBranchContext
): Promise<BaseQueryOutput | undefined> {
  const { queryQuestion, token, userId, locale, apiKey, pushEvent, thinking, setAbcThinking } = ctx;
  const labels = getHarnessLabels(locale);
  thinking.ensureParallelStarted();

  const config = getApiConfig();
  const { isOpen } = getCircuitStatus(ABC_HARNESS_ENDPOINT);
  if (isOpen) {
    throw new BackendUnavailableError(ABC_HARNESS_ENDPOINT);
  }

  thinking.set("running", t("query.progress.querying"));
  thinking.log(t("query.thinking.abcDecomposing"));

  const harnessMessages: string[] = [];
  const dataMessages: string[] = [];
  const datasets: Dataset[] = [];
  const abcCodes: string[] = [];
  const abcOutKeyRefs: OutKeyRef[][] = [];
  const protocolErrors: string[] = [];
  const eventTypeCounts: Record<string, number> = {};
  const unknownEventSamples: Array<{ type: string; keys: string[]; preview?: string }> = [];
  let sessionId: string | undefined;
  let backendNodeId: string | undefined;
  const requestStartedAt = Date.now();
  let lastEventAt: number | undefined;
  let lastEventType: string | undefined;
  let answerContent = "";

  let abcLogger!: AbcLogger;
  abcLogger = createAbcLogger({
    pushLog: () => {
      setAbcThinking(abcLogger.getSnapshot());
    },
    pushProgress: (progress) => {
      pushEvent({ type: "abc_progress", content: { progress }, progress });
    },
    maxLogs: 8,
  });

  const pushHarnessContent = () => {
    const content = harnessMessages.join("\n\n---\n\n");
    if (!content) return;
    thinking.setContent(content);
  };

  const pushHarnessMessage = (message: string) => {
    harnessMessages.push(message);
    pushHarnessContent();
  };

  const buildAnswerContent = () => {
    const sections = [
      formatHarnessProcessSection(harnessMessages, labels),
      formatDataResultSection(dataMessages, labels),
    ];
    return joinMarkdownSections(sections);
  };

  const buildFallback = (error?: string): BaseQueryOutput | undefined => {
    if (datasets.length === 0) return undefined;
    const errors = [...protocolErrors];
    if (error && !errors.includes(error)) errors.push(error);
    return {
      content: answerContent || buildAnswerContent(),
      datasets: [...datasets],
      sessionId,
      backendNodeId,
      nodeIds: [],
      subQuestions: datasets.map((dataset) => dataset.subQuestion || dataset.description),
      abcCodes: [...abcCodes],
      abcOutKeyRefs: abcOutKeyRefs.map((refs) => [...refs]),
      errors: errors.length > 0 ? errors : undefined,
    };
  };

  const publishFallback = (error?: string) => {
    const fallback = buildFallback(error);
    if (fallback) ctx.reportFallback(fallback);
  };

  try {
    abcLogger.setStage("abc_analysis", t("query.progress.querying"));

    const stream = streamBackendSSE(ABC_HARNESS_ENDPOINT, buildUrl(config, ABC_HARNESS_ENDPOINT), {
      method: "POST",
      headers: buildHeaders(config, token, userId, locale, apiKey),
      body: JSON.stringify({
        question: queryQuestion,
        ...(ctx.classNames?.length ? { classNames: ctx.classNames } : {}),
      }),
      signal: ctx.signal,
    });

    for await (const rawEvent of stream) {
      ctx.signal.throwIfAborted();

      const event = rawEvent as HarnessEvent;
      lastEventAt = Date.now();
      lastEventType = event.type || (event.error ? "ERROR" : "UNKNOWN");
      const location = extractBackendLocation(event);
      if (location?.sessionId) {
        sessionId = location.sessionId;
        if (location.backendNodeId !== undefined) backendNodeId = location.backendNodeId;
        ctx.reportBackendLocation({ sessionId, backendNodeId });
      }
      publishFallback();
      if (!event.type && !event.error && location?.sessionId) {
        continue;
      }
      if (event.error) {
        throw new Error(event.error);
      }

      const eventType = event.type || "UNKNOWN";
      eventTypeCounts[eventType] = (eventTypeCounts[eventType] || 0) + 1;

      if (event.type === "DATA_TYPE") {
        abcLogger.setStage("data");

        const dataContent = normalizeHarnessDataContent(event.content);
        const question =
          dataContent.question ||
          tForLocale(locale, "query.datasetFallbackTitle", { index: datasets.length + 1 });
        logger.info("abcHarness data event received", {
          sessionId,
          eventType,
          dataIndex: datasets.length + 1,
          question,
          data: describeUnknownData(dataContent.data),
          contentKeys: getContentKeys(event.content),
          hasCode: typeof dataContent.code === "string" && dataContent.code.length > 0,
          outKeyRefCount: Array.isArray(dataContent.outKeyRefs) ? dataContent.outKeyRefs.length : 0,
        });

        const code = dataContent.code?.trim();
        if (!code) {
          const errorMessage = tApp("queryFixed.203", { v0: (question) });
          protocolErrors.push(errorMessage);
          thinking.log(errorMessage);
          logger.warn(tApp("queryFixed.204"), {
            sessionId,
            question,
            dataIndex: eventTypeCounts[eventType],
            contentKeys: getContentKeys(event.content),
          });
          publishFallback();
          continue;
        }
        dataContent.code = code;

        const rows = normalizeRows(dataContent.data);
        const { tableSegment, normalizedRows, fieldDisplayPlan } = await buildTableFromRows(
          rows,
          question,
          {
            signal: ctx.signal,
            maxRows: 10,
            outputKeyDescriptionMDTable: dataContent.outputKeyDescriptionMDTable,
            code: dataContent.code,
            locale,
          }
        );

        if (tableSegment) {
          dataMessages.push(`### ${question}\n\n${tableSegment}`);
        }

        logger.info("abcHarness data event normalized", {
          sessionId,
          eventType,
          question,
          hasTableSegment: !!tableSegment,
          tablePreview: previewText(tableSegment),
          normalizedRowCount: normalizedRows.length,
          normalizedColumns: collectColumns(normalizedRows),
        });

        const dataset = buildDataset(
          dataContent,
          datasets.length,
          normalizedRows,
          fieldDisplayPlan,
          locale
        );
        datasets.push(dataset);
        abcCodes.push(code);
        abcOutKeyRefs.push(Array.isArray(dataContent.outKeyRefs) ? dataContent.outKeyRefs : []);
        answerContent = buildAnswerContent();
        abcLogger.setProgress(
          datasets.length,
          datasets.length,
          t("query.progress.queryingData", { n: datasets.length })
        );
        publishFallback();
        pushEvent({
          type: "query_datasets",
          datasets: [...datasets],
          nodeIds: [],
        });
        continue;
      }

      if (event.type === "MESSAGE_TYPE") {
        const message = extractHarnessMessage(event.content);
        logger.info("abcHarness MESSAGE_TYPE", {
          sessionId,
          eventType,
          messageIndex: eventTypeCounts[eventType],
          hasMessage: !!message,
          messageLength: message.length,
          messagePreview: previewText(message),
        });
        if (!message) continue;
        pushHarnessMessage(message);
        answerContent = buildAnswerContent();
        publishFallback();
        continue;
      }

      if (unknownEventSamples.length < 5) {
        unknownEventSamples.push({
          type: eventType,
          keys: getContentKeys(event.content),
          preview: previewText(event.content),
        });
      }
    }
    ctx.signal.throwIfAborted();

    let fullContent = buildAnswerContent();
    answerContent = fullContent;
    const processContent = joinMarkdownSections(harnessMessages);

    if (datasets.length === 0) {
      if (processContent) {
        thinking.setContent(processContent);
      }
      logger.warn(tApp("queryFixed.205"), {
        sessionId,
        eventTypeCounts,
        unknownEventSamples,
        messageCount: harnessMessages.length,
        protocolErrors,
        processContentPreview: previewText(processContent),
      });
      if (protocolErrors.length > 0) {
        throw new Error(protocolErrors.join(tApp("queryFixed.183")));
      }
      thinking.set("not_found", t("query.status.noAvailableData"));
      return undefined;
    }

    fullContent = await polishHarnessAnswer({
      originalQuestion: queryQuestion,
      fallbackContent: fullContent,
      harnessProcess: processContent,
      datasets,
      displayDataMessages: dataMessages,
      pushContent: (content, loading) => {
        answerContent = content;
        publishFallback();
        pushEvent({ type: "abc_content", content, loading });
      },
      signal: ctx.signal,
      locale,
      labels,
    });
    answerContent = fullContent;
    publishFallback();
    if (processContent) {
      thinking.setContent(processContent);
    }
    thinking.set("success", t("query.status.completed"));
    thinking.log(t("query.thinking.abcCompleted", { count: datasets.length }));
    abcLogger.success(t("query.status.queryCompleted"));

    logger.info(tApp("queryFixed.206"), {
      sessionId,
      eventTypeCounts,
      backendNodeId,
      messageCount: harnessMessages.length,
      dataMessageCount: dataMessages.length,
      datasetCount: datasets.length,
      fullContentLength: fullContent.length,
      fullContentPreview: previewText(fullContent),
      processContentLength: processContent.length,
      abcCodeCount: abcCodes.length,
      abcOutKeyRefGroupCount: abcOutKeyRefs.length,
    });

    return {
      content: fullContent,
      datasets,
      sessionId,
      backendNodeId,
      nodeIds: [],
      subQuestions: datasets.map((dataset) => dataset.subQuestion || dataset.description),
      abcCodes,
      abcOutKeyRefs: abcOutKeyRefs.length > 0 ? abcOutKeyRefs : undefined,
      errors: protocolErrors.length > 0 ? protocolErrors : undefined,
    };
  } catch (error: unknown) {
    if (error instanceof AuthFailedError) throw error;

    const errorMessage = error instanceof Error ? error.message : String(error);
    const isCancelled =
      ctx.signal.aborted ||
      (error instanceof Error && error.name === "AbortError") ||
      /abort/i.test(errorMessage);
    if (!isCancelled) {
      const errorLike = error as {
        name?: string;
        cause?: { code?: unknown; message?: unknown };
      };
      const now = Date.now();
      logger.error(tApp("queryFixed.207"), {
        error: errorMessage,
        errorName: errorLike.name,
        errorCauseCode: errorLike.cause?.code,
        errorCauseMessage: errorLike.cause?.message,
        sessionId,
        backendNodeId,
        requestDurationMs: now - requestStartedAt,
        lastEventAt: lastEventAt ? new Date(lastEventAt).toISOString() : undefined,
        lastEventType,
        msSinceLastEvent: lastEventAt ? now - lastEventAt : undefined,
      });
      publishFallback(errorMessage);
    }
    throw error;
  }
}
