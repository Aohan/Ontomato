import { tApp } from "../../i18n";
export interface QueryAnswerPayload {
  answer: unknown[];
  problem?: string;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseQueryAnswerPayload(
  value: unknown,
  context = tApp("queryFixed.263")
): QueryAnswerPayload {
  if (!isRecord(value) || !Array.isArray(value.answer)) {
    throw new Error(tApp("queryFixed.261", { v0: (context) }));
  }

  return value as QueryAnswerPayload;
}

export function parseQueryAnswerPayloads(
  value: unknown,
  context = tApp("queryFixed.263")
): QueryAnswerPayload[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(tApp("queryFixed.262", { v0: (context) }));
  }

  return value.map((item, index) => parseQueryAnswerPayload(item, `${context}[${index}]`));
}
