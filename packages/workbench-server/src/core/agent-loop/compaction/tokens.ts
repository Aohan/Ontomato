import type { EgressUsage as Usage } from "@ontomato/contracts/agent-egress";
/**
 * Token estimation + the compaction trigger predicate.
 *
 * Ported from PI's `harness/compaction/compaction.ts` (calculateContextTokens /
 * estimateTokens / estimateContextTokens / shouldCompact), adapted to
 * data-agent's three message roles (user / assistant / toolResult).
 *
 * Strategy: prefer the provider's real token usage from the last successful
 * assistant turn, then add a character heuristic for any messages appended
 * after it. The heuristic is ~4 characters per token; images count as a fixed
 * 4800 characters.
 */

import type { AgentMessage, AssistantMessage } from "../types";
import type { ContextUsageEstimate } from "./types";

/** Roughly how many characters one image contributes to the estimate. */
const ESTIMATED_IMAGE_CHARS = 4800;

/* ================================================================== */
/*  Real-usage token math                                              */
/* ================================================================== */

/**
 * Total context tokens from a provider usage block. Prefers `totalTokens`;
 * otherwise falls back to `input + output`.
 *
 * The fallback intentionally omits `cacheRead` / `cacheWrite`: this project's
 * LLMs all speak the OpenAI-compatible format, where `input` (prompt_tokens)
 * already includes cached tokens and `cacheWrite` (cache_creation) is never
 * reported. Adding them would double-count cache hits and over-trigger
 * compaction. This deviates from PI's original (PI targets Anthropic, whose
 * `input` excludes cache, so summing the parts is correct there).
 */
export function calculateContextTokens(usage: Usage): number {
  return usage.totalTokens || usage.input + usage.output;
}

/**
 * Usage from an assistant message, but only when the turn succeeded (not
 * error / aborted) and actually carries usage. Mirrors PI's getAssistantUsage.
 */
function getAssistantUsage(msg: AgentMessage): Usage | undefined {
  if (msg.role !== "assistant") return undefined;
  const assistant = msg as AssistantMessage;
  if (assistant.stopReason === "aborted" || assistant.stopReason === "error") return undefined;
  return assistant.usage;
}

/** Usage + index of the last successful assistant message, if any. */
function getLastAssistantUsageInfo(
  messages: AgentMessage[]
): { usage: Usage; index: number } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = getAssistantUsage(messages[i]!);
    if (usage) return { usage, index: i };
  }
  return undefined;
}

/* ================================================================== */
/*  Character heuristic                                                */
/* ================================================================== */

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}

/** Count characters across a content array of text / image blocks. */
function estimateContentChars(content: ReadonlyArray<{ type: string; text?: string }>): number {
  let chars = 0;
  for (const block of content) {
    if (block.type === "text" && block.text) {
      chars += block.text.length;
    } else if (block.type === "image") {
      chars += ESTIMATED_IMAGE_CHARS;
    }
  }
  return chars;
}

/**
 * Estimate the token count of one message via the character heuristic
 * (~4 chars/token). Mirrors PI's estimateTokens, restricted to data-agent's
 * roles. Assistant tool calls count their name + JSON-stringified arguments.
 */
export function estimateTokens(message: AgentMessage): number {
  let chars = 0;

  switch (message.role) {
    case "user":
      chars = estimateContentChars(message.content);
      return Math.ceil(chars / 4);
    case "toolResult":
      chars = estimateContentChars(message.content);
      return Math.ceil(chars / 4);
    case "assistant": {
      for (const block of message.content) {
        if (block.type === "text") {
          chars += block.text.length;
        } else if (block.type === "thinking") {
          chars += block.text.length;
        } else if (block.type === "toolCall") {
          chars += block.name.length + safeJsonStringify(block.arguments).length;
        }
      }
      return Math.ceil(chars / 4);
    }
  }
}

/* ================================================================== */
/*  Combined estimate                                                  */
/* ================================================================== */

/**
 * Estimate context tokens for a message list. Uses the real usage of the last
 * successful assistant turn, plus a heuristic estimate for messages after it.
 * Falls back to a pure heuristic when no usage exists. Mirrors PI's
 * estimateContextTokens.
 */
export function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate {
  const usageInfo = getLastAssistantUsageInfo(messages);

  if (!usageInfo) {
    let estimated = 0;
    for (const message of messages) {
      estimated += estimateTokens(message);
    }
    return { tokens: estimated, usageTokens: 0, trailingTokens: estimated, lastUsageIndex: null };
  }

  const usageTokens = calculateContextTokens(usageInfo.usage);
  let trailingTokens = 0;
  for (let i = usageInfo.index + 1; i < messages.length; i++) {
    trailingTokens += estimateTokens(messages[i]!);
  }

  return {
    tokens: usageTokens + trailingTokens,
    usageTokens,
    trailingTokens,
    lastUsageIndex: usageInfo.index,
  };
}

/* ================================================================== */
/*  Trigger                                                            */
/* ================================================================== */

/**
 * Whether the next model call is at or over 80% of the selected context window.
 * This replaces the fixed reserve subtracted from a 256000 window.
 */
export function shouldCompact(contextTokens: number, contextWindow: number): boolean {
  return contextTokens >= contextWindow * 0.8;
}
