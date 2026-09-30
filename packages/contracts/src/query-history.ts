import type { QueryThinkingState, QcState } from "./query-thinking";

/** HTTP history projection; persisted eventType values remain open strings. */
export interface QueryHistoryChainItem {
  type: string;
  name: string;
  icon?: string;
}

export interface QueryHistoryTimelineStep extends QueryHistoryChainItem {
  status: string;
  thinkingSummary: string | null;
  thinkingState: QueryThinkingState | null;
  qcState: QcState | null;
  input: null;
  output: { markdownTable?: string; datasets?: unknown } | null;
  dsl?: string;
  ir?: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
  error?: string;
  timestamp: number;
}
