import type { PostProcessSeverity, ParsedLogSource, LogLevel } from "@ontomato/contracts/observe";
/* ------------------------------------------------------------------ */
/*  Observe module shared types                                       */
/* ------------------------------------------------------------------ */

// ---- Workspace Post-processing Status ------------------------------

export type PostProcessItemStatus = "ok" | "empty" | "skipped" | "failed";

export interface PostProcessStatusItem {
  status: PostProcessItemStatus;
  severity: PostProcessSeverity;
  message: string;
  details?: Record<string, unknown>;
}

export interface PostProcessStatusFile {
  workspaceId: string;
  createdAt: string;
  overallStatus: "ok" | "degraded" | "failed";
  overallSeverity: PostProcessSeverity;
  message: string;
  items: Record<string, PostProcessStatusItem>;
}

// ---- Log Query Parameters ------------------------------------------

export interface LogQueryParams {
  turnKey?: string;
  taskId?: string;
  sessionId?: string;
  level?: LogLevel;
  keyword?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
}

export interface LlmQueryParams {
  turnKey?: string;
  taskId?: string;
  agentName?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
}

export interface BackendLogQueryParams {
  turnKey?: string;
  keyword?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
}

// ---- Live Log Filter -----------------------------------------------

export interface LiveLogFilter {
  source?: ParsedLogSource[];
  level?: LogLevel[];
  turnKey?: string;
  taskId?: string;
  keyword?: string;
  sinceSeq?: number;
}
