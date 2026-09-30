/**
 * SessionID extractor for workspace artifacts.
 *
 * Scans the collected app.log to find a sessionId value.
 * The sessionId is used to locate backend evidence. The backendNodeId, when
 * present, identifies the datarag node before falling back to the registry.
 */

import fs from "node:fs";
import path from "node:path";
import { extractBackendNodeIdFromObject, extractSessionIdFromObject } from "../parsers/session-id";
import { ARTIFACT_DIRS } from "./utils";

/**
 * Extract the first sessionId found in app.log.
 *
 * Scans each JSON line for:
 * 1. A top-level `sessionId` field
 * 2. A `sessionId` inside `data`
 * 3. A `sessionId=<value>` pattern in the `message` string
 *
 * Returns the first non-empty sessionId, or null if none found.
 */
export function extractSessionId(artifactDir: string): string | null {
  return extractFromAppLog(artifactDir, extractSessionIdFromObject);
}

export function extractBackendNodeId(artifactDir: string): string | null {
  return extractFromAppLog(artifactDir, extractBackendNodeIdFromObject);
}

function extractFromAppLog(
  artifactDir: string,
  extractor: (value: unknown) => string | undefined
): string | null {
  const logFile = path.join(artifactDir, ARTIFACT_DIRS.RAW_LOGS, "app.log");

  if (!fs.existsSync(logFile)) {
    return null;
  }

  const content = fs.readFileSync(logFile, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());

  for (const line of lines) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const value = extractor(obj);
    if (value) return value;
  }

  return null;
}
