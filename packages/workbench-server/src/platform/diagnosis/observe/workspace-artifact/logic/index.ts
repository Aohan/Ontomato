import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../../../../../logging/logger";
import { ARTIFACT_DIRS } from "../utils";
import { parseDiagnosticEvents } from "./diagnostic-events-parser";
import { m3DiagnosticSupport } from "../../m3-support";
import { workbenchProduct } from "../../../../../product/installed";
import type { LogicItem, LogicExtractionResult } from "./types";
import { tApp } from "../../../../../i18n";


export type { LogicItem, LogicExtractionResult } from "./types";

const logger = createLogger("workspace-artifact:logic");

export interface ExtractLogicOptions {
  artifactDir: string;
  sessionIds?: string[];
}

/**
 * Extract query logic from datarag diagnostic-events.
 */
export async function extractLogic(options: ExtractLogicOptions): Promise<LogicExtractionResult> {
  const { artifactDir, sessionIds } = options;

  const parsed = parseDiagnosticEvents(artifactDir, sessionIds);
  const items = parsed.items;

  if (items.length === 0) {
    logger.debug("No diagnostic-events logic items extracted", {
      fileExists: parsed.fileExists,
      parsedCount: parsed.parsedCount,
      matchedCount: parsed.matchedCount,
      parseErrorCount: parsed.parseErrorCount,
    });
    return { items: [], markdown: "" };
  }

  const deduped = deduplicateItems(items);
  if (parsed.finalCalculation) {
    const target = deduped.find((i) => i.status !== "error") ?? deduped[0];
    target.finalCalculation = parsed.finalCalculation;
  }
  const markdown = buildLogicMarkdown(deduped);

  if (markdown) {
    const diagDir = path.join(artifactDir, ARTIFACT_DIRS.DIAGNOSTICS);
    fs.mkdirSync(diagDir, { recursive: true });
    fs.writeFileSync(
      path.join(diagDir, workbenchProduct().diagnosisWorkspaceNames.queryLogicFile),
      markdown,
      "utf-8"
    );
    logger.debug("Logic extracted", { subQueries: deduped.length });
  }

  return { items: deduped, markdown };
}

function deduplicateItems(items: LogicItem[]): LogicItem[] {
  const deduped: LogicItem[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of items) {
    const problem = (item.problem ?? "").trim();
    const sessionId = (item.sessionId ?? "").trim();
    const isError = item.status === "error";

    if (!problem) {
      deduped.push(item);
      continue;
    }

    const key = `${sessionId}::${problem}`;
    const existingIdx = indexByKey.get(key);

    if (existingIdx == null) {
      indexByKey.set(key, deduped.length);
      deduped.push(item);
    } else {
      const existingIsError = deduped[existingIdx].status === "error";
      if (existingIsError && !isError) {
        deduped[existingIdx] = item;
      } else if (!existingIsError && isError) {
        // keep existing success, skip this error
      } else {
        deduped[existingIdx] = item;
      }
    }
  }

  return deduped;
}

function buildLogicMarkdown(items: LogicItem[]): string {
  const lines: string[] = [];

  let subIndex = 0;
  for (const item of items) {
    subIndex++;
    lines.push(tApp("diag.observe.workspace-artifact.logic.index.0", { p0: subIndex }));
    if (item.problem) {
      lines.push(tApp("diag.observe.workspace-artifact.logic.index.1", { p0: item.problem }));
    }
    if (item.status === "error") {
      lines.push(tApp("diag.observe.workspace-artifact.logic.index.2"));
    }
    lines.push("");
    m3DiagnosticSupport()?.queryLogic.appendItemMarkdown(lines, item);

    if (item.status === "error" && item.error) {
      lines.push("");
      lines.push(tApp("diag.observe.workspace-artifact.logic.index.3"));
      lines.push(item.error);
    }

    lines.push("");
  }

  if (items.some((i) => i.finalCalculation)) {
    const calc = items.find((i) => i.finalCalculation)!.finalCalculation!;
    lines.push(tApp("diag.observe.workspace-artifact.logic.index.4"));
    lines.push(calc);
  }

  return lines.join("\n").trim();
}
