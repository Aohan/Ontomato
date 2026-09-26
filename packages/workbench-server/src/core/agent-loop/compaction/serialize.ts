/**
 * Plain-text serialization of agent-loop messages for summarization prompts.
 *
 * Ported from PI's `harness/compaction/utils.ts`, adapted to data-agent's
 * three message roles.
 */

import type { AgentMessage } from "../types";

/** Plain-text serialization of one tool result is capped at this many chars. */
const TOOL_RESULT_MAX_CHARS = 2000;

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}

function truncateForSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncatedChars = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[... ${truncatedChars} more characters truncated]`;
}

/**
 * Serialize messages to plain text for the summarization prompt. Each message
 * becomes a `[Role]: ...` block; tool results are truncated to
 * {@link TOOL_RESULT_MAX_CHARS}. Mirrors PI's serializeConversation, restricted
 * to data-agent's roles.
 */
export function serializeConversation(messages: AgentMessage[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const content = msg.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("");
      if (content) parts.push(`[User]: ${content}`);
    } else if (msg.role === "assistant") {
      const textParts: string[] = [];
      const thinkingParts: string[] = [];
      const toolCalls: string[] = [];

      for (const block of msg.content) {
        if (block.type === "text") {
          textParts.push(block.text);
        } else if (block.type === "thinking") {
          thinkingParts.push(block.text);
        } else if (block.type === "toolCall") {
          const argsStr = Object.entries(block.arguments)
            .map(([k, v]) => `${k}=${safeJsonStringify(v)}`)
            .join(", ");
          toolCalls.push(`${block.name}(${argsStr})`);
        }
      }

      if (thinkingParts.length > 0) parts.push(`[Assistant thinking]: ${thinkingParts.join("\n")}`);
      if (textParts.length > 0) parts.push(`[Assistant]: ${textParts.join("\n")}`);
      if (toolCalls.length > 0) parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
    } else if (msg.role === "toolResult") {
      const content = msg.content.map((c) => c.text).join("");
      if (content) {
        parts.push(`[Tool result]: ${truncateForSummary(content, TOOL_RESULT_MAX_CHARS)}`);
      }
    }
  }

  return parts.join("\n\n");
}
