import type {
  ParsedLogRecord,
  WorkspaceBackendSessionEvidence,
  WorkspaceBackendSessionNode,
} from "@ontomato/contracts/observe";
import type { QueryBackendSession } from "@ontomato/contracts/query-execution";
/**
 * Log collector for diagnostic artifacts.
 *
 * Extracts log slices from data-agent log files by Turn or task ID,
 * reusing the observe module parsers. Optionally queries datarag node slice
 * APIs for backend evidence if configured.
 *
 * Output:
 *   {artifactDir}/raw-logs/app.log
 *   {artifactDir}/raw-logs/llm-calls.jsonl
 *   {artifactDir}/raw-logs/backend.log (one file per node; backend-<node>.log when several)
 *   {artifactDir}/raw-logs/agent-llm.jsonl (optional)
 *   {artifactDir}/raw-logs/diagnostic-events.jsonl (optional)
 */

import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../../../../logging/logger";
import type { LogFileTimeWindow } from "../../../../logging/log-file-transport";
import {
  parseAppLogsByTaskId,
  parseAppLogsByTurnKey,
  readAppLogLinesByTaskId,
  readAppLogLinesByTurnKey,
} from "../parsers/app-log-parser";
import {
  parseLlmLogsByTaskId,
  parseLlmLogsByTurnKey,
  readLlmLogLinesByTaskId,
  readLlmLogLinesByTurnKey,
} from "../parsers/llm-log-parser";
import { getLogSourceConfig } from "../config";
import {
  lookupSessionRegistryRows,
  type SessionRegistryRow,
} from "../log-sources/session-registry-client";
import {
  fetchBackendAgentLlmLines,
  fetchBackendInfoLogSlice,
  fetchBackendDiagnosticEventLines,
  resolveBackendNodeBaseUrl,
  type BackendNodeRequestOptions,
} from "../log-sources/backend-node-client";
import { collectBackendInfoBucket } from "../log-sources/backend-info-bucket";

import { ARTIFACT_DIRS } from "./utils";
import { workspaceArtifactText } from "./artifact-text";
import { tApp } from "../../../../i18n";


const logger = createLogger("workspace-artifact:log-collector");
const BACKEND_LOG_WINDOW_PADDING_MS = 5_000;

export interface LogCollectorInput {
  artifactDir: string;
  workspaceId: string;
  turnKey?: string;
  taskId?: string;
  /** Backend session list in the query record; diagnosis collects evidence by session + node */
  backendSessions?: QueryBackendSession[];
  backendTimeWindow?: BackendLogTimeWindow;
  frontendLogTimeWindow?: LogFileTimeWindow;
  includeFrontendLogs?: boolean;
  token?: string;
  apiKey?: string;
  userId?: string;
  locale?: string;
  signal?: AbortSignal;
}

export interface BackendLogTimeWindow {
  minTs: number;
  /** Omitted while the data-agent Turn is still running. */
  maxTs?: number;
  turnRunning: boolean;
}

export interface LogCollectorResult {
  appLogCount: number;
  llmCallCount: number;
  backendLogCount: number;
  backendAgentLlmCount: number;
  backendDiagnosticEventCount: number;
  /** Retrieval status per backend session and per node */
  backendSessions: WorkspaceBackendSessionEvidence[];
  /** backend.log collection notes: session not located, no time window, or per-node failures */
  backendLogMessage?: string;
  records: ParsedLogRecord[];
}

interface BackendCollectionResult {
  infoCount: number;
  infoRecords: ParsedLogRecord[];
  infoMessage?: string;
  sessions: WorkspaceBackendSessionEvidence[];
}

/** Union of the evidence units' time windows on the same node, plus that node's backend address. */
interface BackendNodeLogWindow {
  baseUrl: string;
  minTs: number;
  maxTs: number;
}

/**
 * Collect logs for a single diagnostic artifact.
 *
 * 1. Parse app logs by turnKey/taskId -> write app.log
 * 2. Parse LLM logs by turnKey/taskId -> write llm-calls.jsonl
 * 3. (Optional) Query backend evidence -> write backend.log / agent-llm.jsonl / diagnostic-events.jsonl
 *
 * Each step is independent -- failure in one does not block others.
 */
export async function collectLogs(input: LogCollectorInput): Promise<LogCollectorResult> {
  const { artifactDir, workspaceId, turnKey, taskId } = input;
  const includeFrontendLogs = input.includeFrontendLogs !== false;
  const logDir = path.join(artifactDir, ARTIFACT_DIRS.RAW_LOGS);

  fs.mkdirSync(logDir, { recursive: true });

  const result: LogCollectorResult = {
    appLogCount: 0,
    llmCallCount: 0,
    backendLogCount: 0,
    backendAgentLlmCount: 0,
    backendDiagnosticEventCount: 0,
    backendSessions: [],
    records: [],
  };
  let appRecords: ParsedLogRecord[] = [];
  let llmRecords: ParsedLogRecord[] = [];

  // Step 1: App logs by turnKey or taskId
  if (includeFrontendLogs) {
    try {
      appRecords = turnKey
        ? parseAppLogsByTurnKey(turnKey, input.frontendLogTimeWindow)
        : taskId
          ? parseAppLogsByTaskId(taskId, input.frontendLogTimeWindow)
          : [];
      if (appRecords.length > 0) {
        writeLines(
          path.join(logDir, "app.log"),
          turnKey
            ? readAppLogLinesByTurnKey(turnKey, input.frontendLogTimeWindow)
            : taskId
              ? readAppLogLinesByTaskId(taskId, input.frontendLogTimeWindow)
              : []
        );
        result.appLogCount = appRecords.length;
      }
      logger.debug("App logs collected", {
        workspaceId,
        turnKey,
        taskId,
        count: appRecords.length,
      });
    } catch (err) {
      logger.warn("Failed to collect app logs", {
        workspaceId,
        turnKey,
        taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    logger.debug("Frontend app log collection skipped", { workspaceId, turnKey, taskId });
  }

  // Step 2: LLM logs by turnKey or taskId
  if (includeFrontendLogs) {
    try {
      llmRecords = turnKey
        ? parseLlmLogsByTurnKey(turnKey, input.frontendLogTimeWindow)
        : taskId
          ? parseLlmLogsByTaskId(taskId, input.frontendLogTimeWindow)
          : [];
      if (llmRecords.length > 0) {
        writeLines(
          path.join(logDir, "llm-calls.jsonl"),
          turnKey
            ? readLlmLogLinesByTurnKey(turnKey, input.frontendLogTimeWindow)
            : taskId
              ? readLlmLogLinesByTaskId(taskId, input.frontendLogTimeWindow)
              : []
        );
        result.llmCallCount = llmRecords.length;
      }
      logger.debug("LLM logs collected", {
        workspaceId,
        turnKey,
        taskId,
        count: llmRecords.length,
      });
    } catch (err) {
      logger.warn("Failed to collect LLM logs", {
        workspaceId,
        turnKey,
        taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    logger.debug("Frontend LLM log collection skipped", { workspaceId, turnKey, taskId });
  }

  // backendSessions is parsed by the caller from PostgreSQL query_runs. Record-level sessionIds never drive
  // backend evidence collection (see d4ba5739): a turn that recorded a business sessionId has already written it into the query record.
  result.records = [...appRecords, ...llmRecords];

  // Step 3: Backend logs via datarag Node API (optional)
  try {
    const backendResult = await collectBackendLogs({
      logDir,
      workspaceId,
      sessions: input.backendSessions ?? [],
      backendTimeWindow: input.backendTimeWindow,
      requestOptions: {
        token: input.token,
        apiKey: input.apiKey,
        userId: input.userId,
        locale: input.locale,
        signal: input.signal,
      },
    });
    result.backendLogCount = backendResult.infoCount;
    result.backendLogMessage = backendResult.infoMessage;
    result.backendSessions = backendResult.sessions;
    result.backendAgentLlmCount = sumNodeCount(backendResult.sessions, "agentLlmCount");
    result.backendDiagnosticEventCount = sumNodeCount(
      backendResult.sessions,
      "diagnosticEventCount"
    );
    result.records = [...result.records, ...backendResult.infoRecords];
  } catch (err) {
    logger.warn("Failed to collect backend logs", {
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}

function sumNodeCount(
  sessions: WorkspaceBackendSessionEvidence[],
  field: "agentLlmCount" | "diagnosticEventCount"
): number {
  return sessions.reduce(
    (sessionSum, session) =>
      sessionSum + session.nodes.reduce((nodeSum, node) => nodeSum + node[field], 0),
    0
  );
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Write source log lines as-is.
 */
function writeLines(filePath: string, lines: string[]): void {
  if (lines.length === 0) return;
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
}

/**
 * Evidence collection by session + node (design 7, 12): the routing table yields all routing rows for the session, and each row
 * fetches its own agent-llm and diagnostic-events; without a routing row the query record's node and query time window are used.
 * backend.log is collected per node, with the time window being the union of that node's evidence-unit windows. When the query
 * record has no session at all, backend.log is collected from the default backend using the query time window. One unit failing never affects the others.
 */
async function collectBackendLogs(input: {
  logDir: string;
  workspaceId: string;
  sessions: QueryBackendSession[];
  backendTimeWindow?: BackendLogTimeWindow;
  requestOptions?: BackendNodeRequestOptions;
}): Promise<BackendCollectionResult> {
  const { logDir, workspaceId, backendTimeWindow, requestOptions } = input;
  const cfg = getLogSourceConfig();
  const text = workspaceArtifactText().backendEvidence;
  const sessions: WorkspaceBackendSessionEvidence[] = [];
  const nodeWindows = new Map<string, BackendNodeLogWindow>();
  const agentLlmLines: string[] = [];
  const diagnosticEventLines: string[] = [];

  for (const backendSession of input.sessions) {
    const lookup = await lookupSessionRegistryRows(backendSession.sessionId, requestOptions);
    const units: Array<{ nodeId?: string; row?: SessionRegistryRow; lookupError?: string }> =
      lookup.rows.length > 0
        ? lookup.rows.map((row) => ({ nodeId: row.nodeId, row }))
        : [{ nodeId: backendSession.nodeId?.trim() || undefined, lookupError: lookup.error }];

    const nodes: WorkspaceBackendSessionNode[] = [];
    for (const unit of units) {
      const nodeEvidence: WorkspaceBackendSessionNode = {
        nodeId: unit.nodeId,
        startTs: unit.row?.startTs,
        endTs: unit.row?.endTs,
        cancelledAt: unit.row?.cancelledAt,
        windowMessage: describeWindowSource(unit.row, unit.lookupError),
        agentLlmCount: 0,
        diagnosticEventCount: 0,
      };

      const baseUrl = resolveBackendNodeBaseUrl(cfg, unit.nodeId);
      if (!baseUrl) {
        nodeEvidence.locationMessage = tApp("diag.observe.workspace-artifact.log-collector.0");
        nodes.push(nodeEvidence);
        continue;
      }

      const window = buildBackendInfoTimeWindow(unit.row, backendTimeWindow, Date.now());
      if (window) mergeNodeWindow(nodeWindows, unit.nodeId, baseUrl, window);
      const structuredLogWindow = window ? { minTs: window.minTs, maxTs: window.maxTs } : {};

      try {
        const lines = await fetchBackendAgentLlmLines({
          baseUrl,
          sessionId: backendSession.sessionId,
          ...structuredLogWindow,
          options: requestOptions,
        });
        nodeEvidence.agentLlmCount = lines.length;
        agentLlmLines.push(...lines);
        if (lines.length === 0) {
          nodeEvidence.agentLlmMessage = text.agentLlmEmpty;
        }
      } catch (error) {
        nodeEvidence.agentLlmMessage = `${text.agentLlmFailed}${error instanceof Error ? error.message : String(error)}`;
        logger.warn("Backend agent-llm collection failed", {
          workspaceId,
          sessionId: backendSession.sessionId,
          nodeId: unit.nodeId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      try {
        const lines = await fetchBackendDiagnosticEventLines({
          baseUrl,
          sessionId: backendSession.sessionId,
          ...structuredLogWindow,
          options: requestOptions,
        });
        nodeEvidence.diagnosticEventCount = lines.length;
        diagnosticEventLines.push(...lines);
        if (lines.length === 0) {
          nodeEvidence.diagnosticEventMessage = text.diagnosticEventsEmpty;
        }
      } catch (error) {
        nodeEvidence.diagnosticEventMessage = `${text.diagnosticEventsFailed}${
          error instanceof Error ? error.message : String(error)
        }`;
        logger.warn("Backend diagnostic-events collection failed", {
          workspaceId,
          sessionId: backendSession.sessionId,
          nodeId: unit.nodeId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      nodes.push(nodeEvidence);
    }

    sessions.push({
      branch: backendSession.branch,
      sessionId: backendSession.sessionId,
      nodes,
    });
  }

  // The query record has no session at all (including after routing-table rebuild): collect backend.log from the default backend using the query time window.
  if (input.sessions.length === 0) {
    const window = buildBackendInfoTimeWindow(undefined, backendTimeWindow, Date.now());
    const baseUrl = resolveBackendNodeBaseUrl(cfg, undefined);
    if (window && baseUrl) mergeNodeWindow(nodeWindows, undefined, baseUrl, window);
  }

  writeLines(path.join(logDir, "agent-llm.jsonl"), agentLlmLines);
  writeLines(path.join(logDir, "diagnostic-events.jsonl"), diagnosticEventLines);

  const backendLog = await collectBackendLogByNode({
    logDir,
    workspaceId,
    nodeWindows,
    requestOptions,
  });

  const sessionNote = input.sessions.length === 0 ? text.noSession : undefined;
  const infoMessage =
    [sessionNote, backendLog.infoMessage].filter(Boolean).join(text.separator) || undefined;

  logger.debug("Backend logs collected via node slice API", {
    workspaceId,
    sessionCount: sessions.length,
    backendLogCount: backendLog.infoCount,
    agentLlmCount: agentLlmLines.length,
    diagnosticEventCount: diagnosticEventLines.length,
  });

  return {
    infoCount: backendLog.infoCount,
    infoRecords: backendLog.infoRecords,
    infoMessage,
    sessions,
  };
}

/** Collects backend runtime logs per node: the time window is the union of that node's evidence-unit windows, one file per node. */
async function collectBackendLogByNode(input: {
  logDir: string;
  workspaceId: string;
  nodeWindows: Map<string, BackendNodeLogWindow>;
  requestOptions?: BackendNodeRequestOptions;
}): Promise<{ infoCount: number; infoRecords: ParsedLogRecord[]; infoMessage?: string }> {
  const text = workspaceArtifactText().backendEvidence;
  if (input.nodeWindows.size === 0) {
    return { infoCount: 0, infoRecords: [], infoMessage: text.noLogWindow };
  }

  const singleNode = input.nodeWindows.size === 1;
  let infoCount = 0;
  const infoRecords: ParsedLogRecord[] = [];
  const failures: string[] = [];

  for (const [nodeKey, window] of input.nodeWindows) {
    const outputPath = path.join(input.logDir, backendLogFileName(nodeKey, singleNode));
    try {
      const bucketResult = await collectBackendInfoBucket({
        backendNodeId: nodeKey,
        minTs: window.minTs,
        maxTs: window.maxTs,
        outputPath,
        fetchWindow: (minTs, maxTs) =>
          fetchBackendInfoLogSlice({
            baseUrl: window.baseUrl,
            minTs,
            maxTs,
            options: input.requestOptions,
          }),
      });
      infoCount += bucketResult.lineCount;
      infoRecords.push(...bucketResult.records);
    } catch (error) {
      failures.push(`${nodeKey}: ${error instanceof Error ? error.message : String(error)}`);
      logger.warn("Backend app log slice collection failed", {
        workspaceId: input.workspaceId,
        backendNodeId: nodeKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const infoMessage =
    failures.length > 0
      ? `${text.logSliceFailed}${failures.join(text.separator)}`
      : infoCount === 0
        ? text.logEmpty
        : undefined;
  return { infoCount, infoRecords, infoMessage };
}

/** Keeps backend.log with a single node; with several nodes the file name carries the node identifier. */
function backendLogFileName(nodeKey: string, singleNode: boolean): string {
  if (singleNode) return "backend.log";
  return `backend-${nodeKey.replace(/[^a-zA-Z0-9._=-]/g, "_")}.log`;
}

function mergeNodeWindow(
  nodeWindows: Map<string, BackendNodeLogWindow>,
  nodeId: string | undefined,
  baseUrl: string,
  window: BackendTimeWindow
): void {
  const nodeKey = nodeId || "default";
  const existing = nodeWindows.get(nodeKey);
  if (!existing) {
    nodeWindows.set(nodeKey, { baseUrl, minTs: window.minTs, maxTs: window.maxTs });
    return;
  }
  existing.minTs = Math.min(existing.minTs, window.minTs);
  existing.maxTs = Math.max(existing.maxTs, window.maxTs);
}

interface BackendTimeWindow {
  minTs: number;
  maxTs: number;
}

function buildBackendInfoTimeWindow(
  row: SessionRegistryRow | undefined,
  turnWindow: BackendLogTimeWindow | undefined,
  currentTs: number
): BackendTimeWindow | null {
  const rowStartTs = finiteTimestamp(row?.startTs);
  const turnMinTs = finiteTimestamp(turnWindow?.minTs);
  const minTs =
    rowStartTs === null ? turnMinTs : Math.max(0, rowStartTs - BACKEND_LOG_WINDOW_PADDING_MS);

  const rowEndTs = finiteTimestamp(row?.endTs);
  const turnMaxTs = finiteTimestamp(turnWindow?.maxTs);
  const maxTs =
    rowEndTs !== null
      ? rowEndTs + BACKEND_LOG_WINDOW_PADDING_MS
      : turnWindow?.turnRunning
        ? currentTs + BACKEND_LOG_WINDOW_PADDING_MS
        : turnMaxTs;

  if (minTs === null || maxTs === null || maxTs < minTs) return null;
  return { minTs, maxTs };
}

function finiteTimestamp(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null;
}

/** Explanation of the evidence window: when the routing query failed, no routing row exists, or the row has no registered start/end, the query record's node and query time window are used instead. */
function describeWindowSource(
  row: SessionRegistryRow | undefined,
  lookupError: string | undefined
): string | undefined {
  if (row) {
    return row.startTs === undefined && row.endTs === undefined
      ? tApp("diag.observe.workspace-artifact.log-collector.1")
      : undefined;
  }
  if (lookupError) return tApp("diag.observe.workspace-artifact.log-collector.2", { p0: lookupError });
  return tApp("diag.observe.workspace-artifact.log-collector.3");
}
