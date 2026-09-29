import type {
  EgressTextContent,
  EgressToolCallContent,
  EgressUsage,
  EgressUserMessage,
  EgressAssistantMessage,
  EgressToolResultMessage,
  EgressMessage,
} from "@ontomato/contracts/agent-egress";
import type { AgentMessage, AssistantMessage, ToolResultMessage, UserMessage } from "./types";

/** The single exposure level the current external consumers need. */
export interface EgressMessageOptions {
  thinking: "omit";
  toolResultContent: "full";
}

function toEgressText(content: EgressTextContent): EgressTextContent {
  return { type: "text", text: content.text };
}

function toEgressUserMessage(message: UserMessage): EgressUserMessage {
  return {
    role: "user",
    content: message.content.flatMap((part) => (part.type === "text" ? [toEgressText(part)] : [])),
    ...(message.timestamp === undefined ? {} : { timestamp: message.timestamp }),
  };
}

function toEgressUsage(usage: EgressUsage): EgressUsage {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    totalTokens: usage.totalTokens,
  };
}

function toEgressAssistantMessage(message: AssistantMessage): EgressAssistantMessage {
  return {
    role: "assistant",
    content: message.content.flatMap<EgressTextContent | EgressToolCallContent>((part) => {
      if (part.type === "text") return [toEgressText(part)];
      if (part.type === "toolCall") return [toEgressToolCall(part)];
      return [];
    }),
    ...(message.stopReason === undefined ? {} : { stopReason: message.stopReason }),
    ...(message.errorMessage === undefined ? {} : { errorMessage: message.errorMessage }),
    ...(message.usage === undefined ? {} : { usage: toEgressUsage(message.usage) }),
    ...(message.timestamp === undefined ? {} : { timestamp: message.timestamp }),
  };
}

function toEgressToolCall(content: EgressToolCallContent): EgressToolCallContent {
  return {
    type: "toolCall",
    id: content.id,
    name: content.name,
    arguments: content.arguments,
  };
}

function toEgressToolResultMessage(
  message: ToolResultMessage,
  options: EgressMessageOptions
): EgressToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    content: options.toolResultContent === "full" ? message.content.map(toEgressText) : [],
    ...(message.terminate === undefined ? {} : { terminate: message.terminate }),
    ...(message.timestamp === undefined ? {} : { timestamp: message.timestamp }),
  };
}

/** Builds consumer-facing messages from the allowlist; undeclared fields never enter the return value. */
export function toEgressMessages(
  messages: readonly AgentMessage[],
  options: EgressMessageOptions
): EgressMessage[] {
  return messages.map((message) => {
    if (message.role === "user") return toEgressUserMessage(message);
    if (message.role === "assistant") return toEgressAssistantMessage(message);
    return toEgressToolResultMessage(message, options);
  });
}
