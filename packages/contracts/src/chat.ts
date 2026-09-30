import type { SseErrorEvent } from "./errors";
import type { QueryThinkingState, ThinkingProgress, ThinkingStep, QcState } from "./query-thinking";
import type { QueryExecutionDisplayFact } from "./query-execution";
export interface ClarificationOption {
  id: string;
  resolvedQuestion: string;
}

/** Wire shape of the standard query projection sent directly over the HTTP stream. */
export type ChatClientEvent =
  | SseErrorEvent
  | RunCancelledEvent
  | RunNotFoundEvent
  | {
      type: "run_started";
      runId: string;
      threadId: string;
      turnKey?: string;
      requestSeq?: number;
      timestamp: number;
    }
  | { type: "turn_key"; turnKey: string; threadId: string; requestSeq: number; timestamp: number }
  | { type: "title"; title: string }
  | {
      type: "workflow_complete";
      plan?: unknown;
      hasQuery: boolean;
      hasAnalysis: boolean;
      hasVisualization: boolean;
    }
  | { type: "auth_failed"; error: string }
  | { type: "token" | "analysis_token"; content: string }
  | { type: "thinking_state"; thinking: string; thinkingState?: QueryThinkingState }
  | {
      type: "thinking_summary";
      thinkingSummary: string;
      thinkingSteps?: ThinkingStep[];
      thinkingState?: QueryThinkingState;
    }
  | { type: "abc_progress"; progress: ThinkingProgress }
  | { type: "abc_content"; content: string; loading?: boolean }
  | AbcAnalysisEvent
  | { type: "abc_analysis"; [key: string]: unknown }
  | {
      type: "result";
      content:
        | string
        | { markdownTable?: string; content?: string; execution?: QueryExecutionDisplayFact };
    }
  | { type: "query_datasets"; datasets: unknown[]; nodeIds: string[] }
  | { type: "post_thinking"; content: string; label?: string; mode?: string; qcState?: QcState }
  | { type: "clarification"; message: string; options: ClarificationOption[] }
  | { type: "chain_start"; name: string; icon: string; description?: string }
  | { type: "visualization_html"; html: string; chartType?: string; title?: string };

export interface RunCancelledEvent {
  type: "run_cancelled";
  timestamp: number;
  turnKey?: string;
  threadId?: string;
  requestSeq?: number;
}

export interface RunNotFoundEvent {
  type: "run_not_found";
  timestamp: number;
}

export interface AbcAnalysisEvent {
  type: "abc_analysis_start" | "abc_analysis_chunk" | "abc_analysis_done";
  subQuestion?: string;
  content?: string;
}

export type ThreadMessagesPayload = {
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    requestSeq?: number;
    snapshot?: unknown;
  }>;
  activeTurn?: {
    requestSeq: number;
  };
};

export interface ThreadListItem {
  threadId: string;
  title: string;
  messageCount: number;
  updatedAt: string;
  createdAt: string;
  lastCheckpointId: string | null;
}
export interface ThreadListResponse {
  threads: ThreadListItem[];
  total: number;
}
