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
 * 直接执行 DSL 查询（不经过 ABC 拆解），用于热报告匹配路径
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

/** 单个问数问题的分支执行结果 = 执行事实 + 业务执行状态。 */
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
  // 深度分析只启用 abc 分支，胜出输出带的就是这个分支的后端会话。
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
 * 一次问数问题的取证产出：执行事实，外加本次执行产生的待结算迟到事实。
 * 本工具不推送迟到事实、不自行起后台读取、不决定运行收口——只把它交回调用方登记。
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

  // 质检由查询后端在 ABC 路径上自动产生；能否取到只由本次执行的事实决定，
  // 触发判断留在工具内，调用方不复制这个条件。质检要的会话号取自执行输出，
  // 不从执行事实的会话列表推断（问数后端会话的定位与取消·C8）。
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
