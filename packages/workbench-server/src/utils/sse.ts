import type { SseOpenData } from "@ontomato/contracts/sse";
import type { SseErrorEvent } from "@ontomato/contracts/errors";
import type { Response } from "express";
import { toErrorMessage } from "./errors";

export function createSseErrorEvent(error: unknown, timestamp: number = Date.now()): SseErrorEvent {
  return {
    type: "error",
    error: toErrorMessage(error),
    timestamp,
  };
}

export function initializeSse(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    (res as Response & { flushHeaders?: () => void }).flushHeaders?.();
  } catch {
    // flushHeaders may fail in some environments, ignore
  }

  res.write("event: open\n");
  res.write(`data: ${JSON.stringify({ ok: true } satisfies SseOpenData)}\n\n`);
}

export function writeSseError(res: Response, error: unknown): void {
  res.write(`data: ${JSON.stringify(createSseErrorEvent(error))}\n\n`);
}
