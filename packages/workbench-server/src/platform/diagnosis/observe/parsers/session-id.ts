/**
 * Shared sessionId extraction helpers for observe and autotest artifacts.
 *
 * data-agent app/LLM logs are tied to Turn or task identity, while datarag
 * backend logs are tied to a business sessionId. Keep the extraction rules in
 * one place so backend evidence resolution cannot drift across code paths.
 */

import { workbenchProduct } from "../../../../product/installed";

const SESSION_ID_FIELDS = ["sessionId", "session_id"] as const;
const BACKEND_NODE_ID_FIELDS = ["backendNodeId", "backend_node_id"] as const;

export function extractSessionIdFromText(text?: string): string | undefined {
  if (!text) return undefined;
  return text.match(workbenchProduct().logIdPatterns.sessionId)?.[1]?.trim() || undefined;
}

export function extractBackendNodeIdFromText(text?: string): string | undefined {
  if (!text) return undefined;
  return text.match(workbenchProduct().logIdPatterns.backendNodeId)?.[1]?.trim() || undefined;
}

export function extractSessionIdFromObject(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;

  const direct = extractStringField(value, ...SESSION_ID_FIELDS);
  if (direct) return direct;

  const data = extractSessionIdFromObject(value.data);
  if (data) return data;

  const raw = extractSessionIdFromObject(value.raw);
  if (raw) return raw;

  if (isRecord(value.raw)) {
    const rawData = extractSessionIdFromObject(value.raw.data);
    if (rawData) return rawData;
  }

  return typeof value.message === "string" ? extractSessionIdFromText(value.message) : undefined;
}

export function extractBackendNodeIdFromObject(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;

  const direct = extractStringField(value, ...BACKEND_NODE_ID_FIELDS);
  if (direct) return direct;

  const data = extractBackendNodeIdFromObject(value.data);
  if (data) return data;

  const raw = extractBackendNodeIdFromObject(value.raw);
  if (raw) return raw;

  if (isRecord(value.raw)) {
    const rawData = extractBackendNodeIdFromObject(value.raw.data);
    if (rawData) return rawData;
  }

  return typeof value.message === "string"
    ? extractBackendNodeIdFromText(value.message)
    : undefined;
}

function extractStringField(
  obj: Record<string, unknown>,
  ...keys: ReadonlyArray<string>
): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
