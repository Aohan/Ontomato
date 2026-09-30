import { createModel } from "../../config/model-factory";
import { modelAgentName } from "../../logging/model-agents";
import { renderPrompt } from "../../core/prompts/loader";
import { applyFieldDisplayPlan, type Dataset, type FieldDisplayPlan } from "./adapter";
import { createLogger } from "../../logging/logger";
import { getConclusionPrefix, tForLocale, tApp } from "../../i18n";
import { buildModelDataView, type ModelDataView } from "../../utils/model-data-view";

const logger = createLogger("conclusion");

interface ConclusionResultset {
  name: string;
  totalRows: number;
  columns: string[];
  dataView: ModelDataView<Record<string, unknown>>;
  fieldDisplayPlan?: FieldDisplayPlan;
  statistics?: {
    numericColumns: Array<{
      column: string;
      max: number;
      maxRow?: Record<string, unknown>;
      min: number;
      minRow?: Record<string, unknown>;
      sum: number;
      avg: number;
      count: number;
    }>;
  };
}

const CONCLUSION_PROMPT_BUDGET = {
  maxCellChars: 120,
  maxColsPerRow: 20,
  maxDepth: 2,
  maxArrayItems: 12,
  maxObjectKeys: 16,
};

function stripHtmlToBriefText(s: string): string {
  if (/<(table|thead|tbody|tr|td|th|details|summary)\b/i.test(s)) {
    return tApp("queryFixed.225");
  }
  if (/<[a-z][\s\S]*>/i.test(s)) {
    return s.replace(/<[^>]+>/g, "").trim();
  }
  return s;
}

function clampString(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 12)) + tApp("queryFixed.226");
}

function formatMaybeUnixTsToCN(val: unknown): string | null {
  const s = String(val).trim();
  if (!/^\d+$/.test(s)) return null;

  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;

  const toCN = (ms: number) => {
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleString("zh-CN", { hour12: false });
  };
  const isReasonableYear = (ms: number) => {
    const y = new Date(ms).getUTCFullYear();
    return y >= 1970 && y <= 2100;
  };

  const ms = s.length === 10 ? n * 1000 : s.length === 12 || s.length === 13 ? n : null;
  if (ms === null) return null;

  if (isReasonableYear(ms)) return toCN(ms);
  if (ms % 10 === 0) {
    const ms2 = ms / 10;
    if (isReasonableYear(ms2)) return toCN(ms2);
  }
  return null;
}

function shrinkValueForPrompt(value: unknown, depth: number): unknown {
  const { maxCellChars, maxDepth, maxArrayItems, maxObjectKeys } = CONCLUSION_PROMPT_BUDGET;

  if (value == null) return value;
  const t = typeof value;

  if (t === "string") {
    const ts = formatMaybeUnixTsToCN(value);
    if (ts) return ts;
    return clampString(stripHtmlToBriefText(String(value).trim()), maxCellChars);
  }

  if (t === "number") {
    const ts = formatMaybeUnixTsToCN(value);
    if (ts) return ts;
    return value;
  }

  if (t === "boolean") return value;

  if (depth >= maxDepth) {
    if (Array.isArray(value)) return `[Array(${value.length})]`;
    return "[Object]";
  }

  if (Array.isArray(value)) {
    const head = value.slice(0, maxArrayItems).map((v) => shrinkValueForPrompt(v, depth + 1));
    const remain = value.length - head.length;
    return remain > 0 ? [...head, `…(+${remain})`] : head;
  }

  if (t === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, maxObjectKeys);
    const obj: Record<string, unknown> = {};
    for (const [k, v] of entries) obj[k] = shrinkValueForPrompt(v, depth + 1);
    const remain = Object.keys(value as Record<string, unknown>).length - entries.length;
    if (remain > 0) obj._more = `…(+${remain} keys)`;
    return obj;
  }

  return clampString(String(value), maxCellChars);
}

function shrinkRowForPrompt(
  row: Record<string, unknown>,
  maxCols: number
): Record<string, unknown> {
  const keys = Object.keys(row);
  const kept = keys.slice(0, maxCols);

  const out: Record<string, unknown> = {};
  for (const k of kept) out[k] = shrinkValueForPrompt(row[k], 0);

  const remain = keys.length - kept.length;
  if (remain > 0) out._more = `…(+${remain} cols)`;
  return out;
}

function collectColumns(rows: Record<string, unknown>[]) {
  const s = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) s.add(k);
  return Array.from(s);
}

function extractNumericStatistics(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return [];

  const columns = collectColumns(rows);
  const numericColumns: Array<{
    column: string;
    max: number;
    maxRow?: Record<string, unknown>;
    min: number;
    minRow?: Record<string, unknown>;
    sum: number;
    avg: number;
    count: number;
  }> = [];

  for (const col of columns) {
    const values: number[] = [];
    const valueWithRows: Array<{ value: number; row: Record<string, unknown> }> = [];

    for (const row of rows) {
      const val = row[col];
      let numVal: number | null = null;
      if (typeof val === "number" && Number.isFinite(val)) {
        numVal = val;
      } else if (typeof val === "string") {
        const cleaned = val.trim().replace(/[%$,]/g, "");
        const parsed = Number(cleaned);
        if (Number.isFinite(parsed)) numVal = parsed;
      }

      if (numVal !== null) {
        values.push(numVal);
        valueWithRows.push({ value: numVal, row });
      }
    }

    if (values.length > 0) {
      const max = Math.max(...values);
      const min = Math.min(...values);
      const sum = values.reduce((a, b) => a + b, 0);
      const avg = sum / values.length;
      const maxRow = valueWithRows.find((v) => v.value === max)?.row;
      const minRow = valueWithRows.find((v) => v.value === min)?.row;

      numericColumns.push({
        column: col,
        max,
        maxRow,
        min,
        minRow,
        sum,
        avg,
        count: values.length,
      });
    }
  }

  return numericColumns;
}

function buildResultsetsForPrompt(datasets: Dataset[], locale?: string): ConclusionResultset[] {
  const { maxColsPerRow } = CONCLUSION_PROMPT_BUDGET;

  return datasets.map((ds) => {
    const rawRows = Array.isArray(ds.data) ? ds.data : [];
    const rows = ds.fieldDisplayPlan
      ? applyFieldDisplayPlan(rawRows, ds.fieldDisplayPlan, locale)
      : rawRows;
    const totalRows = rawRows.length;
    const promptRows = rows.map((row) => shrinkRowForPrompt(row, maxColsPerRow));

    const colsAll = collectColumns(rows);
    const colsKept = colsAll.slice(0, maxColsPerRow);
    const colsRemain = colsAll.length - colsKept.length;
    const columns = colsRemain > 0 ? [...colsKept, `…(+${colsRemain} cols)`] : colsKept;

    return {
      name: ds.description || tApp("queryFixed.227"),
      totalRows,
      columns,
      dataView: buildModelDataView(promptRows),
      fieldDisplayPlan: ds.fieldDisplayPlan,
      statistics: {
        numericColumns: extractNumericStatistics(rows),
      },
    };
  });
}

function buildGenericConclusionPrompt(
  originalQuestion: string,
  resultsets: ConclusionResultset[],
  locale?: string
): string {
  const safeStringify = (v: unknown) => {
    try {
      return JSON.stringify(v);
    } catch {
      return '"[Unserializable]"';
    }
  };

  const resultsetsDesc = resultsets
    .map((rs, idx) => {
      let statsDesc = "";
      if (rs.statistics && rs.statistics.numericColumns.length > 0) {
        const statsLines = rs.statistics.numericColumns.map((col) => {
          let line = tApp("queryFixed.220", { v0: (col.column), v1: (col.max), v2: (col.count) });
          if (col.maxRow) {
            const simplifiedRow: Record<string, unknown> = {};
            const keys = Object.keys(col.maxRow).slice(0, 5);
            for (const k of keys) simplifiedRow[k] = col.maxRow[k];
            line += tApp("queryFixed.221", { v0: (safeStringify(simplifiedRow)) });
          }
          return line;
        });
        statsDesc = tApp("queryFixed.222", { v0: (statsLines.join("\n")) });
      }

      const displayPlan = rs.fieldDisplayPlan
        ? tApp("queryFixed.223", { v0: (safeStringify(rs.fieldDisplayPlan)) })
        : "";
      return tApp("queryFixed.224", { v0: (idx + 1), v1: (rs.name || tApp("queryFixed.228")), v2: (rs.totalRows), v3: (rs.columns.join(
        ", "
      )), v4: (displayPlan), v5: (statsDesc), v6: (safeStringify(rs.dataView)) });
    })
    .join("\n\n");

  return renderPrompt(
    "data-query.conclusion.user",
    {
      originalQuestion,
      resultsetsDesc,
      conclusionPrefix: getConclusionPrefix(locale),
    },
    locale
  );
}

function styleConclusionPrefix(prefix: string): string {
  const match = prefix.match(/^(📌\s*)(.*?)([:：]\s*)$/);
  if (!match) return prefix;
  return `${match[1]}<strong class="ai-conclusion">${match[2]}</strong>${match[3]}`;
}

export async function streamConclusion(
  originalQuestion: string,
  datasets: Dataset[],
  prefix: string,
  push: (content: string) => void,
  signal?: AbortSignal,
  locale?: string
): Promise<string> {
  const plainPrefix = getConclusionPrefix(locale);
  const styledPrefix = styleConclusionPrefix(plainPrefix);

  const resultsetsForPrompt = buildResultsetsForPrompt(datasets, locale);

  if (resultsetsForPrompt.length === 0 || resultsetsForPrompt.every((rs) => rs.totalRows === 0)) {
    const emptyConclusion = tForLocale(locale, "query.conclusion.noDataFound");
    const fullContent = `${prefix}\n\n${emptyConclusion}\n`;
    push(fullContent);
    return fullContent;
  }

  const model = await createModel({ temperature: 0.3, agentName: modelAgentName("conclusion") });
  const prompt = buildGenericConclusionPrompt(originalQuestion, resultsetsForPrompt, locale);

  let fullContent = prefix + "\n\n";

  try {
    const stream = await model.stream(prompt, { signal });

    for await (const chunk of stream) {
      const text = chunk.content;
      if (typeof text === "string") {
        fullContent += text;
        const patched = fullContent.replace(plainPrefix, styledPrefix);
        push(patched);
      }
    }

    const ensured = fullContent.replace(plainPrefix, styledPrefix);
    return ensured.endsWith("\n") ? ensured : ensured + "\n";
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && (error.name === "AbortError" || /abort/i.test(error.message)))
    ) {
      throw error;
    }
    logger.error("[Conclusion] Error:", error);
    const fallback = tForLocale(locale, "query.conclusion.errorFallback");
    const fallbackContent = `${prefix}\n\n${fallback}\n`;
    push(fallbackContent);
    return fallbackContent;
  }
}
