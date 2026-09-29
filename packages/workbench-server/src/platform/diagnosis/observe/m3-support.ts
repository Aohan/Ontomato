import type { FlatService, SystemStatus } from "./agent/tools/service-health-tool";
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
 * The M3 operations service assembled by the app.
 * The shared report still produces statistics, status copy, and the detail skeleton; the copy below is used only on non-critical services this provider reports.
 */
export interface M3ServiceHealth {
  services(status: SystemStatus): FlatService[];
  summaryNote: string;
  /** In details, the marker appended after the status of a non-critical service that is not running. Critical services' ⚠️ is still written by the shared renderer. */
  unusedDetailMark: string;
  /** Separator between a provider-written note and the status before it. */
  noteSeparator: string;
  /** Lead-in for non-critical services that are not running when no critical service has failed. */
  unusedDownIntro(count: number): string;
  /** Lead-in for non-critical services that are not running when a critical service has failed. */
  unusedDownAlso(count: number): string;
  unusedDownItem(group: string, name: string, statusText: string): string;
}

/**
 * Diagnosis's understanding of the data engine's M3 data platform: M3 query events and MQL, M3 services in operations status, and the MQL query language.
 * The enterprise app assembles the object; the open-source app assembles null (it never parsed these).
 * This decides diagnosis output only and says nothing about whether the data engine supports M3.
 */
export interface M3DiagnosticSupport {
  queryLogic: M3QueryLogic;
  serviceHealth: M3ServiceHealth;
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
