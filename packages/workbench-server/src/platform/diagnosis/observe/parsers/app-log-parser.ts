import { workbenchProduct } from "../../../../product/installed";
import type { ParsedLogRecord } from "@ontomato/contracts/observe";
/**
 * Parser for data-agent main log (data-agent.log).
 *
 * The main log is written in JSONL format by src/logging/logger.ts.
 * Each line is a JSON object matching the AppLogRecord interface.
 */

import fs from "node:fs";
import { createLogger } from "../../../../logging/logger";
import {
  listLogFilesForRead,
  type LogFileTimeWindow,
} from "../../../../logging/log-file-transport";
import { observeConfig } from "../config";
import { normalizeLevel } from "./parse-helpers";
import {
  extractBackendNodeIdFromObject,
  extractBackendNodeIdFromText,
  extractSessionIdFromObject,
  extractSessionIdFromText,
} from "./session-id";
import type { LogQueryParams } from "../types";

const logger = createLogger("observe:app-log-parser");

export interface AppLogReadOptions {
  fileWindow?: LogFileTimeWindow;
  applyTimeFilter?: boolean;
}

interface RawAppLogRecord {
  domainId?: string;
  time?: string;
  level?: string;
  context?: string;
  message?: string;
  turnKey?: string;
  threadId?: string;
  requestSeq?: number;
  taskId?: string;
  sessionId?: string;
  backendNodeId?: string;
  backend_node_id?: string;
  session_id?: string;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * Parse the main app log file, applying optional filters.
 */
export function parseAppLogs(
  params: LogQueryParams = {},
  options: AppLogReadOptions = {}
): ParsedLogRecord[] {
  try {
    const lines = readAppLogLines(options.fileWindow ?? params);

    const records: ParsedLogRecord[] = [];
    const limit = params.limit ?? 1000;
    const offset = params.offset ?? 0;

    for (const line of lines) {
      let raw: RawAppLogRecord;
      try {
        raw = JSON.parse(line) as RawAppLogRecord;
      } catch {
        // Skip unparseable lines silently.
        continue;
      }

      const record = toLogRecord(raw);

      if (!matchesFilter(record, params, options.applyTimeFilter !== false)) continue;
      records.push(record);
    }

    const ordered = orderRecords(records, params);
    const paged = ordered.slice(offset, offset + limit);

    logger.debug("Parsed app logs", {
      total: lines.length,
      matched: records.length,
      returned: paged.length,
    });
    return paged;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to parse app logs", { error: msg });
    return [];
  }
}

/**
 * Parse app logs filtered by turnKey.
 */
export function parseAppLogsByTurnKey(
  turnKey: string,
  fileWindow?: LogFileTimeWindow
): ParsedLogRecord[] {
  return parseAppLogs({ turnKey }, { fileWindow, applyTimeFilter: false });
}

/**
 * Parse app logs filtered by taskId.
 */
export function parseAppLogsByTaskId(
  taskId: string,
  fileWindow?: LogFileTimeWindow
): ParsedLogRecord[] {
  return parseAppLogs({ taskId }, { fileWindow, applyTimeFilter: false });
}

/**
 * Return raw app-log JSON lines for a turnKey without converting them to
 * ParsedLogRecord. Turn workspaces use this for raw-logs/app.log.
 */
export function readAppLogLinesByTurnKey(
  turnKey: string,
  fileWindow?: LogFileTimeWindow
): string[] {
  return readMatchingAppLogLines((raw) => raw.turnKey === turnKey, fileWindow);
}

/**
 * Return raw app-log JSON lines for a taskId without converting them to
 * ParsedLogRecord. Analysis workspaces use this for raw-logs/app.log.
 */
export function readAppLogLinesByTaskId(taskId: string, fileWindow?: LogFileTimeWindow): string[] {
  return readMatchingAppLogLines((raw) => raw.taskId === taskId, fileWindow);
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                  */
/* ------------------------------------------------------------------ */

function toLogRecord(raw: RawAppLogRecord): ParsedLogRecord {
  const level = normalizeLevel(raw.level);
  return {
    source: workbenchProduct().logSource,
    domainId: raw.domainId,
    time: raw.time,
    level,
    turnKey: raw.turnKey,
    threadId: raw.threadId,
    requestSeq: raw.requestSeq,
    taskId: raw.taskId,
    sessionId: extractSessionId(raw),
    backendNodeId: extractBackendNodeId(raw),
    context: raw.context,
    error: raw.error,
    message: buildMessage(raw),
  };
}

/**
 * Extract the business sessionId (UUID) from an app log record.
 *
 * The data-agent logger nests structured context under `data`. Nodes such as
 * abc-query / query-node write `data.sessionId`. Turn workspaces resolve
 * backend evidence through PostgreSQL query-run records; this parser keeps a
 * best-effort fallback for log-only views.
 */
function extractSessionId(raw: RawAppLogRecord): string | undefined {
  return extractSessionIdFromObject(raw) ?? extractSessionIdFromText(buildMessage(raw));
}

function extractBackendNodeId(raw: RawAppLogRecord): string | undefined {
  return extractBackendNodeIdFromObject(raw) ?? extractBackendNodeIdFromText(buildMessage(raw));
}

function buildMessage(raw: RawAppLogRecord): string {
  let msg = raw.message || "";
  if (raw.context) {
    msg = `[${raw.context}] ${msg}`;
  }
  if (raw.error) {
    msg = msg ? `${msg} | ${raw.error}` : raw.error;
  }
  return msg;
}

function matchesFilter(
  record: ParsedLogRecord,
  params: LogQueryParams,
  applyTimeFilter: boolean
): boolean {
  if (params.turnKey && record.turnKey !== params.turnKey) return false;
  if (params.taskId && record.taskId !== params.taskId) return false;
  if (params.level && record.level !== params.level) return false;
  if (params.keyword) {
    const kw = params.keyword.toLowerCase();
    if (!record.message.toLowerCase().includes(kw)) return false;
  }
  if (applyTimeFilter && params.startTime && record.time && record.time < params.startTime) {
    return false;
  }
  if (applyTimeFilter && params.endTime && record.time && record.time > params.endTime) {
    return false;
  }
  return true;
}

function readMatchingAppLogLines(
  predicate: (raw: RawAppLogRecord) => boolean,
  fileWindow?: LogFileTimeWindow
): string[] {
  try {
    const lines = readAppLogLines(fileWindow);
    const matched: string[] = [];

    for (const line of lines) {
      try {
        const raw = JSON.parse(line) as RawAppLogRecord;
        if (predicate(raw)) {
          matched.push(line);
        }
      } catch {
        continue;
      }
    }

    return matched;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to read app log lines", { error: msg });
    return [];
  }
}

function readAppLogLines(fileWindow?: LogFileTimeWindow): string[] {
  const files = listLogFilesForRead(observeConfig.appLogFile, fileWindow);
  if (files.length === 0) {
    logger.debug("App log file not found", { file: observeConfig.appLogFile });
    return [];
  }

  const lines: string[] = [];
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      lines.push(...content.split("\n").filter(Boolean));
    } catch {
      continue;
    }
  }
  return lines;
}

function orderRecords(records: ParsedLogRecord[], params: LogQueryParams): ParsedLogRecord[] {
  if (params.turnKey || params.taskId) return records;
  return records.slice().sort((a, b) => parseRecordTime(b) - parseRecordTime(a));
}

function parseRecordTime(record: ParsedLogRecord): number {
  const time = record.time ? Date.parse(record.time) : NaN;
  return Number.isFinite(time) ? time : 0;
}
