import type { ThinkingAbcState, ThinkingProgress } from "@ontomato/contracts/query-thinking";
import { tool } from "langchain";
import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import { createLogger } from "../../logging/logger";
import { AuthFailedError } from "../../utils/backend-client";
import { t, tApp } from "../../i18n";
import { isApiConfigured, getApiConfig, buildUrl } from "../../config/data-query-api";
import { streamQuestionSplit, streamDataChunks, type DataChunk, type SubQuestion } from "./client";
import {
  buildTableFromRows,
  convertChunkToDataset,
  rowsFromQueryAnswerPayloads,
  type Dataset,
} from "./adapter";
import { streamAbcAnalysis, makeResultTransition, makeAnalysisTransition } from "./abc-description";
import { renderSubgraphBlock, type Subgraph } from "./subgraph-render";
import { streamConclusion } from "./conclusion";
import { createAbcLogger, type AbcLogger } from "./abc-logger";

import { backendPost } from "../../utils/backend-client";
import { truncateErrorForDisplay } from "./display-error";
import { buildAbcReplayPlanFromChunks, type HotReportReplayPlan } from "./replay-plan";
import type { BaseQueryOutput, QueryBackendLocation } from "./branches/types";

const logger = createLogger("abc-query");

/** Call context actually read by the ABC query; its fields map one-to-one to the construction site of `runAbcBranch`. */
export type AbcQueryConfig = RunnableConfig<{
  token?: string;
  apiKey?: string;
  userId?: string;
  locale?: string;
  progressCallback?: (event: any) => void;
  isV0?: boolean;
  modelOptions?: Record<string, unknown>;
  reportFallback?: (output: BaseQueryOutput) => void;
  reportBackendLocation?: (location: QueryBackendLocation) => void;
  classNames?: string[];
}>;

type ExecuteAbcQueryResult =
  | {
      success: true;
      sessionId: string;
      content: string;
      subQuestions: string[];
      thinkingSummary: string;
      thinkingSteps: ReturnType<AbcLogger["getSteps"]>;
      thinkingState: ReturnType<AbcLogger["getSnapshot"]>;
      datasets: Dataset[];
      backendNodeId?: string;
      nodeIds: string[];
      replayPlan?: HotReportReplayPlan;
      abcDsls?: unknown[];
      abcCodes?: string[];
    }
  | {
      success: false;
      error: string;
      displayError?: string;
      rawError?: string;
      thinkingSummary?: string;
      thinkingState?: ThinkingAbcState;
    };

function getConfigurable(config?: AbcQueryConfig) {
  return config?.configurable;
}

function pushLog(
  config: AbcQueryConfig | undefined,
  patch: { thinking: string; mode: "append" | "replace"; abcState?: ThinkingAbcState }
) {
  const callback = getConfigurable(config)?.progressCallback;
  if (callback) {
    callback({ type: "abc_thinking", ...patch });
  }
}

function pushContent(config: AbcQueryConfig | undefined, content: string, loading = false) {
  const configurable = getConfigurable(config);
  configurable?.progressCallback?.({ type: "abc_content", content, loading });
}

function pushAbcAnalysis(config: AbcQueryConfig | undefined, event: any) {
  const callback = getConfigurable(config)?.progressCallback;
  if (callback) {
    callback({ type: "abc_analysis", ...event });
  }
}

function pushDatasets(config: AbcQueryConfig | undefined, datasets: Dataset[], nodeIds?: string[]) {
  const configurable = getConfigurable(config);
  const datasetSnapshot = [...datasets];
  const nodeIdSnapshot = nodeIds ? [...nodeIds] : undefined;
  configurable?.progressCallback?.({
    type: "query_datasets",
    datasets: datasetSnapshot,
    nodeIds: nodeIdSnapshot,
  });
}

function pushProgress(config: AbcQueryConfig | undefined, progress: ThinkingProgress) {
  const callback = getConfigurable(config)?.progressCallback;
  if (callback) {
    callback({ type: "abc_progress", progress });
  }
}

function isFailedDataChunk(chunk: DataChunk): chunk is Extract<DataChunk, { error: string }> {
  return typeof chunk.error === "string";
}

async function fetchNodeIdsFromDsl(
  dsl: unknown,
  token: string,
  userId?: string,
  locale?: string,
  signal?: AbortSignal,
  apiKey?: string
): Promise<string[]> {
  try {
    const config = getApiConfig();
    const url = buildUrl(config, config.endpoints.getNodeIds);

    const response = await backendPost(config.endpoints.getNodeIds, url, dsl, {
      token,
      userId,
      locale,
      signal,
      apiKey,
    });
    let json: any = {};
    try {
      json = JSON.parse(response.text);
    } catch {
      /* Keep the existing invalid-JSON fallback. */
    }
    const ids = (() => {
      if (Array.isArray(json)) return json;
      if (Array.isArray(json?.data)) return json.data;
      if (Array.isArray(json?.nodeIds)) return json.nodeIds;
      if (Array.isArray(json?.ids)) return json.ids;
      if (Array.isArray((json as any)?.result)) return (json as any).result;
      return [];
    })();
    return ids.map((id: unknown) => String(id)).filter(Boolean);
  } catch (e: any) {
    const isCancelled =
      signal?.aborted || e?.name === "AbortError" || /abort/i.test(e?.message || "");
    if (isCancelled) throw e;
    logger.warn(tApp("queryFixed.179"), { error: e?.message });
    return [];
  }
}

async function fetchOntologyMetas(
  token: string,
  userId?: string,
  locale?: string,
  apiKey?: string,
  signal?: AbortSignal
): Promise<{
  classShowName: Map<string, string>;
  relationDesc: Map<string, string>;
}> {
  const classShowName = new Map<string, string>();
  const relationDesc = new Map<string, string>();
  try {
    const config = getApiConfig();
    const url = buildUrl(config, "/admin/getMetas");
    const response = await backendPost(
      "/admin/getMetas",
      url,
      {},
      { token, userId, locale, apiKey, signal }
    );
    let json: any = {};
    try {
      json = JSON.parse(response.text);
    } catch {
      /* Keep the existing invalid-JSON fallback. */
    }
    const classDef = json?.data?.classDef || json?.classDef || [];
    const relationshipRule = json?.data?.relationship_rule || {};
    if (Array.isArray(classDef)) {
      for (const cls of classDef) {
        if (cls.className && cls.showName) {
          classShowName.set(cls.className.trim(), cls.showName.trim());
        }
      }
    }
    if (relationshipRule && typeof relationshipRule === "object") {
      for (const [key, rel] of Object.entries(relationshipRule) as [string, any][]) {
        if (rel.desc) {
          const desc = String(rel.desc).trim();
          relationDesc.set(key.trim(), desc);
          if (rel.fromclass && rel.toclass) {
            relationDesc.set(
              `${String(rel.fromclass).trim()}->${String(rel.toclass).trim()}`,
              desc
            );
          }
        }
      }
    }
  } catch (e: any) {
    const isCancelled =
      signal?.aborted || e?.name === "AbortError" || /abort/i.test(e?.message || "");
    if (isCancelled) throw e;
    logger.warn(tApp("queryFixed.180"), { error: e?.message });
  }
  return { classShowName, relationDesc };
}

export async function executeAbcQuery(
  query: string,
  config?: AbcQueryConfig
): Promise<ExecuteAbcQueryResult> {
  logger.debug(tApp("queryFixed.181"), { query: query.slice(0, 200), queryLength: query.length });

  if (!isApiConfigured()) {
    logger.warn(tApp("queryFixed.182"));
    return {
      success: false,
      error: t("query.error.apiNotConfigured"),
    };
  }

  const configurable = getConfigurable(config);
  const token = configurable?.token || "";
  const apiKey = configurable?.apiKey || "";
  const userId = configurable?.userId || "";
  const locale = configurable?.locale || "";
  const modelOptions = configurable?.modelOptions || {};
  const isV0 = Boolean(configurable?.isV0);
  const classNames = configurable?.classNames;
  const signal = config?.signal;

  let abcLogger!: AbcLogger;
  abcLogger = createAbcLogger({
    pushLog: (patch) => pushLog(config, { ...patch, abcState: abcLogger.getSnapshot() }),
    pushProgress: (progress) => pushProgress(config, progress),
    maxLogs: 12,
  });

  const subQuestions: SubQuestion[] = [];
  let sessionId: string | undefined;
  let fullContent = "";
  let isFirstSubQuestion = true;
  const datasets: Dataset[] = [];
  let backendNodeId: string | undefined;
  let nodeIds: string[] = [];
  let replayPlan: HotReportReplayPlan | undefined;
  const abcDsls: unknown[] = [];
  const abcCodes: string[] = [];
  const executionErrors: string[] = [];

  const publishFallback = (error?: string) => {
    if (datasets.length === 0) return;
    const errors = [...executionErrors];
    if (error && error !== executionErrors.join(tApp("queryFixed.183")) && !errors.includes(error))
      errors.push(error);
    configurable?.reportFallback?.({
      content: fullContent,
      datasets: [...datasets],
      sessionId,
      backendNodeId,
      nodeIds: [...nodeIds],
      subQuestions: subQuestions.map((sq) => sq.subQuestion),
      abcDsls: [...abcDsls],
      abcCodes: [...abcCodes],
      replayPlan,
      errors: errors.length > 0 ? errors : undefined,
    });
  };

  let classMetasMap: Map<string, string> | undefined;
  let relationMetasMap: Map<string, string> | undefined;
  let classMetasFetched = false;

  try {
    abcLogger.setStage("split");

    for await (const ev of streamQuestionSplit(query, {
      token,
      userId,
      locale,
      signal,
      apiKey,
      isV0,
      classNames,
    })) {
      if (!ev) continue;

      if (ev.subQuestion) {
        const sq = ev.subQuestion;
        subQuestions.push(sq);

        const subQuestion = sq.subQuestion;

        abcLogger.setStage(
          "abc_analysis",
          t("query.progress.abcAnalyzing", { n: subQuestions.length })
        );

        if (!isFirstSubQuestion) {
          fullContent += "\n\n---\n\n";
        }
        isFirstSubQuestion = false;

        const analysisTransition = makeAnalysisTransition(subQuestion);

        const subgraphDesc = sq.subgraph
          ? JSON.stringify([{ subQuestion, subgraph: sq.subgraph }], null, 2)
          : JSON.stringify([{ subQuestion }], null, 2);

        let tempAbcDesc = "";

        const abcDesc = await streamAbcAnalysis(
          query,
          subQuestion,
          subgraphDesc,
          modelOptions,
          (event) => {
            pushAbcAnalysis(config, event);
            if (event.type === "abc_analysis_chunk" && event.content) {
              tempAbcDesc = event.content;
              pushContent(config, fullContent + tempAbcDesc, true);
            }
          },
          signal,
          analysisTransition
        );

        fullContent += abcDesc;

        if (sq.subgraph) {
          if (!classMetasFetched) {
            const metas = await fetchOntologyMetas(token, userId, locale, apiKey, signal);
            classMetasMap = metas.classShowName;
            relationMetasMap = metas.relationDesc;
            classMetasFetched = true;
          }
          const subgraphBlock = renderSubgraphBlock(
            sq.subgraph as Subgraph,
            classMetasMap,
            relationMetasMap
          );
          fullContent += subgraphBlock;
        }

        pushContent(config, fullContent, false);
      }

      if (ev.sessionId) {
        sessionId = ev.sessionId;
      }
      if (ev.backendNodeId) {
        backendNodeId = ev.backendNodeId;
      }
      if (ev.sessionId || ev.backendNodeId) {
        configurable?.reportBackendLocation?.({ sessionId, backendNodeId });
      }
    }

    if (subQuestions.length === 0) {
      throw new Error(t("query.error.noSubQuestions"));
    }

    // The session number is guaranteed only by streamQuestionSplit: it throws when the stream ends without one, so a value must exist here.
    const backendSessionId = sessionId as string;

    abcLogger.setStage("data");

    logger.debug(tApp("queryFixed.184"), {
      sessionId,
      backendNodeId,
      subQuestionCount: subQuestions.length,
    });

    let dataCount = 0;
    const totalQuestions = subQuestions.length;
    const streamChunks: DataChunk[] = [];
    const finalChunks: DataChunk[] = [];

    for await (const chunk of streamDataChunks(backendSessionId, {
      token,
      userId,
      locale,
      signal,
      apiKey,
    })) {
      if (chunk.source === "final") {
        finalChunks.push(chunk);
      } else {
        streamChunks.push(chunk);
      }

      dataCount++;
      abcLogger.setProgress(
        dataCount,
        totalQuestions,
        t("query.progress.queryingData", { n: dataCount })
      );
    }

    const authoritativeChunks =
      finalChunks.length > 0
        ? [...finalChunks].sort((a, b) => (a.finalIndex ?? 0) - (b.finalIndex ?? 0))
        : streamChunks;
    replayPlan = buildAbcReplayPlanFromChunks(authoritativeChunks, backendSessionId);
    const datasetsBySourceChunkIndex = new Map<number, Dataset>();

    for (const [chunkIndex, chunk] of authoritativeChunks.entries()) {
      if (isFailedDataChunk(chunk)) {
        executionErrors.push(chunk.error);
        logger.warn(tApp("queryFixed.185"), { error: chunk.error, sessionId });
        publishFallback();
        continue;
      }

      const actualData = rowsFromQueryAnswerPayloads(chunk.data);
      const currentSubQ =
        chunk.dsl?.problem ||
        chunk.data.find((item) => typeof item.problem === "string" && item.problem)?.problem ||
        subQuestions[chunkIndex]?.subQuestion ||
        t("query.summary.dataChunk", { n: chunkIndex + 1 });

      const { tableSegment, normalizedRows, fieldDisplayPlan } = await buildTableFromRows(
        actualData,
        currentSubQ,
        {
          signal,
          maxRows: 10,
          outputKeyDescriptionMDTable: chunk.outputKeyDescriptionMDTable,
          code: chunk.code,
          locale,
        }
      );

      const transition = makeResultTransition(currentSubQ);
      const dataContent = `\n\n---\n\n${transition}\n\n${tableSegment}\n\n`;
      fullContent += dataContent;
      pushContent(config, fullContent, true);

      const dataset = convertChunkToDataset(
        { data: normalizedRows, dsl: chunk.dsl },
        chunkIndex,
        locale
      );
      dataset.subQuestion = currentSubQ;
      dataset.description = currentSubQ;
      dataset.fieldDisplayPlan = fieldDisplayPlan;
      datasets.push(dataset);
      abcDsls.push(chunk.dsl || null);
      abcCodes.push(chunk.code || "");

      const sourceChunkIndex = chunk.source === "final" ? chunk.finalIndex : chunkIndex;
      if (sourceChunkIndex === undefined) {
        throw new Error(tApp("queryFixed.177", { v0: (chunkIndex + 1) }));
      }
      datasetsBySourceChunkIndex.set(sourceChunkIndex, dataset);
      publishFallback();
      pushDatasets(config, datasets, nodeIds);
    }

    logger.debug(tApp("queryFixed.186"), {
      sessionId,
      chunkCount: dataCount,
      authoritativeChunkCount: authoritativeChunks.length,
      datasetCount: datasets.length,
    });
    abcLogger.log(t("query.progress.dataDone", { n: dataCount }));

    if (datasets.length === 0) {
      throw new Error(
        executionErrors.length > 0 ? executionErrors.join(tApp("queryFixed.183")) : t("query.node.noValidResult")
      );
    }

    const firstDsl = datasets[0]?.dsl;
    if (firstDsl) {
      nodeIds = await fetchNodeIdsFromDsl(firstDsl, token, userId, locale, signal, apiKey);
      logger.debug(tApp("queryFixed.187"), { count: nodeIds.length });
      publishFallback();
    }

    if (executionErrors.length > 0) {
      throw new Error(executionErrors.join(tApp("queryFixed.183")));
    }

    abcLogger.setStage("conclusion");

    fullContent += "\n";
    publishFallback();

    const afterCalculations = replayPlan?.afterCalculations || [];
    const finalCalculation = afterCalculations[afterCalculations.length - 1];
    let conclusionDatasets = datasets;
    if (finalCalculation) {
      if (finalCalculation.sourceChunkIndex === undefined) {
        throw new Error(tApp("queryFixed.188"));
      }
      const finalDataset = datasetsBySourceChunkIndex.get(finalCalculation.sourceChunkIndex);
      if (!finalDataset) {
        throw new Error(tApp("queryFixed.189"));
      }
      conclusionDatasets = [finalDataset];
    }

    const finalContent = await streamConclusion(
      query,
      conclusionDatasets,
      fullContent,
      (content: string) => {
        fullContent = content;
        publishFallback();
        pushContent(config, fullContent, false);
      },
      signal,
      locale
    );

    fullContent = finalContent;
    publishFallback();

    abcLogger.success(t("query.status.queryCompleted"));

    pushDatasets(config, datasets, nodeIds);

    const thinkingSteps = abcLogger.getSteps();
    const thinkingSummary = thinkingSteps.map((step) => step.text).join("\n");
    const thinkingState = abcLogger.getSnapshot();

    return {
      success: true,
      sessionId: backendSessionId,
      backendNodeId,
      content: fullContent,
      subQuestions: subQuestions.map((sq) => sq.subQuestion),
      thinkingSummary,
      thinkingSteps,
      thinkingState,
      datasets,
      nodeIds,
      replayPlan,
      abcDsls,
      abcCodes,
    };
  } catch (error: unknown) {
    if (error instanceof AuthFailedError) throw error;

    const errorMessage = error instanceof Error ? error.message : String(error);
    const displayError = truncateErrorForDisplay(errorMessage);
    const errorName = error instanceof Error ? error.name : "";
    const isCancelled =
      signal?.aborted || errorName === "AbortError" || /abort/i.test(errorMessage);
    logger.error(tApp("queryFixed.190"), { query: query.slice(0, 200), error: errorMessage });
    if (isCancelled) {
      abcLogger.cancelled(t("query.status.queryCancelled"));
    } else {
      abcLogger.failed(displayError);
    }
    publishFallback(errorMessage);
    return {
      success: false,
      error: displayError,
      displayError,
      rawError: errorMessage,
      thinkingSummary:
        abcLogger
          .getSteps()
          .map((step) => step.text)
          .join("\n") || undefined,
      thinkingState: abcLogger.getSnapshot(),
    };
  }
}

export const abcDataQueryTool = tool(
  async ({ query }: { query: string }, config?: RunnableConfig) => {
    const result = await executeAbcQuery(query, config);

    if (!result.success) {
      const displayError = result.displayError || truncateErrorForDisplay(result.error);
      const errorContent = t("query.error.queryFailed", {
        error: displayError || t("query.error.unknownError"),
      });
      return [
        errorContent,
        {
          success: false,
          error: displayError || t("query.error.unknownError"),
          query,
        },
      ];
    }

    const datasetCount = result.datasets?.length || 0;
    const totalRows = result.datasets?.reduce((sum, ds) => sum + (ds.data?.length || 0), 0) || 0;
    const columns = result.datasets?.[0]?.columns || [];

    const summaryContent = tApp("queryFixed.178", { v0: (t("query.summary.success")), v1: (t("query.summary.subQuestionCount", { n: result.subQuestions?.length || 0 })), v2: (t("query.summary.datasetCount", { n: datasetCount })), v3: (t("query.summary.totalRows", { n: totalRows })), v4: (t("query.summary.mainColumns", { cols: columns.slice(0, 5).join(", ") + (columns.length > 5 ? "..." : "") })), v5: (result.sessionId), v6: (t("query.summary.readyMessage")) });

    return [
      summaryContent,
      {
        success: true,
        sessionId: result.sessionId,
        subQuestions: result.subQuestions,
        thinkingSummary: result.thinkingSummary,
        datasets: result.datasets,
        query,
        datasetCount,
        totalRows,
        columns,
      },
    ];
  },
  {
    name: "abc_data_query",
    description:
      tApp("queryFixed.191"),
    schema: z.object({
      query: z.string().describe(tApp("queryFixed.192")),
    }),
    responseFormat: "content_and_artifact",
  }
);
