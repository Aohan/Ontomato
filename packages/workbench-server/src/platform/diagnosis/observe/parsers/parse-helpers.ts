import type { LogLevel } from "@ontomato/contracts/observe";
/**
 * Shared parsing helper functions for observe log parsers.
 *
 * Consolidates repeated utilities: normalizeLevel and extractString.
 * Used by app-log-parser, llm-log-parser, backend-log-line, and live-logs.
 */

/**
 * Normalize a raw log level string to the standard LogLevel type.
 *
 * Handles common aliases:
 * - "warning" -> "warn"
 * - "severe" / "fatal" / "critical" -> "error"
 *
 * Returns undefined if the level string is not recognized.
 */
export function normalizeLevel(level?: string): LogLevel | undefined {
  if (!level) return undefined;
  const l = level.toLowerCase();
  if (l === "debug" || l === "info" || l === "warn" || l === "error") return l;
  if (l === "warning") return "warn";
  if (l === "severe" || l === "fatal" || l === "critical") return "error";
  return undefined;
}

/**
 * Extract the first non-empty string value from a record,
 * trying multiple keys in order.
 */
export function extractString(
  fields: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const val = fields[key];
    if (typeof val === "string" && val) return val;
  }
  return undefined;
}
