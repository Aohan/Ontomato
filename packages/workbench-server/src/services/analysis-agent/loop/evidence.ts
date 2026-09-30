import type { QueryThinkingState } from "@ontomato/contracts/query-thinking";
import type { AnalysisEvidenceQuestion } from "@ontomato/contracts/analysis-presentation";
/**
 * Evidence capability of the loop form: hands a batch of query questions to the report evidence access layer to obtain current data evidence.
 *
 * One request may carry several query questions, executed under the concurrency limit; a single question's failure converges into that question's
 * failed result without interrupting the loop. Only the display-value data view is returned to the model; raw values never enter the loop context.
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

/** Result facts of one query question's evidence collection this time. */
export interface LoopEvidenceResult extends AnalysisEvidenceQuestion {
  status: "completed" | "failed";
  dataCount: number;
  /** The raw-value dataset of this evidence, flowing only inside the runtime (used by the chart capability), never entering the loop context */
  datasets: QueryResultDatasetEntry[];
  /** Display-value data view text handed to the model */
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
  /** Where this run registers late facts; analysis never presents the quality check and does not wait for settlement after registering */
  lateFacts: PendingLateFacts;
  /** Query fact persistence; its failure never blocks returning the evidence results */
  saveQueryRun: (input: {
    questionId: string;
    question: string;
    result: SubQuestionBranchResult;
    status: "completed" | "failed";
  }) => Promise<void>;
}

/**
 * Renders one query question's evidence into model-visible text: only the display-value data view,
 * never raw payloads such as raw rows, DSL, or thinking states.
 */
export function buildEvidenceModelText(params: {
  index: number;
  questionId: string;
  question: string;
  status: "completed" | "failed";
  error?: string;
  /** The raw-value dataset of this evidence; converted to display values inside the function before reaching the model */
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

/** Concurrency limit of one evidence batch, sourced from the dimension form's sub-question query limit, sharing the service-level query quota. */
export const LOOP_EVIDENCE_CONCURRENCY = Math.max(
  1,
  DEFAULT_ANALYSIS_CONCURRENCY.subQuestionQueryConcurrency ?? 1
);

/** Assembles the evidence tool, evidence pool, query facts, and supervisor/worker trajectory wiring into one run's evidence capability. */
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
  /** Evidence already collected in earlier turns; for this turn's reference only, and only fresh evidence collection refreshes the data. */
  initialEvidence?: Map<string, { question: string; entries: QueryResultDatasetEntry[] }>;
  /** Stable reference recorded after each question's evidence succeeds this turn, for later turns to restore evidence. */
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

/** Executes a batch of query questions under bounded concurrency; a single question's failure converges into that question's failed result. */
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
        // Analysis workflows, reports, and run presentation never consume the quality check; after registering we do not wait for its settlement.
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

        // Query facts are intermediate products: a persistence failure is only logged and never marks collected evidence as failed.
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

  // The concurrency pool catches thrown exceptions into result slots; evidence collection throws only on cancellation, and cancellation must interrupt the whole batch as-is.
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
 * Evidence collection tool. Stable identities are assigned at acceptance; tool feedback carries only the display-value data view.
 */
export function createCollectEvidenceTool(params: {
  deps: LoopEvidenceDeps;
  signal: AbortSignal;
  /** Invoked when a batch of query questions is accepted, to register the trajectory activity */
  onAccepted: (questions: AnalysisEvidenceQuestion[]) => string;
  /** Invoked when one query question completes, to update the in-progress trajectory activity */
  onProgress: (activityId: string, questions: AnalysisEvidenceQuestion[]) => void;
  /** Invoked when a batch of query questions settles, to finalize the trajectory activity */
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
