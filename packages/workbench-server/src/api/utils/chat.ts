import type { SseHeartbeatData } from "@ontomato/contracts/sse";
import { Request, Response } from "express";
import { initializeSse } from "../../utils/sse";

export interface SseContext {
  signal: AbortSignal;
  writeEvent: (data: unknown) => boolean;
  writeRaw: (data: string) => boolean;
  cleanup: () => void;
}

export interface SseStreamOptions {
  heartbeatMs?: number;
  abortOnClose?: boolean;
  signal?: AbortSignal;
}

function isResponseClosed(res: Response): boolean {
  return res.writableEnded || Boolean((res as Response & { destroyed?: boolean }).destroyed);
}

export function createSseStream(
  req: Request,
  res: Response,
  options: SseStreamOptions | number = {}
): SseContext {
  initializeSse(res);

  const resolvedOptions = typeof options === "number" ? { heartbeatMs: options } : options;
  const { heartbeatMs = 15000, abortOnClose = true, signal } = resolvedOptions;
  const abortController = new AbortController();
  const executionSignal = signal || abortController.signal;
  let streamClosed = false;
  let heartbeatInterval: ReturnType<typeof setInterval>;

  const closeStream = () => {
    streamClosed = true;
    clearInterval(heartbeatInterval);
  };

  heartbeatInterval = setInterval(() => {
    try {
      if (!streamClosed && !isResponseClosed(res)) {
        res.write("event: heartbeat\n");
        res.write(`data: ${JSON.stringify({ ts: Date.now() } satisfies SseHeartbeatData)}\n\n`);
      }
    } catch {
      closeStream();
      if (abortOnClose) abortController.abort();
    }
  }, heartbeatMs);

  req.on("close", () => {
    closeStream();
    if (abortOnClose) abortController.abort();
  });

  const cleanup = () => {
    closeStream();
    if (!isResponseClosed(res)) {
      res.end();
    }
  };

  const writeEvent = (data: unknown): boolean => {
    if (executionSignal.aborted || streamClosed || isResponseClosed(res)) return false;
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      return true;
    } catch {
      closeStream();
      if (abortOnClose) abortController.abort();
      return false;
    }
  };

  const writeRaw = (data: string): boolean => {
    if (executionSignal.aborted || streamClosed || isResponseClosed(res)) return false;
    try {
      res.write(`data: ${data}\n\n`);
      return true;
    } catch {
      closeStream();
      if (abortOnClose) abortController.abort();
      return false;
    }
  };

  return { signal: executionSignal, writeEvent, writeRaw, cleanup };
}
