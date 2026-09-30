export interface EgressTextContent {
  type: "text";
  text: string;
}

export interface EgressToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface EgressUserMessage {
  role: "user";
  content: EgressTextContent[];
  timestamp?: number;
}

export interface EgressUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface EgressAssistantMessage {
  role: "assistant";
  content: (EgressTextContent | EgressToolCallContent)[];
  stopReason?: "stop" | "tool_calls" | "error" | "aborted";
  errorMessage?: string;
  usage?: EgressUsage;
  timestamp?: number;
}

export interface EgressToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: EgressTextContent[];
  terminate?: boolean;
  timestamp?: number;
}

export type EgressMessage = EgressUserMessage | EgressAssistantMessage | EgressToolResultMessage;
