import type {
  QcResultState,
  QcState,
  QcStepEvent,
  QcStepState,
} from "@ontomato/contracts/query-thinking";
import type { ExecutionSnapshotStep, ResponseSnapshot, Message } from "../types/chat";
import type { DeepAnalysisTaskPayload } from "@ontomato/contracts/analysis-presentation";

export function buildExecutionStepId(name: string, kind: ExecutionSnapshotStep["kind"]): string {
  return `${kind}:${name}`;
}

export function hasMeaningfulSnapshot(snapshot?: ResponseSnapshot | null): boolean {
  if (!snapshot) return false;
  return Boolean(
    snapshot.primaryText ||
    snapshot.analysisText ||
    snapshot.turnKey ||
    snapshot.visualizationHTML ||
    snapshot.visualizationLoading ||
    snapshot.execution ||
    snapshot.clarification ||
    snapshot.executionSteps?.length ||
    // Deep analysis carries the deepAnalysis read model from the start; stopping at that point still leaves a "stopped" turn.
    snapshot.deepAnalysis
  );
}

export function finalizeSnapshotOnStop(
  snapshot: ResponseSnapshot,
  options?: { stoppedByUser?: boolean }
): ResponseSnapshot {
  // Thinking state only exists on execution facts; stop normalization lands on that single copy, with no second place to sync.
  const running = snapshot.execution?.thinkingState;
  const thinkingState = running
    ? {
        ...running,
        status: running.status === "running" ? "completed" : running.status,
        branches: (running.branches || []).map((branch) => ({
          ...branch,
          status: branch.status === "running" ? "cancelled" : branch.status,
        })),
        abc: running.abc
          ? {
              ...running.abc,
              status: running.abc.status === "running" ? "stopped" : running.abc.status,
              steps: running.abc.steps.map((step) => ({
                ...step,
                active: false,
                status: step.status === "running" ? "stopped" : step.status,
              })),
            }
          : running.abc,
      }
    : undefined;

  const deepAnalysis: DeepAnalysisTaskPayload | undefined = snapshot.deepAnalysis
    ? {
        ...snapshot.deepAnalysis,
        runState:
          snapshot.deepAnalysis.runState.status === "running"
            ? { ...snapshot.deepAnalysis.runState, status: "cancelled" }
            : snapshot.deepAnalysis.runState,
      }
    : undefined;

  const executionSteps: ExecutionSnapshotStep[] = (snapshot.executionSteps || []).map((step) => ({
    ...step,
    status: step.status === "running" ? "stopped" : step.status,
  }));

  return {
    ...snapshot,
    status: "completed",
    stoppedByUser: options?.stoppedByUser ?? true,
    visualizationLoading: false,
    execution: snapshot.execution ? { ...snapshot.execution, thinkingState } : snapshot.execution,
    deepAnalysis,
    executionSteps,
  };
}

export function hasInFlightSnapshotState(snapshot?: ResponseSnapshot | null): boolean {
  if (!snapshot) return false;
  if (snapshot.deepAnalysis) return snapshot.deepAnalysis.runState.status === "running";

  if (snapshot.status === "streaming") return true;
  if (snapshot.visualizationLoading) return true;
  if (snapshot.executionSteps?.some((step) => step.status === "running")) return true;
  const thinking = snapshot.execution?.thinkingState;
  if (thinking?.status === "running") return true;
  if (thinking?.branches?.some((branch) => branch.status === "running")) return true;
  if (
    thinking?.abc?.status === "running" ||
    thinking?.abc?.steps?.some((step) => step.status === "running" || step.status === "waiting")
  ) {
    return true;
  }

  return false;
}

export function normalizeHistorySnapshot(snapshot: ResponseSnapshot): ResponseSnapshot {
  if (snapshot.mode === "deep-analysis") return { ...snapshot, source: "history" };
  if (snapshot.stoppedByUser || hasInFlightSnapshotState(snapshot)) {
    return finalizeSnapshotOnStop(snapshot, { stoppedByUser: !!snapshot.stoppedByUser });
  }

  return {
    ...snapshot,
    status: snapshot.status === "failed" ? "failed" : "completed",
    source: "history",
    visualizationLoading: false,
  };
}

export function buildQcStateFromResult(
  qcResult?: QcResultState & { steps?: Pick<QcStepEvent, "summary" | "meaning">[] }
): QcState | undefined {
  if (!qcResult) return undefined;

  const hasResult =
    qcResult.conclusion !== undefined ||
    qcResult.score !== undefined ||
    qcResult.fittedQuestion !== undefined;

  return {
    status: hasResult ? "completed" : "running",
    steps: (qcResult.steps || []).map((step, index) => ({
      summary: step.summary,
      meaning: step.meaning,
      status: "done" as QcStepState["status"],
      timestamp: Date.now() + index,
    })),
    result: hasResult
      ? {
          conclusion: qcResult.conclusion,
          score: qcResult.score,
          fittedQuestion: qcResult.fittedQuestion,
        }
      : undefined,
  };
}

export function buildAssistantMessage(snapshot: ResponseSnapshot): Message {
  return {
    id: Date.now(),
    role: "assistant",
    content: snapshot.primaryText,
    snapshot,
  };
}
