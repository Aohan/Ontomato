import type { EgressTextContent as TextContent } from "@ontomato/contracts/agent-egress";
import type {
  AgentMessage,
  AssistantMessage,
  ToolResultMessage,
} from "@ontomato/contracts/agent-messages";
export type {
  ImageContent,
  ThinkingContent,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  AgentMessage,
} from "@ontomato/contracts/agent-messages";

export interface AgentToolResult {
  content: TextContent[];
  details?: unknown;
  terminate?: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  executionMode?: "sequential" | "parallel";
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (partialResult: AgentToolResult) => void
  ): Promise<AgentToolResult>;
}

export interface AgentState {
  systemPrompt: string;
  messages: AgentMessage[];
  tools: AgentTool[];
  isStreaming: boolean;
}

/**
 * Observability identity for one agent execution. When present, every model
 * call made with this config is written to the shared agent-llm log.
 * `agentName` is the stable agent name; `agentRunId` is the explicit Run
 * identity of a single execution and is reused by every turn of that run, so
 * consumers never have to infer loop boundaries from round numbers or time.
 */
export interface LlmLogIdentity {
  agentName: string;
  agentRunId: string;
}

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  /** Platform-owned output cap for this resolved model. */
  maxTokens?: number;
  /** Validated provider-specific request fields forwarded to ChatOpenAI. */
  modelKwargs?: Record<string, unknown>;
  /** Omitted when the caller does not want this loop's calls logged. */
  llmLog?: LlmLogIdentity;
}

export interface AssistantStreamEvent {
  type:
    | "text_delta"
    | "thinking_delta"
    | "toolcall_start"
    | "toolcall_delta"
    | "toolcall_end"
    | "done"
    | "error";
  delta?: string;
  contentIndex?: number;
  partial?: AssistantMessage;
  error?: string;
}

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantStreamEvent }
  | { type: "message_end"; message: AgentMessage }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: AgentToolResult;
      isError: boolean;
    };

export type AgentEventListener = (event: AgentEvent) => void | Promise<void>;
