import { normalizeAnswerRows, type Dataset, type FieldDisplayPlan } from "../adapter";
import { parseQueryAnswerPayload } from "../protocol";
import { tForLocale, tApp } from "../../../i18n";
import type { HarnessDataContent } from "./abc-harness-payload";

export function normalizeRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return normalizeAnswerRows(data);
  }

  return normalizeAnswerRows(parseQueryAnswerPayload(data, "ABC Harness DATA_TYPE").answer);
}

export function collectColumns(rows: Record<string, unknown>[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row || {})) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

function datasetName(question: string, index: number): string {
  const base = (question || tApp("queryFixed.208", { v0: (index + 1) }))
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, "_")
    .slice(0, 50);
  return base || `dataset_${index + 1}`;
}

export function buildDataset(
  content: HarnessDataContent,
  index: number,
  rows: Record<string, unknown>[],
  fieldDisplayPlan?: FieldDisplayPlan,
  locale?: string
): Dataset {
  const question =
    content.question || tForLocale(locale, "query.datasetFallbackTitle", { index: index + 1 });
  return {
    name: datasetName(question, index),
    description: question,
    columns: collectColumns(rows),
    data: rows,
    subQuestion: question,
    fieldDisplayPlan,
  };
}
