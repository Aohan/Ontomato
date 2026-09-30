/**
 * Which query questions make up one analysis task run, and its readable final reply.
 *
 * An analysis task is an instance of a "composite run": one run = its own evidence + several sub-Turn evidences.
 * The sub-Turn list is always expanded from the questions in the task activities; callers never depend on the execution form.
 */

import { parseTurnKey } from "../../../logging/log-context";
import { getAnalysisTaskService } from "../task/task-service";
import { buildDeepAnalysisTaskSnapshot } from "../task/task-result";

import type { AnalysisTask } from "../task-types";
import type { DeepAnalysisTaskPayload } from "@ontomato/contracts/analysis-presentation";

/** One query question in a run: stable identity, display text, and business execution state. */
export interface AnalysisRunQuestion {
  /** Stable identity, identical to the query run's sourceRef */
  questionId: string;
  /** Display text; never used for correlation */
  question: string;
  /** Business execution state of the question, independent of diagnosis artifact states */
  status: string;
}

/** Composition of one analysis task run. */
export interface AnalysisRunComposition {
  taskId: string;
  agentId: string;
  threadId: string;
  requestSeq: number;
  /** The user question of this run */
  question: string;
  /** The readable final reply of this run; empty when there is no readable report */
  report?: string;
  /** Query questions in acceptance order */
  questions: AnalysisRunQuestion[];
}

/**
 * Resolves whether a Turn is an analysis task run; returns null when it is not.
 * Sub-Turn identities (turnKeys carrying a source type) are never run entries and always resolve to null.
 */
export async function resolveAnalysisRunComposition(
  turnKey: string
): Promise<AnalysisRunComposition | null> {
  const identity = parseTurnKey(turnKey);
  if (!identity || identity.sourceKind) return null;

  const task = await getAnalysisTaskService().getTaskByThreadAndRequestSeq(
    identity.threadId,
    identity.requestSeq
  );
  if (!task) return null;

  const payload = task.analysisPayload;
  const questions =
    payload?.activities.flatMap((activity) =>
      (activity.questions || []).map(({ questionId, question, status }) => ({
        questionId,
        question,
        status,
      }))
    ) || [];

  return {
    taskId: task.id,
    agentId: task.agentId,
    threadId: identity.threadId,
    requestSeq: identity.requestSeq,
    question: task.question || task.name || "",
    report: resolveReport(task, payload),
    questions,
  };
}

/** The readable final reply uses the task domain's existing review constructor; it is never inferred from thread messages or reply snapshots. */
function resolveReport(task: AnalysisTask, payload?: DeepAnalysisTaskPayload): string | undefined {
  if (!payload) return undefined;
  const snapshot = buildDeepAnalysisTaskSnapshot({
    taskId: task.id,
    threadId: task.threadId,
    status: task.status,
    requestSeq: task.requestSeq,
    payload,
    fallbackText: task.resultReport || task.resultSummary,
  });
  return snapshot.primaryText || undefined;
}
