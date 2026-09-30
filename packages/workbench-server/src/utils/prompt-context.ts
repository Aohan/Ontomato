import { tApp } from "../i18n";

export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function estimateTextSize(text: string | undefined | null): number {
  return String(text || "").length;
}

export function estimateMessagesSize(messages: Array<{ content: string }>): number {
  return messages.reduce((sum, message) => sum + estimateTextSize(message.content), 0);
}

export function truncateText(text: string | undefined | null, maxChars: number): string {
  const normalized = String(text || "").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const headLength = Math.max(0, maxChars - 40);
  return tApp("foundation.prompt.truncated", {
    head: normalized.slice(0, headLength),
    n: normalized.length,
  });
}

export function stringifyWithLimit(value: unknown, maxChars: number): string {
  try {
    return truncateText(JSON.stringify(value, null, 2), maxChars);
  } catch {
    return truncateText(String(value), maxChars);
  }
}

export function truncateListByChars(items: string[], maxChars: number): string[] {
  const result: string[] = [];
  let total = 0;

  for (const item of items) {
    if (!item.trim()) continue;
    const nextLength = total + item.length;
    if (result.length > 0 && nextLength > maxChars) {
      break;
    }
    result.push(item);
    total = nextLength;
  }

  return result;
}

export function boundPromptMessages<T extends PromptMessage>(
  messages: T[],
  options?: {
    maxMessages?: number;
    maxCharsPerMessage?: number;
    maxTotalChars?: number;
  }
): T[] {
  const maxMessages = options?.maxMessages ?? 6;
  const maxCharsPerMessage = options?.maxCharsPerMessage ?? 1500;
  const maxTotalChars = options?.maxTotalChars ?? 6000;

  const recentMessages = messages.slice(-maxMessages).map((message) => ({
    ...message,
    content: truncateText(message.content, maxCharsPerMessage),
  }));

  const result: T[] = [];
  let total = 0;

  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const message = recentMessages[index];
    const nextLength = total + message.content.length;
    if (result.length > 0 && nextLength > maxTotalChars) {
      continue;
    }
    result.unshift(message);
    total = nextLength;
  }

  return result;
}

export function extractJson(content: string, marker: string): string {
  const fenced = content.match(/```json\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) return fenced[1];

  const direct = content.match(new RegExp(`\\{[\\s\\S]*"${marker}"[\\s\\S]*\\}`));
  if (direct) return direct[0];

  throw new Error(tApp("foundation.prompt.extractJson", { marker }));
}
