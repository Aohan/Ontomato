import { tApp } from "../../i18n";
const DEFAULT_MAX_LENGTH = 160;

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error === undefined || error === null) return "";
  return String(error);
}

function normalizeMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

function truncateMessage(message: string, maxLength: number): string {
  if (message.length <= maxLength) return message;
  return `${message.slice(0, maxLength).trimEnd()}...`;
}

export function truncateErrorForDisplay(error: unknown, maxLength = DEFAULT_MAX_LENGTH): string {
  const normalized = normalizeMessage(toMessage(error));
  if (!normalized) return tApp("queryFixed.241");
  return truncateMessage(normalized, maxLength);
}
