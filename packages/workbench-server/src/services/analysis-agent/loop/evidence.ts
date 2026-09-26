import type { QueryThinkingState } from "@ontomato/contracts/query-thinking";
import type { AnalysisEvidenceQuestion } from "@ontomato/contracts/analysis-presentation";
/**
 * 循环形态的取证能力：把一批问数问题交给报告证据接入层取得当前数据证据。
 *
 * 一次请求可以携带多个问数问题，运行时按并发上限执行；单个问题失败收敛为该问题的
 * 失败结果，不中断循环。返回给模型的只有展示值数据所见，原始值不进循环上下文。
 */

import { PendingLateFacts } from "../../data-query/late-fact";
import type { SubQuestionBranchResult } from "../runtime/deep-analysis-tool";
import { v4 as uuidv4 } from "uuid";
import type { AgentTool, AgentToolResult } from "../../../core/agent-loop/types";
import { applyFieldDisplayPlan } from "../../data-query/adapter";
import { buildQueryRunInput, toDisplayFact } from "../../data-query/query-fact";
import { upsertQueryRun } from "../../data-query/query-run-store";
import { executeSubQuestionWithBranches } from "../runtime/deep-analysis-tool";
import { createLogger } from "../../../logging/logger";
import { DEFAULT_ANALYSIS_CONCURRENCY, runWithConcurrency } from "../../../utils/concurrency";
import { buildModelDataView } from "../../../utils/model-data-view";
import { truncateText } from "../../../utils/prompt-context";
import {
  ANALYSIS_SUB_QUESTION_SOURCE_KIND,
  buildAnalysisSubQuestionTurnKey,
  runWithTurnContext,
} from "../../../logging/log-context";
import {
  expandQueryResultDatasetEntries,
  getQueryResultDataCount,
  type QueryResultDatasetEntry,
} from "../runtime/query-result";
import type { ChartDatasetCandidate } from "../../charts/chart-generator";
import type { DeepAnalysisArtifactStore } from "../task/artifacts";
import { tApp } from "../../../i18n";


const logger = createLogger("analysis-loop-evidence");

export const COLLECT_EVIDENCE_TOOL_NAME = "collect_evidence";

/** 一个问数问题本次取证的结果事实。 */
export interface LoopEvidenceResult extends AnalysisEvidenceQuestion {
  status: "completed" | "failed";
  dataCount: number;
  /** 本次证据的原始值数据集，只在运行时内部流转（图表能力使用），不进循环上下文 */
  datasets: QueryResultDatasetEntry[];
  /** 交给模型的展示值数据所见文本 */
  modelText: string;
}

export interface LoopEvidenceDeps {
  threadId: string;
  requestSeq: number;
  token: string;
  apiKey: string;
  userId: string;
  locale?: string;
  classNames?: string[];
  /** 本次运行登记迟到事实的位置；分析不呈现质检，登记后不等结算 */
  lateFacts: PendingLateFacts;
  /** 查询事实持久化；失败不阻断取证结果返回 */
  saveQueryRun: (input: {
    questionId: string;
    question: string;
    result: SubQuestionBranchResult;
    status: "completed" | "failed";
  }) => Promise<void>;
}

/**
 * 把一个问数问题的证据渲染成模型可见文本：只包含展示值数据所见，
 * 不包含原始行、DSL、思考状态等原始值载荷。
 */
export function buildEvidenceModelText(params: {
  index: number;
  questionId: string;
  question: string;
  status: "completed" | "failed";
  error?: string;
  /** 本次证据的原始值数据集；函数内部换算为展示值后才交给模型 */
  entries?: QueryResultDatasetEntry[];
  markdownTable?: string;
  locale?: string;
}): string {
  const { index, questionId, question, status, error, locale } = params;
  const entries = params.entries || [];
  const parts = [tApp("analysis.loop.evidence.250", { value: index + 1, question: question }), `questionId: ${questionId}`];

  if (status === "failed") {
    parts.push(tApp("analysis.loop.evidence.251", { value: error || tApp("analysis.dimension.report-generator.176") }));
    return parts.join("\n");
  }

  if (entries.length === 0) {
    if (params.markdownTable) {
      parts.push(tApp("analysis.loop.evidence.252", { truncateText: truncateText(params.markdownTable, 1500) }));
    } else {
      parts.push(tApp("analysis.loop.evidence.253"));
    }
    return parts.join("\n");
  }

  for (const entry of entries) {
    const displayRows = entry.fieldDisplayPlan
      ? applyFieldDisplayPlan(entry.data, entry.fieldDisplayPlan, locale)
      : entry.data;
    parts.push(
      tApp("analysis.loop.evidence.254", { title: entry.title, dataCount: entry.dataCount }),
      `dataView=${JSON.stringify(buildModelDataView(displayRows))}`
    );
  }

  return parts.join("\n");
}

/** 一批取证的并发上限，与维度形态的子问题查询同源，共享服务级问数额度。 */
export const LOOP_EVIDENCE_CONCURRENCY = Math.max(
  1,
  DEFAULT_ANALYSIS_CONCURRENCY.subQuestionQueryConcurrency ?? 1
);

/** 把取证工具、证据池、查询事实与主管/工人轨迹接线装配成一次运行内的取证能力。 */
export function assembleLoopEvidenceCapability(params: {
  threadId: string;
  requestSeq: number;
  token: string;
  apiKey: string;
  userId: string;
  locale?: string;
  classNames?: string[];
  signal: AbortSignal;
  trajectory: DeepAnalysisArtifactStore;
  /** 前几轮已经取得的证据；只用于让本轮参考，重新取证才会刷新数据。 */
  initialEvidence?: Map<string, { question: string; entries: QueryResultDatasetEntry[] }>;
  /** 本轮每个问题取证成功后的稳定引用，供后续轮次恢复证据。 */
  onEvidence?: (questionId: string, question: string) => void;
}) {
  const deps: LoopEvidenceDeps = {
    threadId: params.threadId,
    requestSeq: params.requestSeq,
    token: params.token,
    apiKey: params.apiKey,
    userId: params.userId,
    locale: params.locale,
    classNames: params.classNames,
    lateFacts: new PendingLateFacts(),
    saveQueryRun: ({ questionId, question, result, status }) =>
      upsertQueryRun(
        buildQueryRunInput({
          identity: {
            threadId: params.threadId,
            requestSeq: params.requestSeq,
            sourceKind: ANALYSIS_SUB_QUESTION_SOURCE_KIND,
            sourceRef: questionId,
            sourceStage: "analysis",
          },
          question,
          status,
          error: result.error,
          fact: {
            ...result,
            dataCount: result.dataCount ?? getQueryResultDataCount(result.data),
          },
        })
      ),
  };
  const evidence =
    params.initialEvidence ||
    new Map<string, { question: string; entries: QueryResultDatasetEntry[] }>();

  const createTool = (dispatchId?: string) =>
    createCollectEvidenceTool({
      deps,
      signal: params.signal,
      onAccepted: (questions) =>
        params.trajectory.start("evidence", {
          questions,
          ...(dispatchId ? { dispatchId } : {}),
        }),
      onThinking: (activityId, questionId, thinkingState) =>
        params.trajectory.thinking({
          activityId,
          questionId,
          thinkingState,
          thinking: thinkingState.summary,
          mode: "replace",
        }),
      onProgress: (activityId, questions) => params.trajectory.update(activityId, { questions }),
      onSettled: (activityId, results) => {
        for (const result of results) {
          params.onEvidence?.(result.questionId, result.question);
          evidence.set(result.questionId, {
            question: result.question,
            entries: result.datasets,
          });
        }
        const questions = results.map(
          ({ questionId, question, status, dataCount, error, execution }) => ({
            questionId,
            question,
            status,
            dataCount,
            error,
            execution,
          })
        );
        params.trajectory.settle(
          activityId,
          questions.some((question) => question.status === "completed") ? "completed" : "failed",
          { questions }
        );
      },
    });

  return {
    supervisorTool: createTool(),
    createWorkerTool: createTool,
    resolveEvidence: (questionId: string) => evidence.get(questionId),
    resolveChartCandidates: (questionIds: string[]): ChartDatasetCandidate[] =>
      questionIds.flatMap((questionId) => {
        const record = evidence.get(questionId);
        if (!record) return [];
        return record.entries.map((entry) => ({
          sourceSubQuestion:
            record.entries.length > 1 ? tApp("analysis.loop.evidence.255", { question: record.question, title: entry.title }) : record.question,
          sourceQuestionId: questionId,
          data: entry.data,
        }));
      }),
  };
}

/** 受限并发执行一批问数问题，单问失败收敛为该问失败结果。 */
export async function collectLoopEvidence(
  questions: Array<{ questionId: string; question: string }>,
  deps: LoopEvidenceDeps,
  signal: AbortSignal,
  onQuestionSettled: (result: LoopEvidenceResult) => void,
  onThinking?: (questionId: string, thinkingState: QueryThinkingState) => void
): Promise<LoopEvidenceResult[]> {
  const results = await runWithConcurrency<LoopEvidenceResult | Error>(
    questions.map(({ questionId, question }, index) => async () => {
      try {
        const { result: branchResult, pendingQualityCheck } = await runWithTurnContext(
          {
            threadId: deps.threadId,
            requestSeq: deps.requestSeq,
            turnKey: buildAnalysisSubQuestionTurnKey(deps.threadId, deps.requestSeq, questionId),
          },
          () =>
            executeSubQuestionWithBranches(
              { subQuestion: question },
              deps.token,
              deps.userId,
              signal,
              (state) => onThinking?.(questionId, state),
              deps.apiKey,
              deps.locale,
              deps.classNames,
              {
                threadId: deps.threadId,
                requestSeq: deps.requestSeq,
                sourceKind: ANALYSIS_SUB_QUESTION_SOURCE_KIND,
                sourceRef: questionId,
                sourceStage: "analysis",
              }
            )
        );
        // 分析的工作流、报告与运行呈现都不消费质检，登记后不等它结算。
        if (pendingQualityCheck) deps.lateFacts.register(pendingQualityCheck);

        const status = branchResult.status === "completed" ? "completed" : "failed";
        const entries =
          status === "completed"
            ? expandQueryResultDatasetEntries({
                data: branchResult.data,
                dsl: branchResult.dsl,
                datasets: branchResult.datasets,
                datasetPreviews: branchResult.datasetPreviews,
                baseTitle: question,
              })
            : [];

        // 查询事实是中间产物：持久化失败只记录，不把已取得的证据判为失败。
        try {
          await deps.saveQueryRun({ questionId, question, result: branchResult, status });
        } catch (error: unknown) {
          logger.error(tApp("analysis.loop.evidence.256"), {
            questionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        const result = {
          questionId,
          question,
          status,
          dataCount: branchResult.dataCount ?? getQueryResultDataCount(branchResult.data),
          error: status === "failed" ? branchResult.error : undefined,
          datasets: entries,
          execution: toDisplayFact(branchResult),
          modelText: buildEvidenceModelText({
            index,
            questionId,
            question,
            status,
            error: branchResult.error,
            entries,
            markdownTable: branchResult.markdownTable,
            locale: deps.locale,
          }),
        } satisfies LoopEvidenceResult;
        onQuestionSettled(result);
        return result;
      } catch (error: unknown) {
        if (signal.aborted) throw error;
        const message = error instanceof Error ? error.message : String(error);
        logger.error(tApp("analysis.loop.evidence.257"), {
          questionId,
          error: message,
        });
        const result = {
          questionId,
          question,
          status: "failed" as const,
          dataCount: 0,
          error: message,
          datasets: [],
          modelText: buildEvidenceModelText({
            index,
            questionId,
            question,
            status: "failed",
            error: message,
            locale: deps.locale,
          }),
        } satisfies LoopEvidenceResult;
        onQuestionSettled(result);
        return result;
      }
    }),
    LOOP_EVIDENCE_CONCURRENCY
  );

  // 并发池把抛出的异常收进结果位；取证只在取消时抛出，取消要原样中断整批。
  const aborted = results.find((item): item is Error => item instanceof Error);
  if (aborted) throw aborted;
  return results as LoopEvidenceResult[];
}

function parseQuestions(params: Record<string, unknown>): string[] {
  const raw = params.questions;
  if (!Array.isArray(raw)) {
    throw new Error(tApp("analysis.loop.evidence.258"));
  }
  const questions = raw.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (questions.length === 0) {
    throw new Error(tApp("analysis.loop.evidence.259"));
  }
  return questions;
}

/**
 * 取证工具。稳定身份在受理时分配，工具反馈只携带展示值数据所见。
 */
export function createCollectEvidenceTool(params: {
  deps: LoopEvidenceDeps;
  signal: AbortSignal;
  /** 受理一批问数问题时回调，用于登记轨迹活动 */
  onAccepted: (questions: AnalysisEvidenceQuestion[]) => string;
  /** 单个问数问题完成时回调，用于更新进行中的轨迹活动 */
  onProgress: (activityId: string, questions: AnalysisEvidenceQuestion[]) => void;
  /** 一批问数问题结算时回调，用于结算轨迹活动 */
  onSettled: (activityId: string, results: LoopEvidenceResult[]) => void;
  onThinking?: (activityId: string, questionId: string, thinkingState: QueryThinkingState) => void;
}): AgentTool {
  return {
    name: COLLECT_EVIDENCE_TOOL_NAME,
    description:
      tApp("analysis.loop.evidence.260"),
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: { type: "string" },
          description: tApp("analysis.loop.evidence.261"),
        },
      },
      required: ["questions"],
    },
    async execute(_toolCallId: string, toolParams: Record<string, unknown>) {
      params.signal.throwIfAborted();
      const questionTexts = parseQuestions(toolParams);
      const accepted = questionTexts.map((question) => ({
        questionId: uuidv4(),
        question,
        status: "running" as const,
      }));
      const activityId = params.onAccepted(accepted);
      const results = await collectLoopEvidence(
        accepted,
        params.deps,
        params.signal,
        (result) => {
          params.onProgress(activityId, [
            {
              questionId: result.questionId,
              question: result.question,
              status: result.status,
              dataCount: result.dataCount,
              error: result.error,
              execution: result.execution,
            },
          ]);
        },
        (questionId, thinkingState) => params.onThinking?.(activityId, questionId, thinkingState)
      );
      params.onSettled(activityId, results);

      const completedCount = results.filter((result) => result.status === "completed").length;
      const header = tApp("analysis.loop.evidence.262", { length: results.length, completedCount: completedCount, value: results.length - completedCount });

      return {
        content: [
          { type: "text", text: [header, ...results.map((r) => r.modelText)].join("\n\n") },
        ],
      } satisfies AgentToolResult;
    },
  };
}
