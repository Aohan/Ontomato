import type { RunCancelledEvent, RunNotFoundEvent } from "./chat";
import type { SseErrorEvent } from "./errors";
import type { QueryThinkingState } from "./query-thinking";
import type { AnalysisActivity, AnalysisRunState, AnalysisSection } from "./analysis-presentation";
import type { AnalysisChartResult, AnalysisChartDiagnostic } from "./analysis-charts";

export type DeepAnalysisClientEvent =
  | {
      type: "analysis_run_state";
      executionMode: "dimension" | "loop";
      content: AnalysisRunState;
      timestamp: number;
    }
  | { type: "analysis_activity"; content: AnalysisActivity; timestamp: number }
  | {
      type: "analysis_section";
      content: AnalysisSection & { mode: "append" | "replace"; offset: number };
      timestamp: number;
    }
  | {
      type: "analysis_charts";
      content: {
        scopeId: string;
        charts: AnalysisChartResult[];
        diagnostics: AnalysisChartDiagnostic[];
      };
      timestamp: number;
    };

export type DeepAnalysisClientEventType = DeepAnalysisClientEvent["type"];

export type AnalysisRunEvent =
  | { type: "run_started"; runId: string; taskId: string; threadId: string; timestamp: number }
  | { type: "title"; title: string }
  | { type: "workflow_complete"; timestamp: number }
  | { type: "auth_failed"; content: string; timestamp: number }
  | SseErrorEvent;

export type AnalysisTaskLifecycleEvent =
  | {
      type: "task_completed";
      taskId: string;
      resultSummary: string;
      resultReport: string;
      finalAnswer?: string;
      timestamp: number;
    }
  | {
      type: "task_failed";
      taskId: string;
      error: string;
      resultSummary?: string;
      timestamp: number;
    }
  | {
      type: "task_cancelled";
      taskId: string;
      resultSummary?: string;
      timestamp: number;
    };

export type AnalysisFollowUpEvent =
  | Omit<Extract<AnalysisRunEvent, { type: "run_started" }>, "taskId">
  | Extract<AnalysisRunEvent, { type: "workflow_complete" | "error" }>
  | { type: "follow_up_chunk"; content: string };

/** 查询执行层的思考态以活动和问题身份定位，不暴露循环 Agent 的思考链。 */
export type DeepAnalysisThinkingStateEvent = {
  type: "thinking_state";
  node: "analysis";
  content: {
    thinking: string;
    mode: "replace";
    thinkingState: QueryThinkingState;
    activityId: string;
    questionId: string;
  };
  timestamp: number;
};

/**
 * 受理回合序号：常规会话的事件携带它标注所属回合，页面据此丢弃迟到回合的事件；
 * 报告任务的事件可以缺省该字段。
 */
export interface AnalysisTurnScope {
  requestSeq?: number;
}

export type DeepAnalysisEmittedEvent = (
  | DeepAnalysisClientEvent
  | DeepAnalysisThinkingStateEvent
  | SseErrorEvent
) &
  AnalysisTurnScope;

export type AnalysisStreamEvent = (
  | DeepAnalysisEmittedEvent
  | AnalysisRunEvent
  | AnalysisTaskLifecycleEvent
  | AnalysisFollowUpEvent
  | RunCancelledEvent
  | RunNotFoundEvent
) &
  AnalysisTurnScope;
