import type { ErrorSummary, ParsedLogRecord } from "@ontomato/contracts/observe";
/**
 * Error extractor.
 *
 * Scans all parsed log records and extracts error/warn summaries.
 */

/**
 * Extract error and warning records from a collection of parsed logs.
 *
 * @param records - All parsed log records to scan
 * @param maxPerCategory - Maximum entries to keep per category (default 100)
 */
export function extractErrors(records: ParsedLogRecord[], maxPerCategory = 100): ErrorSummary {
  const errors: ParsedLogRecord[] = [];
  const warnings: ParsedLogRecord[] = [];

  for (const record of records) {
    if (record.level === "error") {
      if (errors.length < maxPerCategory) {
        errors.push(record);
      }
    } else if (record.level === "warn") {
      if (warnings.length < maxPerCategory) {
        warnings.push(record);
      }
    }
  }

  return {
    totalErrors: errors.length,
    totalWarnings: warnings.length,
    errors,
    warnings,
  };
}

/**
 * Extract only error records, sorted by time (newest first).
 */
export function extractErrorRecords(records: ParsedLogRecord[]): ParsedLogRecord[] {
  return records
    .filter((r) => r.level === "error")
    .sort((a, b) => {
      if (!a.time || !b.time) return 0;
      return b.time.localeCompare(a.time);
    });
}
