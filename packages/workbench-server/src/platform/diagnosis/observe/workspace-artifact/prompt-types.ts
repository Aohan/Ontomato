export interface UnifiedToolCall {
  id?: string;
  name?: string;
  arguments?: string;
}

export interface UnifiedMessage {
  role: string;
  reasoningContent?: string;
  text?: string;
  toolCalls?: UnifiedToolCall[];
  toolCallId?: string;
  toolName?: string;
  truncated?: boolean;
}

export interface UnifiedTranscriptRound {
  round: number;
  originalRound?: number;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  status?: string;
  model?: string;
  tokens?: Record<string, number>;
  incrementalMessages: UnifiedMessage[];
  outputReasoningContent?: string;
  outputText?: string;
  outputToolCalls: UnifiedToolCall[];
  finishReason?: string;
  error?: string;
}

export interface UnifiedConversation {
  agentId: string;
  displayName: string;
  source: "data-agent" | "ontomato" | "agent-llm";
  slotId: "front" | "s1";
  order: number;
  durationMs?: number;
  rounds: UnifiedTranscriptRound[];
  meta: Record<string, unknown>;
}
