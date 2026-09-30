export type PromptMarkerType =
  | "System Prompt"
  | "User Prompt"
  | "Model Reasoning"
  | "LLM Output"
  | "Tool Call"
  | "Tool Return"
  | "Message";

export interface PromptReadableField {
  key: string;
  text: string;
}

export type PromptReadableValue =
  | { kind: "fields"; fields: PromptReadableField[] }
  | { kind: "text"; text: string };

export interface PromptToolPart {
  id?: string;
  name?: string;
  value: PromptReadableValue;
}

export type PromptTranscriptItem =
  | {
      kind: "section";
      type: PromptMarkerType;
      content: string;
      error: boolean;
    }
  | {
      kind: "tool";
      call?: PromptToolPart;
      result?: PromptToolPart;
      matchStatus: "matched" | "unmatched" | "ambiguous";
    };

export interface PromptTranscriptGroup {
  kind: "context" | "assistant";
  items: PromptTranscriptItem[];
}

export interface PromptTranscriptRound {
  title: string;
  metaLines: string[];
  groups: PromptTranscriptGroup[];
}

export interface PromptTranscript {
  title?: string;
  headerLines: string[];
  rounds: PromptTranscriptRound[];
}

export type PromptTranscriptParseFailure = "not_unified" | "invalid";

export type PromptTranscriptParseResult =
  | { ok: true; transcript: PromptTranscript }
  | { ok: false; reason: PromptTranscriptParseFailure };

interface ParsedMarker {
  type: PromptMarkerType;
  boundary: "BEGIN" | "END";
  metaText: string;
  meta: Record<string, string>;
}

interface ParsedSection {
  type: PromptMarkerType;
  content: string;
  meta: Record<string, string>;
}

interface RawRound {
  title: string;
  looseLines: string[];
  sections: ParsedSection[];
}

interface OpenSection {
  marker: ParsedMarker;
  lines: string[];
}

const PROMPT_DIRECTORY_NAME = "prompts";
const MARKER_PATTERN =
  /^-----(System Prompt|User Prompt|Model Reasoning|LLM Output|Tool Call|Tool Return|Message)(?:\s+(.*?))?\s+(BEGIN|END)-----$/;
const ROUND_PATTERN = /^##\s+Call\s+\d+(?:\s+\(original seq=[^)]+\))?\s*$/;
const MAX_READABLE_FIELDS = 100;

export function isPromptTranscriptPath(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  return normalizedPath.split("/").includes(PROMPT_DIRECTORY_NAME);
}

export function parsePromptTranscript(content: string): PromptTranscriptParseResult {
  const lines = content.split(/\r?\n/);
  const headerLines: string[] = [];
  const rounds: RawRound[] = [];
  let currentRound: RawRound | null = null;
  let openSection: OpenSection | null = null;
  let markerCount = 0;

  for (const line of lines) {
    const marker = parseMarker(line);

    if (openSection) {
      if (!marker) {
        openSection.lines.push(line);
        continue;
      }

      if (marker.boundary === "BEGIN") {
        return { ok: false, reason: "invalid" };
      }
      if (
        marker.type !== openSection.marker.type ||
        marker.metaText !== openSection.marker.metaText
      ) {
        return { ok: false, reason: "invalid" };
      }

      currentRound?.sections.push({
        type: openSection.marker.type,
        content: normalizeSectionContent(openSection.lines),
        meta: openSection.marker.meta,
      });
      openSection = null;
      continue;
    }

    if (marker) {
      markerCount++;
      if (marker.boundary === "END") {
        return { ok: false, reason: "invalid" };
      }
      if (!currentRound) {
        return { ok: false, reason: "invalid" };
      }
      openSection = { marker, lines: [] };
      continue;
    }

    if (isRoundHeader(line)) {
      if (currentRound) rounds.push(currentRound);
      currentRound = {
        title: line.trim(),
        looseLines: [],
        sections: [],
      };
      continue;
    }

    if (currentRound) {
      currentRound.looseLines.push(line);
    } else {
      headerLines.push(line);
    }
  }

  if (openSection) return { ok: false, reason: "invalid" };
  if (currentRound) rounds.push(currentRound);
  if (markerCount === 0) return { ok: false, reason: "not_unified" };
  if (rounds.length === 0) return { ok: false, reason: "invalid" };

  const titleLine = headerLines.find((line) => /^#\s+/.test(line.trim()));
  const normalizedHeaderLines = trimBlankLines(
    headerLines.filter((line) => line !== titleLine)
  ).filter((line) => line.trim() !== "---");
  const ambiguousToolIds = findAmbiguousToolIds(rounds);

  return {
    ok: true,
    transcript: {
      title: titleLine?.trim().replace(/^#\s+/, ""),
      headerLines: normalizedHeaderLines,
      rounds: rounds.map((round) => buildRound(round, ambiguousToolIds)),
    },
  };
}

export function parsePromptReadableValue(content: string): PromptReadableValue {
  const source = stripCodeFence(content);
  const parsed = tryParseJson(source.trim());
  if (!parsed.ok) {
    return { kind: "text", text: source };
  }
  return toPromptReadableValue(parsed.value, true);
}

function buildRound(raw: RawRound, ambiguousToolIds: Set<string>): PromptTranscriptRound {
  const contextItems: PromptTranscriptItem[] = [];
  const assistantItems: PromptTranscriptItem[] = [];

  for (let index = 0; index < raw.sections.length; index++) {
    const section = raw.sections[index];
    let item: PromptTranscriptItem;

    if (section.type === "Tool Call") {
      const next = raw.sections[index + 1];
      const result = isMatchingToolResult(section, next) ? next : undefined;
      item = toToolItem(section, result, ambiguousToolIds);
      if (result) index++;
    } else if (section.type === "Tool Return") {
      item = toToolItem(undefined, section, ambiguousToolIds);
    } else {
      item = {
        kind: "section",
        type: section.type,
        content: section.content,
        error: section.meta.type === "error",
      };
    }

    const target = isContextSection(section) ? contextItems : assistantItems;
    target.push(item);
  }

  const groups: PromptTranscriptGroup[] = [];
  if (contextItems.length) groups.push({ kind: "context", items: contextItems });
  if (assistantItems.length) groups.push({ kind: "assistant", items: assistantItems });

  return {
    title: raw.title,
    metaLines: trimBlankLines(raw.looseLines).filter(
      (line) => line.trim() && line.trim() !== "---"
    ),
    groups,
  };
}

function isMatchingToolResult(call: ParsedSection, result?: ParsedSection): boolean {
  return Boolean(result?.type === "Tool Return" && call.meta.id && call.meta.id === result.meta.id);
}

function toToolItem(
  callSection: ParsedSection | undefined,
  resultSection: ParsedSection | undefined,
  ambiguousToolIds: Set<string>
): Extract<PromptTranscriptItem, { kind: "tool" }> {
  const call = callSection ? toToolPart(callSection) : undefined;
  const result = resultSection ? toToolPart(resultSection) : undefined;
  const id = call?.id || result?.id;
  const matched = Boolean(call?.id && call.id === result?.id);

  return {
    kind: "tool",
    call,
    result,
    matchStatus: id && ambiguousToolIds.has(id) ? "ambiguous" : matched ? "matched" : "unmatched",
  };
}

function toToolPart(section: ParsedSection): PromptToolPart {
  return {
    id: section.meta.id,
    name: section.meta.name,
    value: parsePromptReadableValue(section.content),
  };
}

function findAmbiguousToolIds(rounds: RawRound[]): Set<string> {
  const seenCalls = new Set<string>();
  const seenResults = new Set<string>();
  const ambiguousIds = new Set<string>();

  for (const section of rounds.flatMap((round) => round.sections)) {
    const seen =
      section.type === "Tool Call"
        ? seenCalls
        : section.type === "Tool Return"
          ? seenResults
          : undefined;
    const id = section.meta.id;
    if (!seen || !id) continue;
    if (seen.has(id)) ambiguousIds.add(id);
    seen.add(id);
  }

  return ambiguousIds;
}

function isContextSection(section: ParsedSection): boolean {
  return (
    section.type === "System Prompt" ||
    section.type === "User Prompt" ||
    section.meta.context === "true"
  );
}

function isRoundHeader(line: string): boolean {
  return ROUND_PATTERN.test(line.trim());
}

function parseMarker(line: string): ParsedMarker | null {
  const match = MARKER_PATTERN.exec(line.trim());
  if (!match) return null;
  const metaText = (match[2] || "").trim();
  return {
    type: match[1] as PromptMarkerType,
    boundary: match[3] as "BEGIN" | "END",
    metaText,
    meta: parseMarkerMeta(metaText),
  };
}

function parseMarkerMeta(metaText: string): Record<string, string> {
  const meta: Record<string, string> = {};
  metaText.split(/\s+/).forEach((part) => {
    const separator = part.indexOf("=");
    if (separator <= 0) return;
    meta[part.slice(0, separator)] = part.slice(separator + 1);
  });
  return meta;
}

function normalizeSectionContent(lines: string[]): string {
  const normalized = [...lines];
  if (normalized[0] === "") normalized.shift();
  if (normalized[normalized.length - 1] === "") normalized.pop();
  return normalized.join("\n");
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines.slice(start, end);
}

function stripCodeFence(content: string): string {
  const lines = content.split(/\r?\n/);
  const first = /^(`{3,})([^`]*)$/.exec(lines[0]?.trim() || "");
  if (!first || lines.length < 2 || lines[lines.length - 1].trim() !== first[1]) {
    return content;
  }
  return lines.slice(1, -1).join("\n");
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  if (!text) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function toPromptReadableValue(value: unknown, parseNestedJson: boolean): PromptReadableValue {
  if (typeof value === "string" && parseNestedJson) {
    const nested = tryParseJson(value.trim());
    if (nested.ok) return toPromptReadableValue(nested.value, false);
  }

  if (isPlainObject(value)) {
    const fields: PromptReadableField[] = [];
    for (const key in value) {
      if (!appendReadableFields(fields, key, value[key], parseNestedJson)) {
        return { kind: "text", text: formatReadableText(value) };
      }
    }
    if (fields.length) return { kind: "fields", fields };
  }

  return { kind: "text", text: formatReadableText(value) };
}

function appendReadableFields(
  fields: PromptReadableField[],
  key: string,
  value: unknown,
  parseNestedJson: boolean
): boolean {
  if (typeof value === "string" && parseNestedJson) {
    const nested = tryParseJson(value.trim());
    if (nested.ok) {
      if (isPlainObject(nested.value)) {
        let expanded = false;
        for (const nestedKey in nested.value) {
          expanded = true;
          fields.push({
            key: `${key}.${nestedKey}`,
            text: formatReadableText(nested.value[nestedKey]),
          });
          if (fields.length > MAX_READABLE_FIELDS) return false;
        }
        if (expanded) return true;
      }
      value = nested.value;
    }
  }

  fields.push({ key, text: formatReadableText(value) });
  return fields.length <= MAX_READABLE_FIELDS;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatReadableText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (value && typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}
