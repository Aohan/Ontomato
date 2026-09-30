import { workbenchProduct } from "../../../product/installed";
import type { BackendNodeConfig, ParsedLogRecord } from "@ontomato/contracts/observe";
import type { LiveLogFilter } from "./types";
/**
 * Live log streaming via SSE.
 *
 * Tails data-agent.log and data-agent_llm.jsonl using fs.watch + incremental
 * read, and pushes new log entries to connected SSE clients.
 */

import fs from "node:fs";
import path from "node:path";
import { environment } from "../../../config/environment";
import { createLogger } from "../../../logging/logger";
import { getLogSourceConfig, observeConfig } from "./config";
import {
  listBackendTailNodes,
  streamBackendTailLines,
  type BackendTailStream,
} from "./log-sources/backend-node-client";
import { normalizeLevel } from "./parsers/parse-helpers";
import { extractBackendNodeIdFromObject, extractSessionIdFromObject } from "./parsers/session-id";

const logger = createLogger("observe:live-logs");

/** Global sequence counter for log entries. Monotonically increasing. */
let globalSeq = 0;

interface SeqRecord {
  seq: number;
  record: ParsedLogRecord;
}

/** Ring buffer of recent log entries for gap detection. */
const BUFFER_SIZE = 2000;
const recentBuffer: SeqRecord[] = [];

/** Active SSE listeners. */
interface LiveLogListener {
  id: string;
  filter: LiveLogFilter;
  send: (seq: number, record: ParsedLogRecord) => void;
  close: () => void;
}

const listeners = new Map<string, LiveLogListener>();

/** File watcher state per log file. */
interface TailState {
  filePath: string;
  offset: number;
  watcher: fs.FSWatcher | null;
  directoryWatcher: fs.FSWatcher | null;
  dev?: number;
  ino?: number;
}

const tailStates: Map<string, TailState> = new Map();
let initialized = false;

const BACKEND_RECONNECT_DELAY_MS = 2000;
let backendStreams = new Map<string, BackendTailStream>();
let backendReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
let backendStreamConfigKey: string | null = null;
let backendStreamToken: string | undefined;

/* ================================================================== */
/*  Public API                                                        */
/* ================================================================== */

/**
 * Register a new SSE listener for live logs.
 *
 * @returns An unsubscribe function.
 */
export function subscribeLiveLogs(
  listenerId: string,
  filter: LiveLogFilter,
  send: (seq: number, record: ParsedLogRecord) => void,
  close: () => void,
  options: { token?: string } = {}
): () => void {
  ensureInitialized(options.token);

  // If client sends sinceSeq, replay buffered entries they missed.
  if (filter.sinceSeq !== undefined && filter.sinceSeq >= 0) {
    const missed = recentBuffer.filter(
      (entry) => entry.seq > filter.sinceSeq! && matchesFilter(entry.record, filter)
    );
    if (missed.length > 0 && recentBuffer.length > 0) {
      const oldestBuffered = recentBuffer[0].seq;
      if (filter.sinceSeq < oldestBuffered) {
        // Gap detected: client is too far behind.
        send(-1, {
          source: workbenchProduct().logSource,
          level: "warn",
          message: `log_gap: missed entries between seq ${filter.sinceSeq} and ${oldestBuffered}`,
        });
      }
      for (const entry of missed) {
        send(entry.seq, entry.record);
      }
    }
  }

  listeners.set(listenerId, { id: listenerId, filter, send, close });

  return () => {
    listeners.delete(listenerId);
  };
}

/**
 * Shut down all watchers (for graceful server shutdown).
 */
export function shutdownLiveLogs(): void {
  for (const [, state] of tailStates) {
    state.watcher?.close();
    state.watcher = null;
    state.directoryWatcher?.close();
    state.directoryWatcher = null;
  }
  stopBackendNodeStreaming();
  tailStates.clear();
  listeners.clear();
  initialized = false;
}

export function refreshLiveLogSources(): void {
  if (initialized) {
    startBackendNodeStreaming(backendStreamToken);
  }
}

/* ================================================================== */
/*  Initialization                                                     */
/* ================================================================== */

function ensureInitialized(token?: string): void {
  if (initialized) {
    startBackendNodeStreaming(token ?? backendStreamToken);
    return;
  }
  initialized = true;

  // Start tailing app log
  const appLogPath = path.join(observeConfig.logDir, observeConfig.appLogFile);
  startTail(appLogPath, workbenchProduct().logSource);

  // Start tailing LLM log
  const llmLogPath = path.join(observeConfig.logDir, observeConfig.llmLogFile);
  startTail(llmLogPath, "llm");

  startBackendNodeStreaming(token);

  logger.info("Live log watchers initialized", {
    appLog: appLogPath,
    llmLog: llmLogPath,
  });
}

function startTail(filePath: string, source: ParsedLogRecord["source"]): void {
  const state: TailState = {
    filePath,
    offset: getFileSize(filePath),
    watcher: null,
    directoryWatcher: null,
  };

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    watchLogDirectory(state, source);
    if (fs.existsSync(filePath)) {
      bindLogFile(state, source, { readFromStart: false });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.debug("Cannot watch log file yet", { filePath, error: msg });
  }

  tailStates.set(filePath, state);
}

function watchLogFile(state: TailState, source: ParsedLogRecord["source"]): void {
  state.watcher?.close();
  state.watcher = fs.watch(state.filePath, { persistent: false }, () => {
    if (currentFileChanged(state)) {
      bindLogFile(state, source, { readFromStart: true });
      return;
    }
    readNewLines(state, source);
  });
  state.watcher.on("error", () => {
    state.watcher?.close();
    state.watcher = null;
  });
}

function watchLogDirectory(state: TailState, source: ParsedLogRecord["source"]): void {
  const dir = path.dirname(state.filePath);
  const targetName = path.basename(state.filePath);

  state.directoryWatcher?.close();
  state.directoryWatcher = fs.watch(dir, { persistent: false }, (_eventType, filename) => {
    if (filename && filename.toString() !== targetName) return;
    if (!fs.existsSync(state.filePath)) return;

    if (!state.watcher || currentFileChanged(state)) {
      bindLogFile(state, source, { readFromStart: true });
    }
  });
  state.directoryWatcher.on("error", () => {
    logger.debug("Cannot watch log directory yet", { dir });
  });
}

function bindLogFile(
  state: TailState,
  source: ParsedLogRecord["source"],
  options: { readFromStart: boolean }
): void {
  const stat = getFileStat(state.filePath);
  if (!stat) return;
  state.dev = stat.dev;
  state.ino = stat.ino;
  state.offset = options.readFromStart ? 0 : stat.size;
  watchLogFile(state, source);
  if (options.readFromStart) {
    readNewLines(state, source);
  }
}

function startBackendNodeStreaming(token?: string): void {
  const cfg = getLogSourceConfig();
  const nodes = listBackendTailNodes(cfg);
  const nextConfigKey = JSON.stringify(nodes.map((node) => [node.nodeId, node.baseUrl]));
  backendStreamToken = token || backendStreamToken || environment.queryKey();

  if (backendStreams.size > 0 && backendStreamConfigKey === nextConfigKey) return;
  stopBackendNodeStreaming();

  if (nodes.length === 0) {
    logger.debug("Backend live logs skipped: no backend node endpoint configured");
    return;
  }

  backendStreamConfigKey = nextConfigKey;
  for (const node of nodes) {
    connectBackendNodeStream(node, nextConfigKey);
  }
  logger.debug("Backend live log streaming initialized", {
    nodeCount: nodes.length,
    nodeIds: nodes.map((node) => node.nodeId),
  });
}

function stopBackendNodeStreaming(): void {
  for (const [, timer] of backendReconnectTimers) {
    clearTimeout(timer);
  }
  backendReconnectTimers = new Map();
  for (const [, stream] of backendStreams) {
    stream.close();
  }
  backendStreams = new Map();
  backendStreamConfigKey = null;
}

function connectBackendNodeStream(node: BackendNodeConfig, configKey: string): void {
  if (configKey !== backendStreamConfigKey) return;
  backendStreams.get(node.nodeId)?.close();

  const stream = streamBackendTailLines({
    node,
    options: { token: backendStreamToken },
    onLine: (item) => {
      if (configKey !== backendStreamConfigKey) return;
      broadcastRecord({
        source: "backend",
        backendNodeId: item.nodeId,
        message: item.line,
      });
    },
    onError: (error) => {
      if (configKey !== backendStreamConfigKey) return;
      logger.warn("Backend node live log stream failed", {
        nodeId: node.nodeId,
        error: error.message,
      });
      backendStreams.delete(node.nodeId);
      scheduleBackendNodeReconnect(node, configKey);
    },
    onClose: () => {
      if (configKey !== backendStreamConfigKey) return;
      backendStreams.delete(node.nodeId);
      scheduleBackendNodeReconnect(node, configKey);
    },
  });
  backendStreams.set(node.nodeId, stream);
}

function scheduleBackendNodeReconnect(node: BackendNodeConfig, configKey: string): void {
  if (backendReconnectTimers.has(node.nodeId)) return;
  const timer = setTimeout(() => {
    backendReconnectTimers.delete(node.nodeId);
    connectBackendNodeStream(node, configKey);
  }, BACKEND_RECONNECT_DELAY_MS);
  backendReconnectTimers.set(node.nodeId, timer);
}

/* ================================================================== */
/*  Tailing logic                                                     */
/* ================================================================== */

function readNewLines(state: TailState, source: ParsedLogRecord["source"]): void {
  try {
    const currentSize = getFileSize(state.filePath);
    if (currentSize < state.offset) {
      // File may have been truncated/rotated. Read the new file from the start.
      state.offset = 0;
    }
    if (currentSize === state.offset) {
      return;
    }

    const fd = fs.openSync(state.filePath, "r");
    try {
      const chunkSize = Math.min(currentSize - state.offset, 512 * 1024); // max 512 KB
      const buf = Buffer.alloc(chunkSize);
      const bytesRead = fs.readSync(fd, buf, 0, chunkSize, state.offset);
      state.offset += bytesRead;

      const text = buf.subarray(0, bytesRead).toString("utf-8");
      const lines = text.split("\n").filter(Boolean);

      for (const line of lines) {
        const record = parseTailLine(line, source);
        if (!record) continue;
        broadcastRecord(record);
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Read failures are non-fatal for live logs.
  }
}

function parseTailLine(line: string, source: ParsedLogRecord["source"]): ParsedLogRecord | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;

    if (source === "llm") {
      return {
        source: "llm",
        domainId: typeof obj.domainId === "string" ? obj.domainId : undefined,
        time: (obj.time as string) || (obj.endedAt as string),
        level: obj.status === "error" ? "error" : "info",
        turnKey: obj.turnKey as string | undefined,
        threadId: obj.threadId as string | undefined,
        requestSeq: typeof obj.requestSeq === "number" ? obj.requestSeq : undefined,
        taskId: obj.taskId as string | undefined,
        sessionId: extractSessionIdFromObject(obj),
        backendNodeId: extractBackendNodeIdFromObject(obj),
        agentName: obj.agentName as string | undefined,
        status: obj.status as string | undefined,
        durationMs: typeof obj.durationMs === "number" ? obj.durationMs : undefined,
        startedAt: obj.startedAt as string | undefined,
        endedAt: obj.endedAt as string | undefined,
        input: obj.input as string | undefined,
        output: obj.output as string | undefined,
        error: obj.error as string | undefined,
        message: buildLlmMessage(obj),
      };
    }

    // App log
    return {
      source: workbenchProduct().logSource,
      domainId: typeof obj.domainId === "string" ? obj.domainId : undefined,
      time: obj.time as string | undefined,
      level: normalizeLevel(obj.level as string | undefined),
      turnKey: obj.turnKey as string | undefined,
      threadId: obj.threadId as string | undefined,
      requestSeq: typeof obj.requestSeq === "number" ? obj.requestSeq : undefined,
      taskId: obj.taskId as string | undefined,
      sessionId: extractSessionIdFromObject(obj),
      backendNodeId: extractBackendNodeIdFromObject(obj),
      context: obj.context as string | undefined,
      error: obj.error as string | undefined,
      message: buildAppMessage(obj),
    };
  } catch {
    // Non-JSON line
    return {
      source,
      message: line,
    };
  }
}

function broadcastRecord(record: ParsedLogRecord): void {
  globalSeq++;
  const entry: SeqRecord = { seq: globalSeq, record };

  // Add to ring buffer
  recentBuffer.push(entry);
  if (recentBuffer.length > BUFFER_SIZE) {
    recentBuffer.shift();
  }

  // Broadcast to matching listeners
  for (const [, listener] of listeners) {
    if (matchesFilter(record, listener.filter)) {
      try {
        listener.send(globalSeq, record);
      } catch {
        // Listener write failed (disconnected), clean up.
        listeners.delete(listener.id);
      }
    }
  }
}

/* ================================================================== */
/*  Helpers                                                           */
/* ================================================================== */

function matchesFilter(record: ParsedLogRecord, filter: LiveLogFilter): boolean {
  if (filter.source && filter.source.length > 0) {
    if (!filter.source.includes(record.source)) return false;
  }
  if (filter.level && filter.level.length > 0) {
    if (record.level && !filter.level.includes(record.level)) return false;
  }
  if (filter.turnKey && record.turnKey !== filter.turnKey) return false;
  if (filter.taskId && record.taskId !== filter.taskId) return false;
  if (filter.keyword) {
    const kw = filter.keyword.toLowerCase();
    if (!record.message.toLowerCase().includes(kw)) return false;
  }
  return true;
}

function getFileSize(filePath: string): number {
  return getFileStat(filePath)?.size ?? 0;
}

function getFileStat(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function currentFileChanged(state: TailState): boolean {
  const stat = getFileStat(state.filePath);
  if (!stat) return true;
  return state.dev !== stat.dev || state.ino !== stat.ino;
}

function buildAppMessage(obj: Record<string, unknown>): string {
  let msg = "";
  if (obj.context) msg = `[${obj.context}] `;
  if (obj.message) msg += String(obj.message);
  if (obj.error) msg += msg ? ` | ${obj.error}` : String(obj.error);
  return msg || JSON.stringify(obj).slice(0, 200);
}

function buildLlmMessage(obj: Record<string, unknown>): string {
  const agent = obj.agentName || "unknown";
  const status = obj.status || "unknown";
  let msg = `[${agent}] LLM call ${status}`;
  if (obj.durationMs !== undefined) msg += ` (${obj.durationMs}ms)`;
  return msg;
}
