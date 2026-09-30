import type { ParsedLogRecord } from "@ontomato/contracts/observe";
import { extractSessionIdFromText } from "./session-id";
import { normalizeLevel } from "./parse-helpers";

const JAVA_LOG_RE =
  /^(?<epochMillis>\d{13})\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\s+\[(?<thread>[^\]]+)]\s+(?<level>[A-Z]+)\s+(?<logger>.+?)\s+-\s*(?<message>.*)$/;
const EPOCH_MILLIS_PREFIX_RE = /^(\d{13})\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\s/;

export function parseJavaLogLine(line: string): ParsedLogRecord {
  const match = JAVA_LOG_RE.exec(line);
  if (match?.groups) {
    const { epochMillis, thread, level, logger, message } = match.groups;
    return {
      source: "backend",
      time: new Date(Number(epochMillis)).toISOString(),
      level: normalizeLevel(level),
      sessionId: extractSessionIdFromText(line),
      thread,
      logger: logger?.trim(),
      message: (message ?? "").trim(),
    };
  }

  return {
    source: "backend",
    sessionId: extractSessionIdFromText(line),
    message: line,
  };
}

export function parseJavaLogEpochMillis(line: string): number | null {
  const match = EPOCH_MILLIS_PREFIX_RE.exec(line);
  return match ? Number(match[1]) : null;
}

export function extractJavaLogMessage(line: string): string {
  const parsed = parseJavaLogLine(line);
  return parsed.message || line;
}
