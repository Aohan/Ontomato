import { BaseMessage } from "@langchain/core/messages";
import { boundPromptMessages } from "../../../../utils/prompt-context";

type AgentPromptHistoryMode = "user-only" | "conversation";

export type AgentPromptMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const USER_HISTORY_LIMITS = {
  maxMessages: 4,
  maxCharsPerMessage: 600,
  maxTotalChars: 1800,
};

const CONVERSATION_HISTORY_LIMITS = {
  maxMessages: 4,
  maxCharsPerMessage: 500,
  maxTotalChars: 1600,
};

function toPriorUserMessages(messages: BaseMessage[]): Array<{ role: "user"; content: string }> {
  return messages
    .filter((msg) => msg._getType() === "human")
    .map((msg) => ({
      role: "user" as const,
      content: String(msg.content || ""),
    }))
    .filter((msg) => msg.content.trim().length > 0);
}

function toPriorConversationMessages(
  messages: BaseMessage[]
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((msg) => msg._getType() === "human" || msg._getType() === "ai")
    .map((msg) => ({
      role: (msg._getType() === "human" ? "user" : "assistant") as "user" | "assistant",
      content: String(msg.content || ""),
    }))
    .filter((msg) => msg.content.trim().length > 0);
}

export function resolveAgentPromptHistory(
  config: any,
  fallbackMessages: BaseMessage[] = []
): { messages: BaseMessage[]; historyIncludesCurrentTurn: boolean } {
  const configuredPriorMessages = config?.configurable?.priorMessages;
  if (Array.isArray(configuredPriorMessages)) {
    return {
      messages: configuredPriorMessages,
      historyIncludesCurrentTurn: false,
    };
  }

  return {
    messages: fallbackMessages,
    historyIncludesCurrentTurn: true,
  };
}

export function buildAgentPromptMessages({
  systemPrompt,
  currentUserContent,
  priorMessages = [],
  historyMode = "user-only",
  historyIncludesCurrentTurn = false,
}: {
  systemPrompt: string;
  currentUserContent: string;
  priorMessages?: BaseMessage[];
  historyMode?: AgentPromptHistoryMode;
  historyIncludesCurrentTurn?: boolean;
}): AgentPromptMessage[] {
  const historyMessages = historyIncludesCurrentTurn ? priorMessages.slice(0, -1) : priorMessages;
  const boundedHistory =
    historyMode === "conversation"
      ? boundPromptMessages(
          toPriorConversationMessages(historyMessages),
          CONVERSATION_HISTORY_LIMITS
        )
      : boundPromptMessages(toPriorUserMessages(historyMessages), USER_HISTORY_LIMITS);

  return [
    { role: "system", content: systemPrompt },
    ...boundedHistory,
    { role: "user", content: currentUserContent },
  ];
}
