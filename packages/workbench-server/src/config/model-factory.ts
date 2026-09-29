import { randomUUID } from "node:crypto";
import { ChatOpenAI } from "@langchain/openai";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import type { ModelRole } from "@ontomato/contracts/model-settings";
import { startLlmLog } from "../logging/llm-logger";
import { createLogger } from "../logging/logger";
import { tApp } from "../i18n";
import { useApproximateTokenCounter } from "../utils/langchain-token-counter.js";
import {
  createChatCompletionsOverrideFetch,
  createEmptyChatStreamError,
} from "../utils/chat-completions-body-override.js";
import { resolveModelForRole } from "./model-resolver";

const logger = createLogger("model-factory");

export type ModelOptions = {
  role?: ModelRole;
  baseURL?: string;
  modelName?: string;
  temperature?: number;
  agentName?: string;
  agentRunId?: string;
  stream?: boolean;
};

export async function createModel(opts?: number | ModelOptions): Promise<ChatOpenAI> {
  const options: ModelOptions = typeof opts === "number" ? { temperature: opts } : (opts ?? {});
  const entry = await resolveModelForRole(options.role ?? "general");

  const temperature = options.temperature ?? 0;
  const agentName = options.agentName;
  const agentRunId = agentName
    ? typeof options.agentRunId === "string" && options.agentRunId.trim()
      ? options.agentRunId.trim()
      : randomUUID()
    : undefined;

  // Custom parameters override the final Chat Completions body at the fetch
  // boundary, so they are never passed as modelKwargs for the SDK to reinterpret.
  const overrideFetch = createChatCompletionsOverrideFetch(entry.customRequestParameters);

  const model = useApproximateTokenCounter(
    new ChatOpenAI({
      model: options.modelName || entry.modelName,
      configuration: {
        baseURL: options.baseURL || entry.baseUrl,
        apiKey: entry.apiKey,
        defaultHeaders: {
          "Content-Type": "application/json",
        },
        ...(overrideFetch ? { fetch: overrideFetch } : {}),
      },
      temperature,
      maxTokens: entry.maxTokens,
      ...(entry.maxRetries !== undefined ? { maxRetries: entry.maxRetries } : {}),
      ...(entry.timeoutSeconds !== undefined ? { timeout: entry.timeoutSeconds * 1000 } : {}),
    })
  );

  // A normally-ended stream without any chunk is an error on every path.
  // Args (including abort signals) pass through; an early consumer break or
  // an SDK error skips the check, preserving break/cancel semantics.
  const guardStream = model.stream.bind(model);
  model.stream = async function wrappedEmptyGuard(...args: Parameters<typeof guardStream>) {
    const stream = await guardStream(...args);
    return IterableReadableStream.fromAsyncGenerator(
      (async function* () {
        let chunkCount = 0;
        for await (const chunk of stream) {
          chunkCount += 1;
          yield chunk;
        }
        if (chunkCount === 0) throw createEmptyChatStreamError();
      })()
    );
  };

  if (!agentName) {
    return model;
  }

  const originalInvoke = model.invoke.bind(model);
  model.invoke = async function wrappedInvoke(...args: Parameters<typeof model.invoke>) {
    const tracker = startLlmLog(agentName, args[0], {
      model: options.modelName || entry.modelName,
      agentRunId,
    });
    logger.debug(tApp("foundation.log.model.invokeStarted", { agentName }), {
      baseUrl: options.baseURL || entry.baseUrl,
      modelName: options.modelName || entry.modelName,
      timeoutSeconds: entry.timeoutSeconds,
    });
    const invokeStart = Date.now();
    try {
      const result = await originalInvoke(...args);
      tracker.success(result);
      logger.debug(tApp("foundation.log.model.invokeCompleted", { agentName }), {
        durationMs: Date.now() - invokeStart,
      });
      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(tApp("foundation.log.model.invokeFailed", { agentName }), {
        durationMs: Date.now() - invokeStart,
        error: errMsg,
      });
      tracker.fail(err);
      throw err;
    }
  };

  const originalStream = model.stream.bind(model);
  model.stream = async function wrappedStream(...args: Parameters<typeof model.stream>) {
    const tracker = startLlmLog(agentName, args[0], {
      model: options.modelName || entry.modelName,
      agentRunId,
    });
    logger.debug(tApp("foundation.log.model.streamStarted", { agentName }), {
      baseUrl: options.baseURL || entry.baseUrl,
      modelName: options.modelName || entry.modelName,
      timeoutSeconds: entry.timeoutSeconds,
    });
    const streamStart = Date.now();
    try {
      const stream = await originalStream(...args);
      const chunks: unknown[] = [];
      const generator = (async function* () {
        let firstChunk = true;
        try {
          for await (const chunk of stream) {
            chunks.push(chunk);
            if (firstChunk) {
              logger.debug(tApp("foundation.log.model.streamFirstChunk", { agentName }), {
                ttftMs: Date.now() - streamStart,
              });
              firstChunk = false;
            }
            yield chunk;
          }
          tracker.successFromChunks(chunks);
          logger.debug(tApp("foundation.log.model.streamCompleted", { agentName }), {
            durationMs: Date.now() - streamStart,
            chunkCount: chunks.length,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(tApp("foundation.log.model.streamFailed", { agentName }), {
            durationMs: Date.now() - streamStart,
            error: errMsg,
          });
          tracker.fail(err);
          throw err;
        }
      })();

      return IterableReadableStream.fromAsyncGenerator(generator);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(tApp("foundation.log.model.streamConnFailed", { agentName }), {
        durationMs: Date.now() - streamStart,
        error: errMsg,
      });
      tracker.fail(err);
      throw err;
    }
  };

  return model;
}
