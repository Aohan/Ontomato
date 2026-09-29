import type { ParsedLogRecord } from "@ontomato/contracts/observe";
/**
 * Parser for data-agent LLM log (data-agent_llm.jsonl).
 *
 * The LLM log is written by src/logging/llm-logger.ts.
 * Each line is a JSON object matching the LlmLogRecord interface.
 */

import fs from "node:fs";
import { createLogger } from "../../../../logging/logger";
import {
  listLogFilesForRead,
  type LogFileTimeWindow,
} from "../../../../logging/log-file-transport";
import { observeConfig } from "../config";
import { extractBackendNodeIdFromObject, extractSessionIdFromObject } from "./session-id";
import type { LlmQueryParams } from "../types";

const logger = createLogger("observe:llm-log-parser");

export interface LlmLogReadOptions {
  fileWindow?: LogFileTimeWindow;
  applyTimeFilter?: boolean;
}

interface RawLlmLogRecord {
  domainId?: string;
  time?: string;
  agentRunId?: string;
  requestId?: string;
  turnKey?: string;
  threadId?: string;
  requestSeq?: number;
  taskId?: string;
  sessionId?: string;
  backendNodeId?: string;
  agentName?: string;
  round?: number;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  status?: string;
  model?: string;
  messages?: Array<{ role?: string; text?: string }>;
  output?:
    | string
    | {
        text?: string;
        toolCalls?: Array<{ id?: string; name?: string; arguments?: string }>;
        finishReason?: string;
      };
  input?: string;
  error?: string;
  tokens?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

/**
 * Parse the LLM log file, applying optional filters.
 */
export function parseLlmLogs(
  params: LlmQueryParams = {},
  options: LlmLogReadOptions = {}
): ParsedLogRecord[] {
  try {
    const lines = readLlmLogLines(options.fileWindow ?? params);

    const records: ParsedLogRecord[] = [];
    const limit = params.limit ?? 1000;
    const offset = params.offset ?? 0;

    for (const line of lines) {
      let raw: RawLlmLogRecord;
      try {
        raw = JSON.parse(line) as RawLlmLogRecord;
      } catch {
        continue;
      }

      const record = toLogRecord(raw);

      if (!matchesFilter(record, raw, params, options.applyTimeFilter !== false)) continue;
      records.push(record);
    }

    const ordered = orderRecords(records, params);
    const paged = ordered.slice(offset, offset + limit);

    logger.debug("Parsed LLM logs", {
      total: lines.length,
      matched: records.length,
      returned: paged.length,
    });
    return paged;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to parse LLM logs", { error: msg });
    return [];
  }
}

/**
 * Parse LLM logs filtered by turnKey.
 */
export function parseLlmLogsByTurnKey(
  turnKey: string,
  fileWindow?: LogFileTimeWindow
): ParsedLogRecord[] {
  return parseLlmLogs({ turnKey }, { fileWindow, applyTimeFilter: false });
}

/**
 * Parse LLM logs filtered by taskId.
 */
export function parseLlmLogsByTaskId(
  taskId: string,
  fileWindow?: LogFileTimeWindow
): ParsedLogRecord[] {
  return parseLlmLogs({ taskId }, { fileWindow, applyTimeFilter: false });
}

/**
 * Return raw LLM-log JSONL lines for a turnKey without converting them to
 * ParsedLogRecord. Turn workspaces use this for raw-logs/llm-calls.jsonl.
 */
export function readLlmLogLinesByTurnKey(
  turnKey: string,
  fileWindow?: LogFileTimeWindow
): string[] {
  return readMatchingLlmLogLines((raw) => raw.turnKey === turnKey, fileWindow);
}

/**
 * Return raw LLM-log JSONL lines for a taskId without converting them to
 * ParsedLogRecord. Analysis workspaces use this for raw-logs/llm-calls.jsonl.
 */
export function readLlmLogLinesByTaskId(taskId: string, fileWindow?: LogFileTimeWindow): string[] {
  return readMatchingLlmLogLines((raw) => raw.taskId === taskId, fileWindow);
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                  */
/* ------------------------------------------------------------------ */

function toLogRecord(raw: RawLlmLogRecord): ParsedLogRecord {
  const level = raw.status === "error" ? ("error" as const) : ("info" as const);
  const input = raw.input;
  const outputText = typeof raw.output === "string" ? raw.output : raw.output?.text;
  const toolCallCount = typeof raw.output === "object" ? (raw.output.toolCalls?.length ?? 0) : 0;

  let message = `[${raw.agentName || "unknown"}] `;
  if (raw.status === "error") {
    message += `LLM call failed: ${raw.error || "unknown error"}`;
  } else {
    message += `LLM call ${raw.status || "unknown"}`;
    if (raw.round !== undefined) {
      message += ` round ${raw.round}`;
    }
    if (raw.durationMs !== undefined) {
      message += ` (${raw.durationMs}ms)`;
    }
  }

  if (raw.messages && raw.messages.length > 0) {
    message += ` | messages: ${raw.messages.length}`;
  }
  if (outputText) {
    message += ` | output: ${outputText.slice(0, 100)}`;
  }
  if (toolCallCount > 0) {
    message += ` | toolCalls: ${toolCallCount}`;
  }

  return {
    source: "llm",
    domainId: raw.domainId,
    time: raw.time || raw.endedAt,
    level,
    turnKey: raw.turnKey,
    threadId: raw.threadId,
    requestSeq: raw.requestSeq,
    taskId: raw.taskId,
    sessionId: extractSessionId(raw),
    backendNodeId: extractBackendNodeIdFromObject(raw),
    agentName: raw.agentName,
    agentRunId: raw.agentRunId,
    status: raw.status,
    durationMs: raw.durationMs,
    startedAt: raw.startedAt,
    endedAt: raw.endedAt,
    input,
    output: outputText,
    error: raw.error,
    message,
  };
}

/**
 * Extract sessionId from an LLM log record if present.
 *
 * LLM logs usually do NOT carry a sessionId (the app log is the primary
 * source). This is a best-effort fallback that checks both the top level and
 * the nested `data` object; returns undefined when absent.
 */
function extractSessionId(raw: RawLlmLogRecord): string | undefined {
  return extractSessionIdFromObject(raw);
}

function matchesFilter(
  record: ParsedLogRecord,
  raw: RawLlmLogRecord,
  params: LlmQueryParams,
  applyTimeFilter: boolean
): boolean {
  if (params.turnKey && record.turnKey !== params.turnKey) return false;
  if (params.taskId && record.taskId !== params.taskId) return false;
  if (params.agentName && raw.agentName !== params.agentName) return false;
  if (applyTimeFilter && params.startTime && record.time && record.time < params.startTime) {
    return false;
  }
  if (applyTimeFilter && params.endTime && record.time && record.time > params.endTime) {
    return false;
  }
  return true;
}

function readMatchingLlmLogLines(
  predicate: (raw: RawLlmLogRecord) => boolean,
  fileWindow?: LogFileTimeWindow
): string[] {
  try {
    const lines = readLlmLogLines(fileWindow);
    const matched: string[] = [];

    for (const line of lines) {
      try {
        const raw = JSON.parse(line) as RawLlmLogRecord;
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
    logger.error("Failed to read LLM log lines", { error: msg });
    return [];
  }
}

function readLlmLogLines(fileWindow?: LogFileTimeWindow): string[] {
  const files = listLogFilesForRead(observeConfig.llmLogFile, fileWindow);
  if (files.length === 0) {
    logger.debug("LLM log file not found", { file: observeConfig.llmLogFile });
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

function orderRecords(records: ParsedLogRecord[], params: LlmQueryParams): ParsedLogRecord[] {
  if (params.turnKey || params.taskId) return records;
  return records.slice().sort((a, b) => parseRecordTime(b) - parseRecordTime(a));
}

function parseRecordTime(record: ParsedLogRecord): number {
  const time = record.time ? Date.parse(record.time) : NaN;
  return Number.isFinite(time) ? time : 0;
}
