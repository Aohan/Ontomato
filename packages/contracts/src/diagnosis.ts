import type { SseErrorEvent } from "./errors";
export type DiagnosisResponseTerminalStatus = "completed" | "failed" | "cancelled";

export type DiagnosisStreamEvent =
  | { type: "response_started"; message: string }
  | { type: "token"; content: string }
  | { type: "thinking"; content: string }
  | {
      type: "tool_start";
      toolCallId: string;
      tool: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_end";
      toolCallId: string;
      tool: string;
      result: unknown;
      isError: boolean;
    }
  | {
      type: "response_end";
      status: Exclude<DiagnosisResponseTerminalStatus, "failed">;
    }
  | { type: "response_unavailable" }
  | SseErrorEvent;

export type SessionContextPage = "observe" | "autotest" | "general";

export interface SessionContext {
  /** Page/module the user was looking at when the diagnosis session was created. */
  page: SessionContextPage;
  /** Target key: observe -> turnKey; autotest case artifact -> runId/caseId. */
  targetKey?: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  createdAt: string;
  context?: SessionContext;
  responseStatus: "idle" | "running";
}

export interface SessionHistorySnapshot {
  messages: SessionHistoryMessage[];
  responseStatus: "idle" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
}

export type SessionHistoryToolSegment = {
  type: "tool_call";
  toolCallId: string;
  tool: string;
  args: string;
  result?: unknown;
  isError?: boolean;
  status: "running" | "done";
};

export type SessionHistoryMessage = {
  role: "user" | "assistant";
  content: string;
  segments?: (
    | { type: "text"; content: string }
    | { type: "thinking"; content: string }
    | SessionHistoryToolSegment
  )[];
};

export type KnowledgeNodeType = "directory" | "file";

export interface KnowledgeTreeNode {
  name: string;
  path: string;
  type: KnowledgeNodeType;
  hasIndex?: boolean;
  indexPath?: string;
  children?: KnowledgeTreeNode[];
}

export interface KnowledgeMarkdownFile {
  path: string;
  title: string;
  content: string;
  updatedAt: string;
}

export interface KnowledgeTreeResponse {
  rootPath: string;
  indexPath: string;
  tree: KnowledgeTreeNode;
}

export interface SessionStopResult {
  cancelled: boolean;
}

export type SessionHistorySegment = NonNullable<SessionHistoryMessage["segments"]>[number];
