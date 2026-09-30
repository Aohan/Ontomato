import type { AnalysisStreamEvent } from "@ontomato/contracts/analysis-events";
import type { DeepAnalysisTaskPayload } from "@ontomato/contracts/analysis-presentation";
import type { ResponseSnapshot } from "../../../types/chat";
import { workbenchContent } from "../../../content";

/** Objects merge by stable identity and revision; lifecycle events don't rewrite activities, and stop closure is owned by the server. */
export function reduceDeepAnalysisEvent(
  current: ResponseSnapshot | null,
  event: AnalysisStreamEvent
): ResponseSnapshot | null {
  const snapshot: ResponseSnapshot = current || {
    mode: "deep-analysis",
    status: "streaming",
    source: "live",
    primaryText: "",
  };
  let data: DeepAnalysisTaskPayload = snapshot.deepAnalysis || {
    executionMode: "dimension",
    runState: { status: "running", revision: -1, progress: { done: 0, label: "" } },
    activities: [],
    sections: [],
    charts: [],
    chartDiagnostics: [],
  };
  switch (event.type) {
    case "analysis_run_state": {
      const next = event.content;
      if (
        next.revision <= data.runState.revision ||
        (data.runState.status !== "running" && next.status === "running")
      )
        return snapshot;
      data = {
        ...data,
        executionMode: event.executionMode,
        runState: {
          ...next,
          progress: {
            ...next.progress,
            done: Math.max(data.runState.progress.done, next.progress.done),
          },
        },
      };
      break;
    }
    case "analysis_activity": {
      const next = event.content;
      if (
        !next?.activityId ||
        !Number.isFinite(next.seq) ||
        !Number.isFinite(next.revision) ||
        !["running", "completed", "failed", "cancelled"].includes(next.status)
      ) {
        console.warn(workbenchContent().console.analysisActivityInvalid, event);
        return null;
      }
      const previous = data.activities.find((a) => a.activityId === next.activityId);
      if (
        previous &&
        (previous.revision >= next.revision ||
          (previous.status !== "running" && next.status === "running"))
      )
        return snapshot;
      if (data.runState.status !== "running" && next.status === "running") return snapshot;
      data = {
        ...data,
        activities: [...data.activities.filter((a) => a.activityId !== next.activityId), next].sort(
          (a, b) => a.seq - b.seq
        ),
      };
      break;
    }
    case "thinking_state": {
      if (data.runState.status !== "running") return snapshot;
      data = {
        ...data,
        activities: data.activities.map((a) =>
          a.activityId !== event.content.activityId
            ? a
            : {
                ...a,
                questions: a.questions?.map((q) =>
                  q.questionId !== event.content.questionId || q.status !== "running"
                    ? q
                    : {
                        ...q,
                        execution: { ...q.execution, thinkingState: event.content.thinkingState },
                      }
                ),
              }
        ),
      };
      break;
    }
    case "analysis_section": {
      const { mode, offset, ...next } = event.content;
      const previous = data.sections.find((s) => s.sectionId === next.sectionId);
      if (previous && (previous.revision >= next.revision || (previous.status && !next.status)))
        return snapshot;
      // SSE is transmitted in order; reconnect duplicate increments are deduplicated by position, and gaps wait for the full section terminal state to repair.
      if (mode === "append") {
        if (data.runState.status !== "running" || offset > (previous?.markdown.length || 0))
          return snapshot;
        next.markdown = (previous?.markdown || "").slice(0, offset) + next.markdown;
      }
      data = {
        ...data,
        sections: [...data.sections.filter((s) => s.sectionId !== next.sectionId), next].sort(
          (a, b) => a.order - b.order
        ),
      };
      break;
    }
    case "analysis_charts": {
      const { charts, diagnostics } = event.content;
      data = {
        ...data,
        charts: [...new Map([...data.charts, ...charts].map((c) => [c.chartId, c])).values()],
        chartDiagnostics: [
          ...new Map(
            [...data.chartDiagnostics, ...diagnostics].map((d) => [
              JSON.stringify([d.scopeId, d.reason, d.message, d.severity]),
              d,
            ])
          ).values(),
        ],
      };
      break;
    }
    case "task_completed":
    case "task_failed":
    case "task_cancelled":
    case "run_cancelled": {
      const status =
        event.type === "task_completed"
          ? "completed"
          : event.type === "task_failed"
            ? "failed"
            : "cancelled";
      data = {
        ...data,
        ...(event.type === "task_completed" && event.finalAnswer !== undefined
          ? { finalAnswer: event.finalAnswer }
          : {}),
        runState: {
          ...data.runState,
          status,
          ...(event.type === "task_failed" ? { error: event.error } : {}),
        },
      };
      break;
    }
    case "run_started":
      return { ...snapshot, runId: event.runId };
    case "workflow_complete":
      return snapshot;
    case "title":
    case "auth_failed":
    case "error":
    case "follow_up_chunk":
    case "run_not_found":
      return null;
    default: {
      const exhaustive: never = event;
      console.warn(workbenchContent().console.analysisEventUnknown, exhaustive);
      return null;
    }
  }
  return {
    ...snapshot,
    deepAnalysis: data,
    primaryText:
      event.type === "task_completed"
        ? event.finalAnswer || event.resultReport || snapshot.primaryText
        : snapshot.primaryText,
    status:
      data.runState.status === "running"
        ? "streaming"
        : data.runState.status === "completed"
          ? "completed"
          : "failed",
  };
}
