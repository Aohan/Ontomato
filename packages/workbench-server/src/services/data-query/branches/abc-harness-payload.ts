import type { OutKeyRef } from "./types";

export type HarnessEvent = {
  sessionId?: string;
  nodeId?: string;
  type?: string;
  content?: unknown;
  error?: string;
};

export type HarnessDataContent = {
  question?: string;
  data?: unknown;
  code?: string;
  outputKeyDescriptionMDTable?: string;
  outKeyRefs?: OutKeyRef[];
};

const DATA_PAYLOAD_KEYS = ["data", "result", "answer", "rows", "output"];
export function tryParseJSON<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function parseMaybeJSON(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  return tryParseJSON(trimmed) ?? value;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function firstPresent(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }
  return undefined;
}
export function normalizeHarnessDataContent(content: unknown): HarnessDataContent {
  const parsed = parseMaybeJSON(content);
  if (!isPlainRecord(parsed)) return { data: parsed };

  const nested = parseMaybeJSON(firstPresent(parsed, ["content", "payload"]));
  if (isPlainRecord(nested)) return normalizeHarnessDataContent(nested);

  const question = firstPresent(parsed, ["question", "problem", "subQuestion", "query"]);
  const rawData = firstPresent(parsed, DATA_PAYLOAD_KEYS);
  const code = firstPresent(parsed, ["code", "python", "program"]);
  const outputKeyDescriptionMDTable = firstPresent(parsed, [
    "outputKeyDescriptionMDTable",
    "output_key_description_md_table",
  ]);
  const outKeyRefs = firstPresent(parsed, ["outKeyRefs", "out_key_refs"]);

  return {
    question: typeof question === "string" ? question : undefined,
    data: parseMaybeJSON(rawData ?? parsed),
    code: typeof code === "string" ? code : undefined,
    outputKeyDescriptionMDTable:
      typeof outputKeyDescriptionMDTable === "string" ? outputKeyDescriptionMDTable : undefined,
    outKeyRefs: Array.isArray(outKeyRefs) ? (outKeyRefs as OutKeyRef[]) : undefined,
  };
}
export function extractHarnessMessage(content: unknown): string {
  const parsed = parseMaybeJSON(content);
  if (typeof parsed === "string") return parsed.trim();
  if (!parsed || typeof parsed !== "object") return "";

  const record = parsed as Record<string, unknown>;
  const text = record.message ?? record.content ?? record.text;
  return typeof text === "string" ? text.trim() : "";
}
