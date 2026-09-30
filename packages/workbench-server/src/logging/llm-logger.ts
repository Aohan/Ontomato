import { workbenchProduct } from "../product/installed";
import { getLogContext } from "./log-context";
import { appendJsonl } from "./log-file-transport";
import {
  extractLlmTokens,
  normalizeLlmInputMessages,
  normalizeLlmOutput,
  normalizeLlmStreamOutput,
  type LlmLogMessage,
  type LlmLogOutput,
} from "./llm-log-serializer";


/** Shape of a single LLM interaction log record. */
export interface LlmLogRecord {
  domainId?: string;
  time: string;
  agentRunId?: string;
  requestId?: string;
  turnKey?: string;
  threadId?: string;
  requestSeq?: number;
  taskId?: string;
  sessionId?: string;
  backendNodeId?: string;
  agentName: string;
  round: number;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: "success" | "error" | "cancelled";
  model?: string;
  messages: LlmLogMessage[];
  output?: LlmLogOutput;
  tokens?: Record<string, number>;
  error?: string;
}

export interface LlmLogTrackerOptions {
  model?: string;
  agentRunId?: string;
  round?: number;
  sessionId?: string;
  backendNodeId?: string;
}

const roundCounters = new Map<string, number>();

/**
 * Create a tracker for a single LLM invocation.
 *
 * Usage:
 * ```ts
 * const tracker = startLlmLog("Router");
 * try {
 *   const result = await model.invoke(messages);
 *   tracker.success(output);
 * } catch (err) {
 *   tracker.fail(err);
 * }
 * ```
 */
export function startLlmLog(
  agentName: string,
  input?: unknown,
  options: LlmLogTrackerOptions = {}
) {
  const startedAt = new Date().toISOString();
  const messages = normalizeLlmInputMessages(input);
  const context = getLogContext();
  const turn = context?.turn;
  const round =
    options.round ??
    nextRound(agentName, options.agentRunId, context?.requestId, turn?.turnKey, context?.taskId);

  function write(
    status: LlmLogRecord["status"],
    output?: LlmLogOutput,
    tokens?: Record<string, number>,
    error?: string
  ): void {
    try {
      const endedAt = new Date().toISOString();
      const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();

      const record: LlmLogRecord = {
        ...(context?.domainId ? { domainId: context.domainId } : {}),
        time: endedAt,
        ...(options.agentRunId ? { agentRunId: options.agentRunId } : {}),
        ...(context?.requestId ? { requestId: context.requestId } : {}),
        ...(turn
          ? { turnKey: turn.turnKey, threadId: turn.threadId, requestSeq: turn.requestSeq }
          : {}),
        ...(context?.taskId ? { taskId: context.taskId } : {}),
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        ...(options.backendNodeId ? { backendNodeId: options.backendNodeId } : {}),
        agentName,
        round,
        startedAt,
        endedAt,
        durationMs,
        status,
        ...(options.model ? { model: options.model } : {}),
        messages,
        ...(output ? { output } : {}),
        ...(tokens ? { tokens } : {}),
        ...(error ? { error } : {}),
      };

      appendJsonl(workbenchProduct().llmLogFileName, record as unknown as Record<string, unknown>);
    } catch {
      // Never let LLM logging break the application.
    }
  }

  return {
    /** Record a successful LLM call. */
    success(result?: unknown): void {
      write("success", normalizeLlmOutput(result), extractLlmTokens(result));
    },
    /** Record a successful streamed LLM call after the stream has ended. */
    successFromChunks(chunks: unknown[]): void {
      const lastChunk = chunks[chunks.length - 1];
      write("success", normalizeLlmStreamOutput(chunks), extractLlmTokens(lastChunk));
    },
    /** Record a failed LLM call. */
    fail(err: unknown): void {
      const msg = err instanceof Error ? err.message : String(err);
      write("error", undefined, undefined, msg);
    },
    /** Record a cancelled LLM call. */
    cancel(): void {
      write("cancelled");
    },
  };
}

function nextRound(
  agentName: string,
  agentRunId?: string,
  requestId?: string,
  turnKey?: string,
  taskId?: string
): number {
  const contextKey = agentRunId || turnKey || taskId || requestId || "global";
  const key = `${contextKey}::${agentName}`;
  const next = (roundCounters.get(key) ?? 0) + 1;
  roundCounters.set(key, next);
  return next;
}
