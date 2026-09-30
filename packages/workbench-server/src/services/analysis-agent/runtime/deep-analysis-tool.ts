import type { QueryThinkingState, ThinkingBranchCard } from "@ontomato/contracts/query-thinking";
import type { QueryFactDatasetPreview } from "@ontomato/contracts/query-execution";
import { startQualityCheckSettlement } from "../../data-query/late-fact";
import type { QueryRunIdentity } from "../../data-query/query-fact";
import { getAbcQuestionMode } from "../../data-query/data-query-policy";
import { environment } from "../../../config/environment";
import { createLogger } from "../../../logging/logger";
import { tForLocale } from "../../../i18n";
import {
  createFieldDisplayPlan,
  renderDataAsTable,
  convertChunkToDataset,
  rowsFromQueryAnswerPayloads,
} from "../../data-query/adapter";
import { parseQueryAnswerPayloads } from "../../data-query/protocol";
import type { AnalysisQueryFact, DimensionQueryResult } from "./evidence-types";
import { buildQueryResultDataFromDatasets, buildQueryResultDslFromDatasets } from "./query-result";
import { executeDslViaBackend } from "../../data-query/dsl-executor";
import type { BaseQueryOutput } from "../../data-query/branches/types";

import {
  DEEP_ANALYSIS_QUERY_BRANCHES,
  executeBaseQuery,
} from "../../data-query/base-query-executor";
import { tApp } from "../../../i18n";


const logger = createLogger("deep-analysis-query");

function previewLogText(value: string | undefined, maxLength = 200): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

/**
 * Executes a DSL query directly (without ABC decomposition), for the hot-report matching path
 */
export async function executeDslDirectly(params: {
  dsl: any;
  questionId: string;
  dimensionId: string;
  dimensionName: string;
  dimensionValue: string;
  subQuestion: string;
  token?: string;
  signal?: AbortSignal;
  locale?: string;
}): Promise<DimensionQueryResult> {
  const {
    dsl,
    questionId,
    dimensionId,
    dimensionName,
    dimensionValue,
    subQuestion,
    token,
    signal,
    locale,
  } = params;

  const baseResult: DimensionQueryResult = {
    questionId,
    dimensionId,
    dimensionName,
    dimensionValue,
    subQuestion,
    status: "pending",
  };

  try {
    baseResult.status = "in_progress";

    const result = await executeDslViaBackend(dsl, token || "", 30000, signal);

    if (!result.ok) {
      baseResult.status = "failed";
      baseResult.error = result.detail || tApp("analysis.runtime.deep-analysis-tool.398", { status: result.status });
      return baseResult;
    }

    const payload = result.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error(tApp("analysis.runtime.deep-analysis-tool.399"));
    }
    const rawData = rowsFromQueryAnswerPayloads(
      parseQueryAnswerPayloads((payload as Record<string, unknown>).data, tApp("analysis.runtime.deep-analysis-tool.400"))
    );

    const outputKeyDescriptionMDTable =
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      typeof (payload as Record<string, unknown>).outputKeyDescriptionMDTable === "string"
        ? String((payload as Record<string, unknown>).outputKeyDescriptionMDTable)
        : undefined;
    const fieldDisplayPlan = await createFieldDisplayPlan(rawData, {
      subQuestion,
      signal,
      outputKeyDescriptionMDTable,
      locale,
    });
    const tableMarkdown = renderDataAsTable(rawData, fieldDisplayPlan, {
      maxRows: 20,
      locale,
    });

    const dataset = convertChunkToDataset({ data: rawData, dsl }, 0, locale);
    dataset.fieldDisplayPlan = fieldDisplayPlan;
    const datasets = [dataset];

    baseResult.status = "completed";
    baseResult.data = rawData;
    baseResult.dsl = dsl;
    baseResult.markdownTable = tableMarkdown;
    (baseResult as any).datasets = datasets;

    return baseResult;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(tApp("analysis.runtime.deep-analysis-tool.401", { subQuestion: subQuestion }), errorMessage);

    baseResult.status = "failed";
    baseResult.error = errorMessage;
    return baseResult;
  }
}

/** Branch execution result of one query question = execution facts + business execution state. */
export interface SubQuestionBranchResult extends AnalysisQueryFact {
  status: "completed" | "failed";
  error?: string;
}

function applyBaseQueryOutput(target: SubQuestionBranchResult, output: BaseQueryOutput) {
  const datasets = output.datasets;
  target.data = datasets.length > 0 ? buildQueryResultDataFromDatasets(datasets) : undefined;
  target.dsl = datasets.length > 0 ? buildQueryResultDslFromDatasets(datasets) : undefined;
  target.datasets = datasets.length > 0 ? datasets : undefined;
  target.fullContent = output.content;
  target.markdownTable = output.content;
  target.dataCount = datasets.reduce((sum, dataset) => sum + (dataset.data?.length || 0), 0);
  // Deep analysis enables only the abc branch, so the winning output already carries that branch's backend session.
  target.backendSessions = output.sessionId
    ? [{ branch: "abc", sessionId: output.sessionId, nodeId: output.backendNodeId }]
    : undefined;
  target.abcSubQuestions = output.subQuestions;
  target.abcDsls = output.abcDsls;
  target.abcCodes = output.abcCodes;
  target.abcOutKeyRefs = output.abcOutKeyRefs;
  target.replayPlan = output.replayPlan;
  target.error = output.errors?.length ? output.errors.join(tApp("analysis.dimension.abc-replay.39")) : target.error;
}

function collectThinkingCards(thinkingState: QueryThinkingState | undefined): ThinkingBranchCard[] {
  if (!thinkingState) return [];
  return thinkingState.branches.flatMap((branch) => branch.cards || []);
}

/**
 * Evidence output of one query question: execution facts plus the pending late facts this execution produced.
 * This tool never pushes late facts, never starts background reads, and never decides run finalization — it only hands them back to the caller to register.
 */
export interface SubQuestionExecution {
  result: SubQuestionBranchResult;
  pendingQualityCheck?: Promise<void>;
}

export async function executeSubQuestionWithBranches(
  question: { subQuestion: string },
  token: string,
  userId: string,
  signal: AbortSignal,
  onBranchProgress?: (thinkingState: QueryThinkingState) => void,
  apiKey = environment.queryKey() || "",
  locale?: string,
  classNames?: string[],
  runIdentity?: QueryRunIdentity
): Promise<SubQuestionExecution> {
  const queryQuestion = question.subQuestion;

  const baseResult: SubQuestionBranchResult = { status: "failed" };

  // The quality check is produced automatically by the query backend on the ABC path; whether one can be fetched depends only on the facts of this execution.
  // The trigger decision stays inside the tool so callers never duplicate that condition. The session number the quality check needs comes from the execution output,
  // never inferred from the execution facts' session list (backend session locating and cancellation · C8).
  const handOff = (result: SubQuestionBranchResult, sessionId?: string): SubQuestionExecution =>
    runIdentity && result.winner === "abc" && sessionId
      ? {
          result,
          pendingQualityCheck: startQualityCheckSettlement({
            identity: runIdentity,
            sessionId,
            abcQuestionMode: getAbcQuestionMode(),
            token,
            apiKey,
            userId,
            locale,
            signal,
          }),
        }
      : { result };

  try {
    const execution = await executeBaseQuery({
      queryQuestion,
      token,
      apiKey,
      userId,
      locale,
      signal,
      enabledBranches: DEEP_ANALYSIS_QUERY_BRANCHES,
      classNames,
      onThinkingState: onBranchProgress,
    });

    if (!execution.winner) {
      baseResult.error = execution.error.message;
      if (execution.abcFallback) {
        applyBaseQueryOutput(baseResult, execution.abcFallback);
      }
      baseResult.thinkingState = execution.thinkingState;
      const cards = collectThinkingCards(execution.thinkingState);
      baseResult.cards = cards.length > 0 ? cards : undefined;
      if (baseResult.datasets && baseResult.datasets.length > 0) {
        baseResult.status = "completed";
      }
      return handOff(baseResult, execution.abcFallback?.sessionId);
    }

    const ret = execution.output;
    logger.info("[DeepAnalysis] winner result received", {
      queryQuestion,
      winner: execution.winner,
      contentLength: ret.content?.length || 0,
      contentPreview: previewLogText(ret.content),
      datasetCount: ret.datasets.length,
      datasetSummaries: ret.datasets.map((dataset) => ({
        name: dataset.name,
        description: dataset.description,
        rowCount: Array.isArray(dataset.data) ? dataset.data.length : 0,
        columns: dataset.columns,
      })),
      sessionId: ret.sessionId,
      subQuestionCount: ret.subQuestions?.length || 0,
      abcCodeCount: ret.abcCodes?.length || 0,
      abcOutKeyRefGroupCount: ret.abcOutKeyRefs?.length || 0,
    });
    const thinkingState = execution.thinkingState;
    const cards = collectThinkingCards(thinkingState);

    baseResult.status = "completed";
    applyBaseQueryOutput(baseResult, ret);
    baseResult.thinkingState = thinkingState;
    baseResult.cards = cards.length > 0 ? cards : undefined;
    baseResult.winner = execution.winner;

    if (ret.datasets.length > 1) {
      const datasetPreviews: QueryFactDatasetPreview[] = [];
      for (let index = 0; index < ret.datasets.length; index++) {
        const dataset = ret.datasets[index];
        const title =
          dataset.description ||
          dataset.name ||
          tForLocale(locale, "query.datasetFallbackTitle", { index: index + 1 });
        try {
          datasetPreviews.push({
            title,
            markdownTable: renderDataAsTable(dataset.data || [], dataset.fieldDisplayPlan, {
              maxRows: 20,
              locale,
            }),
            dataCount: Array.isArray(dataset.data) ? dataset.data.length : 0,
          });
        } catch {
          datasetPreviews.push({
            title,
            markdownTable: ret.content || "",
            dataCount: Array.isArray(dataset.data) ? dataset.data.length : 0,
          });
        }
      }
      baseResult.datasetPreviews = datasetPreviews;
      baseResult.markdownTable = datasetPreviews
        .map((preview) => `### ${preview.title}\n\n${preview.markdownTable}`)
        .join("\n\n");
    } else if (ret.datasets.length > 0 && ret.datasets[0].data) {
      try {
        baseResult.markdownTable = renderDataAsTable(
          ret.datasets[0].data,
          ret.datasets[0].fieldDisplayPlan,
          {
            maxRows: 20,
            locale,
          }
        );
      } catch {
        baseResult.markdownTable = ret.content || "";
      }
    } else {
      baseResult.markdownTable = ret.content || "";
    }

    logger.info("[DeepAnalysis] query display fields built", {
      queryQuestion,
      winner: execution.winner,
      status: baseResult.status,
      dataCount: baseResult.dataCount,
      fullContentLength: baseResult.fullContent?.length || 0,
      fullContentPreview: previewLogText(baseResult.fullContent),
      markdownTableLength: baseResult.markdownTable?.length || 0,
      markdownTablePreview: previewLogText(baseResult.markdownTable),
      datasetPreviewCount: baseResult.datasetPreviews?.length || 0,
      hasData: Array.isArray(baseResult.data) ? baseResult.data.length > 0 : !!baseResult.data,
      hasDsl: Array.isArray(baseResult.dsl) ? baseResult.dsl.length > 0 : !!baseResult.dsl,
    });

    return handOff(baseResult, ret.sessionId);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(tApp("analysis.runtime.deep-analysis-tool.402", { queryQuestion: queryQuestion }), errorMessage);
    baseResult.status = "failed";
    baseResult.error = errorMessage;
    return { result: baseResult };
  }
}
