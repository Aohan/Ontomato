import type { AnalysisTaskStatus } from "@ontomato/contracts/analysis-task";
import type {
  AnalysisTaskLifecycleEvent,
  AnalysisTurnScope,
} from "@ontomato/contracts/analysis-events";

export type AnalysisTaskTerminalStatus = Extract<
  AnalysisTaskStatus,
  "completed" | "failed" | "cancelled"
>;

export function isAnalysisTaskTerminalStatus(
  status: AnalysisTaskStatus
): status is AnalysisTaskTerminalStatus {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function buildAnalysisTaskTerminalEvent(input: {
  taskId: string;
  status: AnalysisTaskTerminalStatus;
  resultSummary?: string;
  resultReport?: string;
  finalAnswer?: string;
  error?: string;
  /** The acceptance turn this terminal state belongs to; subscribers filtering by turn receive this terminal state only through it. */
  requestSeq?: number;
}): AnalysisTaskLifecycleEvent & AnalysisTurnScope {
  const timestamp = Date.now();
  const turn = input.requestSeq !== undefined ? { requestSeq: input.requestSeq } : {};
  if (input.status === "completed") {
    return {
      type: "task_completed",
      taskId: input.taskId,
      resultSummary: input.resultSummary || "",
      resultReport: input.resultReport || "",
      ...(input.finalAnswer !== undefined ? { finalAnswer: input.finalAnswer } : {}),
      ...turn,
      timestamp,
    };
  }
  if (input.status === "failed") {
    return {
      type: "task_failed",
      taskId: input.taskId,
      error: input.error || input.resultSummary || "",
      ...(input.resultSummary ? { resultSummary: input.resultSummary } : {}),
      ...turn,
      timestamp,
    };
  }
  return {
    type: "task_cancelled",
    taskId: input.taskId,
    ...(input.resultSummary ? { resultSummary: input.resultSummary } : {}),
    ...turn,
    timestamp,
  };
}

export function isAnalysisTaskLifecycleEvent(event: unknown): event is AnalysisTaskLifecycleEvent {
  if (!event || typeof event !== "object") return false;
  const type = (event as { type?: unknown }).type;
  return typeof type === "string" && type.startsWith("task_");
}
