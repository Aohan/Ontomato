import type { AbcProgramDashboard } from "@ontomato/contracts/dashboard";
import { createModel } from "../../config/model-factory";
import { modelAgentName } from "../../logging/model-agents";
import { renderPrompt } from "../../core/prompts/loader";
import { resolveLocale } from "../../i18n/index";
import { tForLocale, tApp } from "../../i18n";
import type { QueryAnswerPayload } from "./protocol";
import { buildModelDataView } from "../../utils/model-data-view";
import { workbenchProduct } from "../../product/installed";

export type FieldDisplayPlanItem = {
  displayName: string;
  kind: "duration" | "datetime" | "percent" | "none";
  sourceUnit?: TimeUnit;
  targetUnit?: TimeUnit;
  percentSource?: PercentSource;
  decimals?: number;
};

export type FieldDisplayPlan = Record<string, FieldDisplayPlanItem>;

export interface Dataset {
  name: string;
  description: string;
  columns: string[];
  data: Record<string, unknown>[];
  dsl?: unknown;
  abcProgram?: AbcProgramDashboard;
  subQuestion?: string;
  fieldDisplayPlan?: FieldDisplayPlan;
}

export function normalizeAnswerRows(answer: unknown[]): Record<string, unknown>[] {
  const isPrimitive = (v: unknown) =>
    v === null ||
    v === undefined ||
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean";

  if (answer.every(isPrimitive)) {
    return answer.map((v) => ({ value: v }));
  }

  return answer.filter(
    (r) => r && typeof r === "object" && Object.keys(r as Record<string, unknown>).length > 0
  ) as Record<string, unknown>[];
}

export function rowsFromQueryAnswerPayloads(
  payloads: QueryAnswerPayload[]
): Record<string, unknown>[] {
  return payloads.flatMap((payload) => normalizeAnswerRows(payload.answer));
}

const TZ_CN = "Asia/Shanghai";

function isISODateTimeString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(s);
}

const RE_SPACE_DATETIME = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

function isSpaceSeparatedDatetime(s: string): boolean {
  return RE_SPACE_DATETIME.test(s.trim());
}

function formatInCNTimeZone(date: Date, withTime: boolean, locale?: string): string {
  const dtf = new Intl.DateTimeFormat(locale ? resolveLocale(locale) : "sv-SE", {
    timeZone: TZ_CN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime
      ? {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }
      : {}),
  });
  return dtf.format(date);
}

function getHMSInCNTimeZone(date: Date): string {
  const dtf = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ_CN,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return dtf.format(date);
}

function formatISOToCN(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const hms = getHMSInCNTimeZone(d);
  if (hms === "00:00:00") return formatInCNTimeZone(d, false, locale);
  return formatInCNTimeZone(d, true, locale);
}

function formatSpaceSepDatetime(raw: string, locale?: string): string {
  const cleaned = raw.trim().replace(/\.\d+$/, "");
  const d = new Date(cleaned);
  if (Number.isNaN(d.getTime())) return raw;

  const hms = getHMSInCNTimeZone(d);
  if (hms === "00:00:00") return formatInCNTimeZone(d, false, locale);
  return formatInCNTimeZone(d, true, locale);
}

function simplifyTimeString(val: unknown, locale?: string): string | null {
  if (typeof val !== "string") return null;
  const s = val.trim();
  if (isISODateTimeString(s)) return formatISOToCN(s, locale);
  if (isSpaceSeparatedDatetime(s)) return formatSpaceSepDatetime(s, locale);
  return null;
}

export function formatTimeLabel(text: unknown, locale?: string): string {
  const simplified = simplifyTimeString(text, locale);
  if (simplified) return simplified;
  return String(text ?? "");
}

export type TimeUnit = "ms" | "s" | "min" | "h" | "day";

const TIME_UNIT_TO_MS: Record<TimeUnit, number> = {
  ms: 1,
  s: 1000,
  min: 60 * 1000,
  h: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

export type PercentSource = "ratio" | "percent";

const isNumericLike = (v: unknown) =>
  typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()));

const TIME_UNITS = new Set<TimeUnit>(["ms", "s", "min", "h", "day"]);
const PERCENT_SOURCES = new Set<PercentSource>(["ratio", "percent"]);

function isTimeUnit(value: unknown): value is TimeUnit {
  return typeof value === "string" && TIME_UNITS.has(value as TimeUnit);
}

function isPercentSource(value: unknown): value is PercentSource {
  return typeof value === "string" && PERCENT_SOURCES.has(value as PercentSource);
}

function convertDurationValue(val: unknown, from: TimeUnit, to: TimeUnit): unknown {
  if (!isNumericLike(val)) return val;
  const n = Number(val);
  if (!Number.isFinite(n)) return val;
  const ms = n * TIME_UNIT_TO_MS[from];
  const out = ms / TIME_UNIT_TO_MS[to];
  return out;
}

function convertPercentValueToNumber(val: unknown, source: PercentSource): unknown {
  if (typeof val === "string") {
    const s = val.trim();
    const m = s.match(/^(-?\d+(\.\d+)?)\s*%$/);
    if (m) {
      const n = Number(m[1]);
      return Number.isFinite(n) ? n : val;
    }
  }

  if (!isNumericLike(val)) return val;
  const n = Number(val);
  if (!Number.isFinite(n)) return val;
  if (source === "ratio") return n * 100;
  return n;
}

function roundDisplayValue(value: unknown, decimals?: number): unknown {
  if (typeof value !== "number" || typeof decimals !== "number") return value;
  return Number(value.toFixed(decimals));
}

function collectAllHeaders(rows: Array<Record<string, unknown>>): string[] {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        headers.push(k);
      }
    }
  }
  return headers;
}

function stripFencesJson(s: string) {
  return String(s || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function tryParseJSON<T>(text: string): T | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function fallbackDisplayPlan(headers: string[], locale?: string): FieldDisplayPlan {
  return Object.fromEntries(
    headers.map((header) => [
      header,
      {
        displayName:
          header === workbenchProduct().groupColumnHeader
            ? tForLocale(locale, "query.display.groupColumn")
            : header,
        kind: "none" as const,
      },
    ])
  );
}

function normalizeDecimals(value: unknown, fallback?: number): number | undefined {
  if (!Number.isInteger(value) || Number(value) < 0) return fallback;
  return Math.min(6, Number(value));
}

export async function createFieldDisplayPlan(
  rows: Record<string, unknown>[],
  options: {
    subQuestion: string;
    signal?: AbortSignal;
    outputKeyDescriptionMDTable?: string;
    code?: string;
    locale?: string;
  }
): Promise<FieldDisplayPlan> {
  const headers = collectAllHeaders(rows);
  if (headers.length === 0) return {};
  const fallback = fallbackDisplayPlan(headers, options.locale);

  try {
    const model = await createModel({ temperature: 0.1, agentName: modelAgentName("fieldAdapter") });
    const prompt = renderPrompt(
      "data-query.field-semantics.user",
      {
        subQuestion: String(options.subQuestion || ""),
        headers: JSON.stringify(headers),
        outputKeyDescriptionMDTable: String(options.outputKeyDescriptionMDTable || "").trim(),
        code: String(options.code || ""),
        dataEvidence: JSON.stringify(buildModelDataView(rows)),
      },
      options.locale
    );
    const response = await model.invoke(prompt, { signal: options.signal });
    const parsed = tryParseJSON<Record<string, unknown>>(
      stripFencesJson(String((response as any)?.content ?? ""))
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;

    const plan = { ...fallback };
    for (const header of headers) {
      const rawItem = parsed[header];
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) continue;
      const item = rawItem as Record<string, unknown>;
      const displayName =
        typeof item.displayName === "string" && item.displayName.trim()
          ? item.displayName.trim()
          : fallback[header].displayName;

      if (item.kind === "duration" && isTimeUnit(item.sourceUnit) && isTimeUnit(item.targetUnit)) {
        plan[header] = {
          displayName,
          kind: "duration",
          sourceUnit: item.sourceUnit,
          targetUnit: item.targetUnit,
          decimals: normalizeDecimals(item.decimals),
        };
      } else if (item.kind === "percent" && isPercentSource(item.percentSource)) {
        plan[header] = {
          displayName,
          kind: "percent",
          percentSource: item.percentSource,
          decimals: normalizeDecimals(item.decimals, 2),
        };
      } else {
        plan[header] = {
          displayName,
          kind: item.kind === "datetime" ? "datetime" : "none",
        };
      }
    }
    return plan;
  } catch {
    return fallback;
  }
}

export function applyFieldDisplayPlan(
  rows: Record<string, unknown>[],
  plan: FieldDisplayPlan,
  locale?: string
): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([header, value]) => {
        const item = plan[header];
        if (item?.kind === "duration" && item.sourceUnit && item.targetUnit) {
          return [
            header,
            roundDisplayValue(
              convertDurationValue(value, item.sourceUnit, item.targetUnit),
              item.decimals
            ),
          ];
        }
        if (item?.kind === "percent" && item.percentSource) {
          return [
            header,
            roundDisplayValue(
              convertPercentValueToNumber(value, item.percentSource),
              item.decimals
            ),
          ];
        }
        if (item?.kind === "datetime") {
          return [header, simplifyTimeString(value, locale) ?? value];
        }
        return [header, value];
      })
    )
  );
}

function resolveDisplayNames(headers: string[], plan: FieldDisplayPlan): Map<string, string> {
  const used = new Map<string, number>();
  return new Map(
    headers.map((header) => {
      const base = plan[header]?.displayName || header;
      const count = (used.get(base) || 0) + 1;
      used.set(base, count);
      return [header, count === 1 ? base : `${base}_${count}`];
    })
  );
}

export function applyFieldDisplayNames(
  rows: Record<string, unknown>[],
  plan: FieldDisplayPlan
): Record<string, unknown>[] {
  const displayNames = resolveDisplayNames(collectAllHeaders(rows), plan);

  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([header, value]) => [displayNames.get(header) || header, value])
    )
  );
}

const isPrimitive = (v: unknown): boolean =>
  v === null ||
  v === undefined ||
  typeof v === "string" ||
  typeof v === "number" ||
  typeof v === "boolean";

const isObjectLike = (v: unknown) => v != null && typeof v === "object";
const isComplexCell = (v: unknown) => Array.isArray(v) || (isObjectLike(v) && !isPrimitive(v));

const formatNumber = (n: number, decimals?: number): string => {
  if (typeof decimals === "number") return n.toFixed(decimals);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(4);
};

const looksLikeBlockHtml = (s: string) =>
  /<(table|thead|tbody|tr|td|th|details|summary|div)\b/i.test(s);
const compactForMarkdownCell = (html: string): string => {
  if (!html) return "";
  return html
    .replace(/\r?\n/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
};

function isPlainObjectArray(val: unknown): val is Array<Record<string, unknown>> {
  return (
    Array.isArray(val) &&
    val.length > 0 &&
    val.every(
      (item) =>
        item && typeof item === "object" && !Array.isArray(item) && Object.keys(item).length > 0
    )
  );
}

type ImageItem = {
  path?: string;
  text?: string;
};

function escapeHtmlAttr(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getFileExt(path: string): string {
  const clean = String(path || "").split(/[?#]/)[0] || "";
  const idx = clean.lastIndexOf(".");
  return idx >= 0 ? clean.slice(idx).toLowerCase() : "";
}

function isImageItem(val: unknown): val is ImageItem {
  return (
    !!val &&
    typeof val === "object" &&
    !Array.isArray(val) &&
    typeof (val as Record<string, unknown>).path === "string"
  );
}

function isImageItemArray(val: unknown): val is ImageItem[] {
  return Array.isArray(val) && val.length > 0 && val.every((item) => isImageItem(item));
}

function renderImageArray(arr: ImageItem[], rowIndex: number): string {
  return arr
    .filter((item) => item.path)
    .map((item) => {
      const ext = getFileExt(item.path || "");
      const caption = escapeHtmlAttr(item.text ?? "");
      const pathEscaped = escapeHtmlAttr(item.path || "");

      if (ext === ".pdf") {
        return `<a href="${pathEscaped}" target="_blank" class="da-pdf-thumb-link" data-caption="${caption}"><span class="da-pdf-thumb"></span></a>`;
      }

      return `<img src="${pathEscaped}" alt="" data-caption="${caption}" data-lightbox-group="row-${rowIndex}" class="da-img-thumb" />`;
    })
    .join("");
}

function renderObjectArrayAsSubTable(
  rows: Array<Record<string, unknown>>,
  rowIndex: number,
  depth: number,
  datetimeHeaders?: Set<string>,
  locale?: string
): string {
  const headers = collectAllHeaders(rows);
  if (!headers.length) return "";

  const MAX_ROWS = 10;
  const total = rows.length;

  const renderRows = (items: Array<Record<string, unknown>>, offset = 0) =>
    items
      .map((row, i) => {
        const currentRowIndex = rowIndex >= 0 ? rowIndex * 100 + offset + i : -1;
        const tds = headers
          .map(
            (h) =>
              `<td>${formatCell((row as any)?.[h], currentRowIndex, false, depth + 1, datetimeHeaders?.has(h), undefined, locale)}</td>`
          )
          .join("");
        return `<tr>${tds}</tr>`;
      })
      .join("");

  const thead = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${renderRows(rows.slice(0, MAX_ROWS), 0)}</tbody>`;
  const table = `<table class="da-subtable">${thead}${tbody}</table>`;

  if (total <= MAX_ROWS) return `<div class="da-ts">${table}</div>`;

  const remainTable = `<table class="da-subtable">${thead}<tbody>${renderRows(rows.slice(MAX_ROWS), MAX_ROWS)}</tbody></table>`;
  const summary = tForLocale(locale, "query.hotData.tableFoldSummary", {
    hidden: total - MAX_ROWS,
    total,
  });
  return `<div class="da-ts">${table}<details class="da-ts-more"><summary>${summary}</summary>${remainTable}</details></div>`;
}

function formatCell(
  val: unknown,
  _rowIndex: number,
  isPercent = false,
  depth = 0,
  allowTimestamp = false,
  decimals?: number,
  locale?: string
): string {
  if (isImageItemArray(val)) {
    return compactForMarkdownCell(renderImageArray(val, _rowIndex));
  }

  if (isImageItem(val)) {
    return compactForMarkdownCell(renderImageArray([val], _rowIndex));
  }

  if (depth < 1 && isPlainObjectArray(val)) {
    return compactForMarkdownCell(
      renderObjectArrayAsSubTable(val, _rowIndex, depth, undefined, locale)
    );
  }

  if (typeof val === "string") {
    const simplified = simplifyTimeString(val, locale);
    if (simplified) return simplified;
    return val.replace(/\r?\n/g, "<br/>").replace(/\|/g, "\\|").replace(/```/g, "\\`\\`\\`");
  }

  if (isNumericLike(val)) {
    const rawStr = String(val).trim();

    if (allowTimestamp && /^-?\d+$/.test(rawStr)) {
      const n = Number(rawStr);
      if (Number.isFinite(n) && n > 0) {
        const toCN = (ms: number) => formatISOToCN(new Date(ms).toISOString(), locale);

        const MIN_MS = Date.UTC(1970, 0, 1);
        const MAX_MS = Date.UTC(2101, 0, 1);
        const isMsInRange = (ms: number) => Number.isFinite(ms) && ms >= MIN_MS && ms < MAX_MS;
        const isSecInRange = (sec: number) => Number.isFinite(sec) && isMsInRange(sec * 1000);

        const len = rawStr.length;
        let ms: number | null = null;

        if (len === 10) {
          if (isSecInRange(n)) ms = n * 1000;
        } else if (len === 12 || len === 13) {
          if (isMsInRange(n)) ms = n;
        } else if (len === 14 && n % 10 === 0) {
          const ms2 = n / 10;
          if (isMsInRange(ms2)) ms = ms2;
        }

        if (ms != null) return toCN(ms);
      }
    }

    const num = Number(val);
    if (!Number.isFinite(num)) return rawStr;
    const formatted = formatNumber(num, decimals);
    return isPercent ? `${formatted}%` : formatted;
  }

  let str =
    typeof val === "string"
      ? val
      : val == null
        ? ""
        : (() => {
            try {
              return JSON.stringify(val);
            } catch {
              return String(val);
            }
          })();

  if (looksLikeBlockHtml(str)) {
    return compactForMarkdownCell(str);
  }

  str = str.replace(/\r?\n/g, "<br/>").replace(/\|/g, "\\|").replace(/```/g, "\\`\\`\\`");
  return str;
}

function normalizeData(data: unknown): Record<string, unknown>[] {
  if (!data) return [];

  if (Array.isArray(data)) {
    const isPrimitive = (v: unknown) =>
      v === null ||
      v === undefined ||
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean";

    if (data.every(isPrimitive)) {
      return data.map((v) => ({ value: v }));
    }

    return data.filter(
      (r) => r && typeof r === "object" && Object.keys(r as Record<string, unknown>).length > 0
    ) as Record<string, unknown>[];
  }

  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return normalizeData(parsed);
      }
      return normalizeData([parsed]);
    } catch {
      return [{ raw: data }];
    }
  }

  if (typeof data === "object" && data !== null) {
    return [data as Record<string, unknown>];
  }

  return [];
}

function isPrimaryDimHeader(h: string): boolean {
  const s = String(h);
  const k = s.toLowerCase();
  const headers = workbenchProduct().primaryDimensionHeaders;
  return (
    headers.exact.includes(s) ||
    k === "name" ||
    k.endsWith("_name") ||
    headers.contains.some((word) => s.includes(word))
  );
}

function isTimeHeader(h: string): boolean {
  const k = String(h).toLowerCase();
  // The two escaped literals are Chinese time/date column names matched in
  // user data; both editions must keep recognizing them.
  return (
    h === "\u65f6\u95f4" ||
    h === "\u65e5\u671f" ||
    k === "time" ||
    k === "date" ||
    k.includes("time") ||
    k.includes("date")
  );
}

function inferHeaderKind(h: string, rows: Record<string, unknown>[]) {
  const sampleVals = rows.slice(0, Math.min(20, rows.length)).map((r) => (r as any)?.[h]);
  const hasComplex = sampleVals.some((v) => isComplexCell(v));
  if (hasComplex) return "complex" as const;
  const hasNumber = sampleVals.some((v) => isNumericLike(v));
  if (hasNumber) return "number" as const;
  return "string" as const;
}

function sortHeaders(headers: string[], rows: Record<string, unknown>[]): string[] {
  const headerMeta = headers.map((h, idx) => ({
    h,
    idx,
    kind: inferHeaderKind(h, rows),
  }));

  return headerMeta
    .sort((a, b) => {
      const ra =
        (isPrimaryDimHeader(a.h) ? 0 : 10) +
        (isTimeHeader(a.h) ? 1 : 0) +
        (a.kind === "string" ? 2 : a.kind === "number" ? 3 : 9);
      const rb =
        (isPrimaryDimHeader(b.h) ? 0 : 10) +
        (isTimeHeader(b.h) ? 1 : 0) +
        (b.kind === "string" ? 2 : b.kind === "number" ? 3 : 9);
      if (ra !== rb) return ra - rb;
      return a.idx - b.idx;
    })
    .map((x) => x.h);
}

export function renderDataAsTable(
  data: unknown,
  fieldDisplayPlan: FieldDisplayPlan | undefined,
  options?: {
    maxRows?: number;
    locale?: string;
  }
): string {
  const normalized = normalizeData(data);
  if (normalized.length === 0) {
    return tForLocale(options?.locale, "query.display.empty");
  }
  const plan =
    fieldDisplayPlan || fallbackDisplayPlan(collectAllHeaders(normalized), options?.locale);
  const displayRows = applyFieldDisplayPlan(normalized, plan, options?.locale);

  const finalHeaders = sortHeaders(
    collectAllHeaders(normalized).filter((header) =>
      displayRows.some((row) => {
        const value = row[header];
        return value !== undefined && value !== null && value !== "";
      })
    ),
    displayRows
  );
  if (finalHeaders.length === 0) return tForLocale(options?.locale, "query.display.empty");

  const displayNames = resolveDisplayNames(finalHeaders, plan);
  const divider = finalHeaders.map(() => "---").join(" | ");
  const headerLine = `| ${finalHeaders
    .map((header) => formatCell(displayNames.get(header) || header, -1))
    .join(" | ")} |`;
  const dividerLine = `| ${divider} |`;

  const toLines = (rows: Record<string, unknown>[], offset = 0) =>
    rows
      .map((row, index) => {
        const rowIndex = offset + index;
        return `| ${finalHeaders
          .map((header) => {
            const item = plan[header];
            return formatCell(
              row[header],
              rowIndex,
              item?.kind === "percent",
              0,
              item?.kind === "datetime",
              item?.decimals,
              options?.locale
            );
          })
          .join(" | ")} |`;
      })
      .join("\n");

  const maxVisible = options?.maxRows || 10;
  const total = displayRows.length;
  if (total <= maxVisible) {
    return [headerLine, dividerLine, toLines(displayRows)].join("\n");
  }

  const headPart = [headerLine, dividerLine, toLines(displayRows.slice(0, maxVisible))].join("\n");
  const remaining = displayRows.slice(maxVisible);
  const remainingTable = [headerLine, dividerLine, toLines(remaining, maxVisible)].join("\n");
  const summary = tForLocale(options?.locale, "query.hotData.tableFoldSummary", {
    hidden: remaining.length,
    total,
  });

  return `${headPart}

<details data-ai-table-details="1" data-saved-rows-count="${remaining.length}" data-total-count="${total}">
  <summary>${summary}</summary>

${remainingTable}
</details>`;
}

export async function buildTableFromRows(
  rows: Record<string, unknown>[],
  ctxLabel: string,
  options?: {
    signal?: AbortSignal;
    maxRows?: number;
    outputKeyDescriptionMDTable?: string;
    code?: string;
    locale?: string;
  }
): Promise<{
  tableSegment: string;
  normalizedRows: Record<string, unknown>[];
  fieldDisplayPlan?: FieldDisplayPlan;
}> {
  if (rows.length === 0) {
    return {
      tableSegment: tForLocale(options?.locale, "query.display.empty"),
      normalizedRows: [],
    };
  }

  const fieldDisplayPlan = await createFieldDisplayPlan(rows, {
    subQuestion: ctxLabel,
    signal: options?.signal,
    outputKeyDescriptionMDTable: options?.outputKeyDescriptionMDTable,
    code: options?.code,
    locale: options?.locale,
  });
  return {
    tableSegment: renderDataAsTable(rows, fieldDisplayPlan, {
      maxRows: options?.maxRows,
      locale: options?.locale,
    }),
    normalizedRows: rows,
    fieldDisplayPlan,
  };
}

export function extractAnswerFromData(data: unknown): string {
  const normalized = normalizeData(data);

  if (normalized.length === 0) {
    return tApp("queryFixed.195");
  }

  const firstRow = normalized[0];
  const keys = Object.keys(firstRow);

  if (keys.length === 0) {
    return tApp("queryFixed.195");
  }

  const preview = keys
    .slice(0, 3)
    .map((key) => {
      const value = firstRow[key];
      return `${key}: ${value}`;
    })
    .join(", ");

  const summary = tApp("queryFixed.193", { v0: (normalized.length), v1: (keys.slice(0, 5).join(", ")), v2: (keys.length > 5 ? "..." : "") });

  return tApp("queryFixed.194", { v0: (summary), v1: (preview) });
}

export function convertChunkToDataset(
  chunk: { data: Record<string, unknown>[]; dsl?: unknown },
  index: number,
  locale?: string
): Dataset {
  const problem =
    (chunk.dsl as { problem?: string } | undefined)?.problem ||
    tForLocale(locale, "query.datasetFallbackTitle", { index: index + 1 });
  const name =
    problem.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, "_").slice(0, 50) || `dataset_${index + 1}`;

  const columns = collectAllHeaders(chunk.data);

  return {
    name,
    description: problem,
    columns,
    data: chunk.data,
    dsl: chunk.dsl,
  };
}
