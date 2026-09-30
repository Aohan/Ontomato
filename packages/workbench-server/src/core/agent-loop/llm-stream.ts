import type {
  EgressTextContent as TextContent,
  EgressToolCallContent as ToolCallContent,
  EgressUsage as Usage,
} from "@ontomato/contracts/agent-egress";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { ToolDefinition } from "@langchain/core/language_models/base";
import { useApproximateTokenCounter } from "../../utils/langchain-token-counter.js";
import { createReasoningReplayFetch } from "../../utils/langchain-reasoning-replay.js";
import {
  createChatCompletionsOverrideFetch,
  createEmptyChatStreamError,
} from "../../utils/chat-completions-body-override.js";
import { startLlmLog } from "../../logging/llm-logger";
import { createLogger } from "../../logging/logger";
import type {
  ModelConfig,
  AgentMessage,
  AgentTool,
  AssistantMessage,
  AssistantStreamEvent,
  ThinkingContent,
} from "./types";

const logger = createLogger("agent-loop:llm-stream");

const DEFAULT_TIMEOUT_MS = 120_000;

/* ------------------------------------------------------------------ */
/*  Usage capture: LangChain usage_metadata -> our Usage shape        */
/* ------------------------------------------------------------------ */

/**
 * Convert LangChain's `usage_metadata` into our {@link Usage} shape. Returns
 * undefined when no usage was reported. Field names are normalized to match
 * PI's `Usage` (input / output / cacheRead / cacheWrite / totalTokens) so the
 * compaction token math can use them directly.
 *
 * LangChain reports cached tokens under `input_token_details.cache_read` and
 * `input_token_details.cache_creation`; not all providers populate them.
 *
 * @internal exported for unit tests; production code calls it inside the stream.
 */
export function toUsage(usageMetadata: unknown): Usage | undefined {
  if (!usageMetadata || typeof usageMetadata !== "object") return undefined;
  const m = usageMetadata as {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_token_details?: { cache_read?: number; cache_creation?: number };
  };
  const input = m.input_tokens ?? 0;
  const output = m.output_tokens ?? 0;
  const cacheRead = m.input_token_details?.cache_read ?? 0;
  const cacheWrite = m.input_token_details?.cache_creation ?? 0;
  const totalTokens = m.total_tokens ?? 0;
  // Ignore an all-zero block (some providers emit an empty usage object).
  if (!input && !output && !cacheRead && !cacheWrite && !totalTokens) return undefined;
  return { input, output, cacheRead, cacheWrite, totalTokens };
}

/* ------------------------------------------------------------------ */
/*  Message format conversion: AgentMessage -> LangChain BaseMessage  */
/* ------------------------------------------------------------------ */

function convertMessagesToLangChain(systemPrompt: string, messages: AgentMessage[]): BaseMessage[] {
  const result: BaseMessage[] = [new SystemMessage(systemPrompt)];

  for (const msg of messages) {
    switch (msg.role) {
      case "user": {
        const text = msg.content
          .filter((c): c is TextContent => c.type === "text")
          .map((c) => c.text)
          .join("");
        result.push(new HumanMessage(text));
        break;
      }
      case "assistant": {
        const textParts = msg.content
          .filter((c): c is TextContent => c.type === "text")
          .map((c) => c.text)
          .join("");
        const reasoningContent = msg.content
          .filter((c): c is ThinkingContent => c.type === "thinking")
          .map((c) => c.text)
          .join("");

        const toolCalls = msg.content
          .filter((c): c is ToolCallContent => c.type === "toolCall")
          .map((c) => ({
            id: c.id,
            name: c.name,
            args: c.arguments,
            type: "tool_call" as const,
          }));

        result.push(
          new AIMessage({
            content: textParts || "",
            ...(reasoningContent
              ? { additional_kwargs: { reasoning_content: reasoningContent } }
              : {}),
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          })
        );
        break;
      }
      case "toolResult": {
        const text = msg.content.map((c) => c.text).join("");
        result.push(
          new ToolMessage({
            content: text,
            tool_call_id: msg.toolCallId,
          })
        );
        break;
      }
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  Tool format conversion: AgentTool -> LangChain ToolDefinition     */
/* ------------------------------------------------------------------ */

function convertToolsToLangChain(tools: AgentTool[]): ToolDefinition[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/* ------------------------------------------------------------------ */
/*  Stream chat completion using LangChain ChatOpenAI                 */
/* ------------------------------------------------------------------ */

/**
 * Stream a chat completion via LangChain ChatOpenAI.
 *
 * Yields AssistantStreamEvent deltas and returns the fully-assembled
 * AssistantMessage once the stream ends.
 */
export async function* streamChatCompletion(
  modelConfig: ModelConfig,
  systemPrompt: string,
  messages: AgentMessage[],
  tools: AgentTool[],
  signal?: AbortSignal,
  maxTokens?: number
): AsyncGenerator<AssistantStreamEvent, AssistantMessage> {
  const langChainMessages = convertMessagesToLangChain(systemPrompt, messages);
  // Reasoning replays first (outer), custom override wins last (inner): without
  // custom messages the replay survives, with custom messages the whole array
  // replaces the replayed one and is never patched again.
  const overrideFetch = createChatCompletionsOverrideFetch(modelConfig.modelKwargs);
  const fetch = createReasoningReplayFetch(langChainMessages, overrideFetch);

  // Build ChatOpenAI instance
  const baseUrl = modelConfig.baseUrl.replace(/\/+$/, "");
  const maxTokenCandidates = [modelConfig.maxTokens, maxTokens].filter(
    (value): value is number => typeof value === "number" && value > 0 && Number.isFinite(value)
  );
  const outputTokenLimit =
    maxTokenCandidates.length > 0 ? Math.min(...maxTokenCandidates) : undefined;
  const llm = useApproximateTokenCounter(
    new ChatOpenAI({
      configuration: {
        baseURL: baseUrl,
        apiKey: modelConfig.apiKey,
        ...(fetch ? { fetch } : {}),
      },
      modelName: modelConfig.modelName,
      timeout: DEFAULT_TIMEOUT_MS,
      ...(outputTokenLimit ? { maxTokens: outputTokenLimit } : {}),
    })
  );

  // Bind tools if present
  const model = tools.length > 0 ? llm.bindTools(convertToolsToLangChain(tools)) : llm;

  // Accumulate the assistant message from stream deltas
  const contentParts: (TextContent | ThinkingContent | ToolCallContent)[] = [];
  const pendingToolCalls = new Map<number, { id: string; name: string; argsBuf: string }>();
  let textBuf = "";
  let thinkingBuf = "";
  let stopReason: AssistantMessage["stopReason"] = "stop";
  // Provider token usage, captured from the final chunk's usage_metadata.
  let usage: Usage | undefined;

  function currentPartial(): AssistantMessage {
    return {
      role: "assistant",
      content: buildCurrentContent(),
      stopReason,
      timestamp: Date.now(),
    };
  }

  function buildCurrentContent(): (TextContent | ThinkingContent | ToolCallContent)[] {
    const parts: (TextContent | ThinkingContent | ToolCallContent)[] = [...contentParts];
    if (thinkingBuf) parts.push({ type: "thinking", text: thinkingBuf });
    if (textBuf) parts.push({ type: "text", text: textBuf });
    for (const [, tc] of pendingToolCalls) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.argsBuf || "{}") as Record<string, unknown>;
      } catch {
        /* partial JSON is expected during streaming */
      }
      parts.push({
        type: "toolCall",
        id: tc.id,
        name: tc.name,
        arguments: parsedArgs,
      });
    }
    return parts;
  }

  // Combine timeout + user abort signal
  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  // This adapter builds its own ChatOpenAI (streaming tool loops cannot use the
  // shared model factory), so it must supply the equivalent observability
  // itself: one agent-llm record per model call, aggregated at the call
  // boundary rather than per chunk.
  const tracker = modelConfig.llmLog
    ? startLlmLog(modelConfig.llmLog.agentName, langChainMessages, {
        model: modelConfig.modelName,
        agentRunId: modelConfig.llmLog.agentRunId,
      })
    : undefined;
  const loggedChunks: unknown[] = [];

  try {
    const stream = await model.stream(langChainMessages, { signal: combinedSignal });

    let rawChunkCount = 0;
    for await (const chunk of stream) {
      rawChunkCount += 1;
      if (tracker) loggedChunks.push(chunk);
      // --- Text content ---
      const content = chunk.content;
      if (typeof content === "string" && content.length > 0) {
        textBuf += content;
        yield {
          type: "text_delta",
          delta: content,
          partial: currentPartial(),
        };
      }

      // --- Reasoning / thinking content ---
      // LangChain passes reasoning_content through additional_kwargs
      const additionalKwargs = chunk.additional_kwargs;
      const reasoningDelta =
        additionalKwargs?.reasoning_content ??
        additionalKwargs?.reasoning ??
        additionalKwargs?.reasoning_text;
      if (typeof reasoningDelta === "string" && reasoningDelta.length > 0) {
        thinkingBuf += reasoningDelta;
        yield {
          type: "thinking_delta",
          delta: reasoningDelta,
          partial: currentPartial(),
        };
      }

      // --- Tool calls ---
      // LangChain provides tool_call_chunks on streaming AIMessageChunk
      const toolCallChunks = chunk.tool_call_chunks;
      if (toolCallChunks && toolCallChunks.length > 0) {
        for (const tc of toolCallChunks) {
          const idx = tc.index ?? 0;

          if (tc.id) {
            // New tool call starting
            pendingToolCalls.set(idx, {
              id: tc.id,
              name: tc.name ?? "",
              argsBuf: tc.args ?? "",
            });

            const contentIndex =
              contentParts.length + (textBuf ? 1 : 0) + (thinkingBuf ? 1 : 0) + idx;
            yield {
              type: "toolcall_start",
              contentIndex,
              partial: currentPartial(),
            };
          } else {
            const existing = pendingToolCalls.get(idx);
            if (existing) {
              if (tc.name) existing.name += tc.name;
              if (tc.args) {
                existing.argsBuf += tc.args;
                yield {
                  type: "toolcall_delta",
                  delta: tc.args,
                  contentIndex:
                    contentParts.length + (textBuf ? 1 : 0) + (thinkingBuf ? 1 : 0) + idx,
                  partial: currentPartial(),
                };
              }
            }
          }
        }
      }

      // --- Finish reason ---
      const finishReason = chunk.response_metadata?.finish_reason as string | undefined;
      if (finishReason) {
        if (finishReason === "tool_calls") {
          stopReason = "tool_calls";
        } else if (finishReason === "stop") {
          stopReason = "stop";
        }
      }

      // LangChain also exposes finish_reason via additional_kwargs on the last chunk
      const kwFinishReason = additionalKwargs?.finish_reason as string | undefined;
      if (kwFinishReason) {
        if (kwFinishReason === "tool_calls") {
          stopReason = "tool_calls";
        } else if (kwFinishReason === "stop") {
          stopReason = "stop";
        }
      }

      // --- Token usage ---
      // LangChain attaches usage_metadata to the final AIMessageChunk; the last
      // non-empty block wins (streamed chunks aggregate it into one total).
      const captured = toUsage((chunk as { usage_metadata?: unknown }).usage_metadata);
      if (captured) usage = captured;
    }
    // A normally-ended stream with zero raw chunks is an error, reported
    // through the existing catch below; only cancellation skips it.
    if (rawChunkCount === 0 && !signal?.aborted) throw createEmptyChatStreamError();
    tracker?.successFromChunks(loggedChunks);
  } catch (err) {
    const aborted = signal?.aborted;
    const errMsg = err instanceof Error ? err.message : String(err);
    if (!aborted) {
      logger.error("LLM stream error", { error: errMsg });
    }
    if (aborted) tracker?.cancel();
    else tracker?.fail(err);
    return buildErrorMessage(aborted ? "aborted" : "error", errMsg);
  }

  // Also detect stop reason from accumulated tool calls
  if (pendingToolCalls.size > 0 && stopReason === "stop") {
    stopReason = "tool_calls";
  }

  // Finalize text buffers in the same order used by streaming partials.
  if (thinkingBuf) {
    contentParts.push({ type: "thinking", text: thinkingBuf });
    thinkingBuf = "";
  }
  if (textBuf) {
    contentParts.push({ type: "text", text: textBuf });
    textBuf = "";
  }

  // Finalize pending tool calls after the thinking/text that introduced them.
  for (const [idx, tc] of pendingToolCalls) {
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(tc.argsBuf || "{}") as Record<string, unknown>;
    } catch {
      // partial JSON -- use empty object
    }
    contentParts.push({
      type: "toolCall",
      id: tc.id,
      name: tc.name,
      arguments: parsedArgs,
    });
    pendingToolCalls.delete(idx);

    yield { type: "toolcall_end", partial: currentPartial() };
  }

  yield { type: "done" };

  return {
    role: "assistant",
    content: contentParts,
    stopReason,
    ...(usage ? { usage } : {}),
    timestamp: Date.now(),
  };
}

function buildErrorMessage(reason: "error" | "aborted", message: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: `[Error] ${message}` }],
    stopReason: reason,
    errorMessage: message,
    timestamp: Date.now(),
  };
}
