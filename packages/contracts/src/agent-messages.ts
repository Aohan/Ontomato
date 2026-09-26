import type {
  EgressTextContent as TextContent,
  EgressToolCallContent as ToolCallContent,
  EgressUsage as Usage,
} from "./agent-egress";

export interface ImageContent {
  type: "image";
  url: string;
}

export interface ThinkingContent {
  type: "thinking";
  text: string;
}

export interface UserMessage {
  role: "user";
  content: (TextContent | ImageContent)[];
  timestamp?: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCallContent)[];
  stopReason?: "stop" | "tool_calls" | "error" | "aborted";
  errorMessage?: string;
  /**
   * Provider-reported token usage for this turn, when available. Used by the
   * compaction subsystem to decide when to compress context (real usage is
   * preferred over the character heuristic). Absent on error/aborted turns.
   */
  usage?: Usage;
  timestamp?: number;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: TextContent[];
  isError?: boolean;
  /**
   * Carried over from {@link AgentToolResult.terminate}. When true, the agent
   * loop finishes the current tool batch and then stops the ReAct loop instead
   * of sending the results back to the LLM for another turn.
   */
  terminate?: boolean;
  timestamp?: number;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;
