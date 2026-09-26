import type { SseHeartbeatData } from "@ontomato/contracts/sse";
import type { RunCancelledEvent } from "@ontomato/contracts/chat";
import { Request, Response } from "express";
import { createLogger } from "../../logging/logger";
import { tApp } from "../../i18n";
import type { TurnIdentity } from "../../logging/log-context";
import { initializeSse } from "../../utils/sse";
import { HttpError } from "../../utils/errors";
import type { AuthenticatedRequest } from "../../utils/request-identity";

const logger = createLogger("api:run-stream");

type RunStatus = "running" | "completed" | "failed" | "cancelled";
type StoredEventKind = "json" | "raw";

export interface StoredRunEvent {
  seq: number;
  kind: StoredEventKind;
  data: unknown;
  terminal?: boolean;
  timestamp: number;
}

export interface RunRecord {
  id: string;
  key: string;
  userId: string;
  domainId: string;
  turn?: TurnIdentity;
  status: RunStatus;
  controller: AbortController;
  events: StoredRunEvent[];
  subscribers: Set<(event: StoredRunEvent) => boolean>;
  createdAt: number;
  updatedAt: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

interface StartRunOptions {
  runId: string;
  key: string;
  userId: string;
  domainId: string;
  turn?: TurnIdentity;
}

export function requireRunAccess(
  run: RunRecord,
  identity: Pick<AuthenticatedRequest, "userId" | "domainId">,
  key: string = run.key
): void {
  if (run.userId !== identity.userId || run.domainId !== identity.domainId || run.key !== key) {
    throw new HttpError(403, "Run access denied");
  }
}

interface SubscribeOptions {
  heartbeatMs?: number;
}

const DEFAULT_RETENTION_MS = 30 * 60 * 1000;

function parseLastEventSeq(req: Request): number {
  const lastEventSeq = Number(req.header("last-event-id"));
  return Number.isFinite(lastEventSeq) ? Math.max(0, lastEventSeq) : 0;
}

function isResponseClosed(res: Response): boolean {
  return res.writableEnded || Boolean((res as Response & { destroyed?: boolean }).destroyed);
}

function writeStoredEvent(res: Response, event: StoredRunEvent): boolean {
  if (isResponseClosed(res)) return false;

  try {
    res.write(`id: ${event.seq}\n`);
    if (event.kind === "raw") {
      res.write(`data: ${String(event.data)}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify(event.data)}\n\n`);
    }
    if (event.terminal && !isResponseClosed(res)) {
      res.end();
    }
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

export class RunStreamStore {
  private runs = new Map<string, RunRecord>();
  private keyToRunId = new Map<string, string>();

  constructor(private retentionMs = DEFAULT_RETENTION_MS) {}

  startRun(options: StartRunOptions): RunRecord {
    const existing = this.getActiveRunByKey(options.key);
    if (existing) {
      requireRunAccess(existing, options, options.key);
      this.cancelByRunId(existing.id);
    }

    return this.createRun(options);
  }

  reserveRun(options: StartRunOptions): RunRecord | null {
    if (this.getActiveRunByKey(options.key)) return null;
    return this.createRun(options);
  }

  private createRun(options: StartRunOptions): RunRecord {
    const prior = this.runs.get(options.runId);
    if (prior) throw new HttpError(409, "Run already exists");

    const run: RunRecord = {
      id: options.runId,
      key: options.key,
      userId: options.userId,
      domainId: options.domainId,
      turn: options.turn,
      status: "running",
      controller: new AbortController(),
      events: [],
      subscribers: new Set(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.runs.set(run.id, run);
    this.keyToRunId.set(run.key, run.id);
    return run;
  }

  getRun(runId: string): RunRecord | undefined {
    return this.runs.get(runId);
  }

  getActiveRunByKey(key: string): RunRecord | undefined {
    const runId = this.keyToRunId.get(key);
    if (!runId) return undefined;
    const run = this.runs.get(runId);
    if (!run || run.status !== "running") return undefined;
    return run;
  }

  getRetainedRunByKey(key: string): RunRecord | undefined {
    const runId = this.keyToRunId.get(key);
    return runId ? this.runs.get(runId) : undefined;
  }

  appendJson(runId: string, data: unknown, terminal = false): StoredRunEvent | undefined {
    return this.append(runId, "json", data, terminal);
  }

  appendRaw(runId: string, data: string, terminal = false): StoredRunEvent | undefined {
    return this.append(runId, "raw", data, terminal);
  }

  cancelByKey(key: string): boolean {
    const run = this.getActiveRunByKey(key);
    if (!run) return false;
    run.controller.abort();
    this.appendJson(run.id, buildRunLifecycleEvent("run_cancelled", run), true);
    this.finishRun(run.id, "cancelled");
    return true;
  }

  cancelByRunId(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || run.status !== "running") return false;
    run.controller.abort();
    this.appendJson(run.id, buildRunLifecycleEvent("run_cancelled", run), true);
    this.finishRun(run.id, "cancelled");
    return true;
  }

  finishRun(runId: string, status: Exclude<RunStatus, "running">): void {
    const run = this.runs.get(runId);
    if (!run) return;

    run.status = status;
    run.updatedAt = Date.now();
    run.subscribers.clear();
    if (this.keyToRunId.get(run.key) === run.id) {
      this.keyToRunId.delete(run.key);
    }

    if (run.cleanupTimer) clearTimeout(run.cleanupTimer);
    run.cleanupTimer = setTimeout(() => {
      this.runs.delete(run.id);
    }, this.retentionMs);
    run.cleanupTimer.unref?.();
  }

  subscribe(req: Request, res: Response, run: RunRecord, options: SubscribeOptions = {}): void {
    requireRunAccess(run, req as AuthenticatedRequest);
    initializeSse(res);
    const lastEventSeq = parseLastEventSeq(req);

    for (const event of run.events) {
      if (event.seq > lastEventSeq && !writeStoredEvent(res, event)) {
        return;
      }
      if (event.terminal && event.seq > lastEventSeq) return;
    }

    if (run.status !== "running") {
      if (!isResponseClosed(res)) res.end();
      return;
    }

    const subscriber = (event: StoredRunEvent) => writeStoredEvent(res, event);
    run.subscribers.add(subscriber);

    const heartbeatInterval = setInterval(() => {
      try {
        if (!isResponseClosed(res)) {
          res.write("event: heartbeat\n");
          res.write(`data: ${JSON.stringify({ ts: Date.now() } satisfies SseHeartbeatData)}\n\n`);
        }
      } catch {
        run.subscribers.delete(subscriber);
        clearInterval(heartbeatInterval);
      }
    }, options.heartbeatMs || 15000);

    req.on("close", () => {
      run.subscribers.delete(subscriber);
      clearInterval(heartbeatInterval);
    });
  }

  private append(
    runId: string,
    kind: StoredEventKind,
    data: unknown,
    terminal: boolean
  ): StoredRunEvent | undefined {
    const run = this.runs.get(runId);
    if (!run) {
      logger.warn(tApp("foundation.log.run.appendFailed"), { runId, kind });
      return undefined;
    }

    const event: StoredRunEvent = {
      seq: run.events.length + 1,
      kind,
      data,
      terminal,
      timestamp: Date.now(),
    };
    run.events.push(event);
    run.updatedAt = Date.now();

    for (const subscriber of [...run.subscribers]) {
      if (!subscriber(event)) {
        run.subscribers.delete(subscriber);
      }
    }

    return event;
  }
}

function buildRunLifecycleEvent(
  type: RunCancelledEvent["type"],
  run: RunRecord
): RunCancelledEvent {
  return {
    type,
    timestamp: Date.now(),
    ...(run.turn
      ? {
          turnKey: run.turn.turnKey,
          threadId: run.turn.threadId,
          requestSeq: run.turn.requestSeq,
        }
      : {}),
  };
}

export const runStreamStore = new RunStreamStore();
