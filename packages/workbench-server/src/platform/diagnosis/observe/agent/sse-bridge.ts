import type { SseHeartbeatData } from "@ontomato/contracts/sse";
import type { DiagnosisStreamEvent } from "@ontomato/contracts/diagnosis";
import type { Request, Response } from "express";
import { initializeSse } from "../../../../utils/sse";
import { createLogger } from "../../../../logging/logger";
import type { AgentEvent } from "../../../../core/agent-loop/index";
import type { BufferedDiagnosisEvent, SessionResponseStream } from "./session-stream";

const logger = createLogger("observe:sse-bridge");
const DISPATCH_AGENT_TOOL = "dispatch_agent";
const PUBLIC_SUBAGENT_TOOL = "subagent";

function publicToolName(toolName: string): string {
  return toolName === DISPATCH_AGENT_TOOL ? PUBLIC_SUBAGENT_TOOL : toolName;
}

function publicToolArgs(toolName: string, args: unknown): Record<string, unknown> {
  return toolName === DISPATCH_AGENT_TOOL
    ? {}
    : args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};
}

function publicToolResult(toolName: string, result: unknown, isError: boolean): unknown {
  return toolName === DISPATCH_AGENT_TOOL ? { status: isError ? "failed" : "completed" } : result;
}

/** Convert one Agent event into zero or one user-visible diagnosis stream event. */
export function toDiagnosisStreamEvent(event: AgentEvent): DiagnosisStreamEvent | undefined {
  switch (event.type) {
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta") {
        return update.delta ? { type: "token", content: update.delta } : undefined;
      }
      if (update.type === "thinking_delta") {
        return update.delta ? { type: "thinking", content: update.delta } : undefined;
      }
      return undefined;
    }

    case "tool_execution_start":
      return {
        type: "tool_start",
        toolCallId: event.toolCallId,
        tool: publicToolName(event.toolName),
        args: publicToolArgs(event.toolName, event.args),
      };

    case "tool_execution_end":
      return {
        type: "tool_end",
        toolCallId: event.toolCallId,
        tool: publicToolName(event.toolName),
        result: publicToolResult(event.toolName, event.result, event.isError),
        isError: event.isError,
      };

    default:
      return undefined;
  }
}

function parseLastEventSeq(req: Request): number {
  const seq = Number(req.header("last-event-id"));
  return Number.isFinite(seq) ? Math.max(0, seq) : 0;
}

function isResponseClosed(res: Response): boolean {
  return res.writableEnded || Boolean((res as Response & { destroyed?: boolean }).destroyed);
}

function writeBufferedEvent(res: Response, buffered: BufferedDiagnosisEvent): boolean {
  if (isResponseClosed(res)) return false;
  try {
    res.write(`id: ${buffered.seq}\n`);
    res.write(`data: ${JSON.stringify(buffered.event)}\n\n`);
    if (buffered.terminal && !isResponseClosed(res)) res.end();
    return true;
  } catch {
    try {
      res.end();
    } catch {
      /* ignore */
    }
    return false;
  }
}

/** Attach one HTTP subscriber. Closing it never cancels the owning session response. */
export function subscribeResponseStream(
  req: Request,
  res: Response,
  stream: SessionResponseStream,
  heartbeatMs = 15_000
): void {
  initializeSse(res);
  let closed = false;
  let unsubscribe = () => {};
  const heartbeat = setInterval(() => {
    try {
      if (!isResponseClosed(res)) {
        res.write("event: heartbeat\n");
        res.write(`data: ${JSON.stringify({ ts: Date.now() } satisfies SseHeartbeatData)}\n\n`);
      }
    } catch {
      cleanup();
    }
  }, heartbeatMs);
  heartbeat.unref?.();

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  };

  res.on("close", cleanup);
  unsubscribe = stream.subscribe(parseLastEventSeq(req), (event) => {
    const written = writeBufferedEvent(res, event);
    if (!written || event.terminal) cleanup();
    return written;
  });

  if (stream.status !== "running") {
    cleanup();
    if (!isResponseClosed(res)) res.end();
  }
}

export function writeUnavailableStream(res: Response): void {
  initializeSse(res);
  try {
    res.write(
      `data: ${JSON.stringify({ type: "response_unavailable" } satisfies DiagnosisStreamEvent)}\n\n`
    );
    res.end();
  } catch (error) {
    logger.debug("Failed to close unavailable diagnosis stream", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
