import type { DiagnosticEventRecord } from "./workspace-artifact/logic/diagnostic-events-parser";
import type { LogicItem } from "./workspace-artifact/logic/types";

/**
 * The M3 query logic assembled by the app. Parameters and return values use only shared events and logic items.
 * When the open-source app assembles null, the shared parsing never calls these methods.
 */
export interface M3QueryLogic {
  itemFromEvent(
    eventType: "m3.query.succeeded" | "m3.query.failed",
    event: DiagnosticEventRecord,
    payload: Record<string, unknown>
  ): LogicItem | null;
  recordMqls(record: Record<string, unknown>): string | string[] | undefined;
  appendItemMarkdown(lines: string[], item: LogicItem): void;
}

/**
 * Diagnosis's understanding of the data engine's M3 data platform: M3 query events and MQL, and the MQL query language.
 * The enterprise app assembles the object; the open-source app assembles null (it never parsed these).
 * This decides diagnosis output only and says nothing about whether the data engine supports M3.
 */
export interface M3DiagnosticSupport {
  queryLogic: M3QueryLogic;
  /** The query language submitted when the data adapter is m3. */
  queryLanguage: "MQL";
  /**
   * The authoring hint the enterprise app appends when the adapter is m3 and the reference file exists.
   * When the open-source app assembles null the file is never read.
   */
  mqlReference: {
    fileName: string;
    hint: (absolutePath: string) => string;
  };
}

let installed: M3DiagnosticSupport | null | undefined;

export function installM3DiagnosticSupport(support: M3DiagnosticSupport | null): void {
  installed = support;
}

export function m3DiagnosticSupport(): M3DiagnosticSupport | null {
  if (installed === undefined) throw new Error("M3 diagnostic support is not installed");
  return installed;
}
