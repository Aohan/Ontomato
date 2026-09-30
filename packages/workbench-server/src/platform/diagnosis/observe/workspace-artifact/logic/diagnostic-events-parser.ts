import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../../../../../logging/logger";
import { ARTIFACT_DIRS } from "../utils";
import type { LogicItem } from "./types";
import { m3DiagnosticSupport } from "../../m3-support";

const logger = createLogger("workspace-artifact:logic:diagnostic-events");
const DIAGNOSTIC_EVENTS_FILE = "diagnostic-events.jsonl";

export interface DiagnosticEventParseResult {
  items: LogicItem[];
  finalCalculation?: string;
  fileExists: boolean;
  parsedCount: number;
  matchedCount: number;
  parseErrorCount: number;
}

export interface DiagnosticEventRecord {
  eventType?: string;
  type?: string;
  sessionId?: string;
  payload?: unknown;
}

export function parseDiagnosticEvents(
  artifactDir: string,
  sessionIds?: string[]
): DiagnosticEventParseResult {
  const filePath = path.join(artifactDir, ARTIFACT_DIRS.RAW_LOGS, DIAGNOSTIC_EVENTS_FILE);
  if (!fs.existsSync(filePath)) {
    return emptyResult(false);
  }

  const result = emptyResult(true);
  const lines = fs
    .readFileSync(filePath, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.trim());

  for (const line of lines) {
    const event = parseLine(line);
    if (!event) {
      result.parseErrorCount++;
      continue;
    }

    result.parsedCount++;
    if (sessionIds && sessionIds.length > 0 && !eventMatchesSession(event.sessionId, sessionIds))
      continue;
    result.matchedCount++;

    const eventType = event.eventType ?? event.type;
    const payload = asRecord(event.payload);
    switch (eventType) {
      case "m3.query.succeeded":
      case "m3.query.failed": {
        // Only apps with M3 support assembled parse M3 query events (the enterprise's original behavior); the open-source app originally ignored both event kinds.
        const m3 = m3DiagnosticSupport();
        if (!m3) break;
        const item = m3.queryLogic.itemFromEvent(eventType, event, payload);
        if (item) result.items.push(item);
        break;
      }
      case "knowledge.verifier.completed": {
        result.items.push(...buildKnowledgeVerifierItems(event, payload));
        break;
      }
      case "question.split.completed": {
        const finalCalculation = stringValue(payload.finalCalculation);
        if (finalCalculation) result.finalCalculation = finalCalculation;
        break;
      }
      default:
        break;
    }
  }

  if (result.parseErrorCount > 0) {
    logger.debug("Some diagnostic-events lines could not be parsed", {
      artifactDir,
      parseErrorCount: result.parseErrorCount,
    });
  }

  return result;
}

function emptyResult(fileExists: boolean): DiagnosticEventParseResult {
  return {
    items: [],
    fileExists,
    parsedCount: 0,
    matchedCount: 0,
    parseErrorCount: 0,
  };
}

function parseLine(line: string): DiagnosticEventRecord | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as DiagnosticEventRecord;
  } catch {
    return null;
  }
}

function buildKnowledgeVerifierItems(
  event: DiagnosticEventRecord,
  payload: Record<string, unknown>
): LogicItem[] {
  const items: LogicItem[] = [];
  const topLevel = buildKnowledgeVerifierItem(event, payload);
  if (topLevel) items.push(topLevel);

  for (const value of arrayValue(payload.usedCards) ?? []) {
    const card = asRecord(value);
    const item = buildKnowledgeVerifierItem(event, card);
    if (item) items.push(item);
  }

  return items;
}

function buildKnowledgeVerifierItem(
  event: DiagnosticEventRecord,
  record: Record<string, unknown>
): LogicItem | null {
  const problem = firstString(record.problem, record.question, record.title);
  const mqls = m3DiagnosticSupport()?.queryLogic.recordMqls(record);
  if (!problem && !mqls) return null;

  return {
    problem,
    mqls,
    status: "success",
    sessionId: event.sessionId,
  };
}

export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function eventMatchesSession(eventSessionId: string | undefined, sessionIds: string[]): boolean {
  return (
    !!eventSessionId &&
    sessionIds.some(
      (sessionId) => eventSessionId === sessionId || eventSessionId.startsWith(`${sessionId}-`)
    )
  );
}
