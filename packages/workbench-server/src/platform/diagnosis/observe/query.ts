import type { ParsedLogRecord } from "@ontomato/contracts/observe";
/**
 * Observability query aggregation module.
 *
 * Consumes parsed observe data to provide unified query endpoints:
 * - Turn log queries by turnKey
 * - Main log queries
 * - LLM log queries
 * - Backend log queries through turnKey -> query run -> sessionId -> time window
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLogger } from "../../../logging/logger";
import { parseAppLogs } from "./parsers/app-log-parser";
import { parseLlmLogs } from "./parsers/llm-log-parser";
import { extractErrors } from "./parsers/error-extractor";
import { collectLogs } from "./workspace-artifact/log-collector";
import {
  parseTurnKeyOrThrow,
  resolveQueryRunBackendSessions,
  resolveTurnRunBackendTimeWindow,
  resolveTurnWorkspaceContext,
} from "./workspaces/turn-resolver";
import type { LogQueryParams, LlmQueryParams, BackendLogQueryParams } from "./types";
import type { BackendNodeRequestOptions } from "./log-sources/backend-node-client";

const logger = createLogger("observe:query");

/* ================================================================== */
/*  Main log queries                                                  */
/* ================================================================== */

/**
 * Query main app logs with filters.
 */
export function queryAppLogs(params: LogQueryParams = {}): ParsedLogRecord[] {
  try {
    return parseAppLogs(params);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("App log query failed", { error: msg });
    return [];
  }
}

/* ================================================================== */
/*  LLM log queries                                                   */
/* ================================================================== */

/**
 * Query LLM call logs with filters.
 */
export function queryLlmCalls(params: LlmQueryParams = {}): ParsedLogRecord[] {
  try {
    return parseLlmLogs(params);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("LLM log query failed", { error: msg });
    return [];
  }
}

/* ================================================================== */
/*  Backend log queries                                               */
/* ================================================================== */

/**
 * Query backend logs through the Turn workspace pipeline.
 *
 * Backend datarag logs are not queried as a generic log source in diagnosis.
 * The only supported path is turnKey -> query run -> sessionId -> backend
 * time window.
 */
export async function queryBackendLogs(
  params: BackendLogQueryParams = {},
  options: BackendNodeRequestOptions = {}
): Promise<ParsedLogRecord[]> {
  try {
    return await queryBackendLogsByTurnKey(params, options);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Backend log query failed", { error: msg });
    return [];
  }
}

async function queryBackendLogsByTurnKey(
  params: BackendLogQueryParams,
  options: BackendNodeRequestOptions
): Promise<ParsedLogRecord[]> {
  if (!params.turnKey) return [];

  const turn = parseTurnKeyOrThrow(params.turnKey);
  const turnContext = await resolveTurnWorkspaceContext(turn);
  const queryRun = turnContext.selectedQueryRun ?? turnContext.primaryQueryRun;
  const backendSessions = resolveQueryRunBackendSessions(queryRun);

  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "observe-turn-backend-"));
  try {
    const collected = await collectLogs({
      artifactDir,
      workspaceId: params.turnKey,
      turnKey: params.turnKey,
      backendSessions,
      backendTimeWindow: resolveTurnRunBackendTimeWindow(turnContext.turnRun),
      includeFrontendLogs: false,
      token: options.token,
      userId: options.userId,
      locale: options.locale,
      signal: options.signal,
    });
    return applyBackendLogFilters(
      collected.records.filter((record) => record.source === "backend"),
      params
    );
  } finally {
    await fs.rm(artifactDir, { recursive: true, force: true });
  }
}

function applyBackendLogFilters(
  records: ParsedLogRecord[],
  params: BackendLogQueryParams
): ParsedLogRecord[] {
  let logs = records;
  if (params.keyword) {
    const keyword = params.keyword.toLowerCase();
    logs = logs.filter((record) => record.message.toLowerCase().includes(keyword));
  }
  if (params.startTime) {
    const startTs = Date.parse(params.startTime);
    if (Number.isFinite(startTs)) {
      logs = logs.filter((record) => {
        const ts = record.time ? Date.parse(record.time) : NaN;
        return Number.isFinite(ts) && ts >= startTs;
      });
    }
  }
  if (params.endTime) {
    const endTs = Date.parse(params.endTime);
    if (Number.isFinite(endTs)) {
      logs = logs.filter((record) => {
        const ts = record.time ? Date.parse(record.time) : NaN;
        return Number.isFinite(ts) && ts <= endTs;
      });
    }
  }
  const offset = params.offset ?? 0;
  const limit = params.limit ?? logs.length;
  return logs.slice(offset, offset + limit);
}

/* ================================================================== */
/*  Error summary                                                     */
/* ================================================================== */

/**
 * Get error summary from recent logs across all sources.
 */
export async function getErrorSummary(
  params: {
    turnKey?: string;
    startTime?: string;
    endTime?: string;
    limit?: number;
  },
  options: BackendNodeRequestOptions = {}
) {
  const allRecords: ParsedLogRecord[] = [];

  // Collect from all sources
  const appLogs = parseAppLogs({
    turnKey: params.turnKey,
    startTime: params.startTime,
    endTime: params.endTime,
    level: "error",
    limit: params.limit ?? 100,
  });
  allRecords.push(...appLogs);

  const llmLogs = parseLlmLogs({
    turnKey: params.turnKey,
    startTime: params.startTime,
    endTime: params.endTime,
    limit: params.limit ?? 100,
  });
  // Only include error LLM logs
  allRecords.push(...llmLogs.filter((r) => r.level === "error"));

  try {
    if (params.turnKey) {
      const backendLogs = await queryBackendLogs(
        {
          turnKey: params.turnKey,
          limit: params.limit ?? 100,
        },
        options
      );
      allRecords.push(...backendLogs.filter((r) => r.level === "error"));
    }
  } catch {
    // Backend log query failure is non-blocking.
  }

  return extractErrors(allRecords, params.limit ?? 100);
}
