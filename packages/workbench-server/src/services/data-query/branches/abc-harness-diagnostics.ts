import { createLogger } from "../../../logging/logger";
import { isPlainRecord, parseMaybeJSON } from "./abc-harness-payload";

export const logger: ReturnType<typeof createLogger> = createLogger("abc-harness-branch");
export function previewText(value: unknown, maxLength = 200): string | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const normalized = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

export function describeUnknownData(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    const first = value[0];
    return {
      kind: "array",
      length: value.length,
      firstKeys:
        first && typeof first === "object" && !Array.isArray(first)
          ? Object.keys(first)
          : undefined,
      firstType: first === null ? "null" : Array.isArray(first) ? "array" : typeof first,
    };
  }
  if (value && typeof value === "object") {
    return { kind: "object", keys: Object.keys(value as Record<string, unknown>) };
  }
  return {
    kind: value === null ? "null" : typeof value,
    hasValue: value !== undefined && value !== null,
  };
}
export function getContentKeys(content: unknown): string[] {
  const parsed = parseMaybeJSON(content);
  return isPlainRecord(parsed) ? Object.keys(parsed).slice(0, 12) : [];
}
