/**
 * Unified Markdown writer for merged agent-llm prompt conversations.
 */

import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../../../../logging/logger";
import { ARTIFACT_DIRS, formatDuration } from "./utils";
import type { PromptMarkerKind } from "@ontomato/contracts/observe";
import { workspaceArtifactText } from "./artifact-text";
import type {
  UnifiedConversation,
  UnifiedMessage,
  UnifiedToolCall,
  UnifiedTranscriptRound,
} from "./prompt-types";
import { tApp } from "../../../../i18n";


const logger = createLogger("workspace-artifact:prompt-unified-writer");

interface ToolResultEntry {
  id: string;
  message: UnifiedMessage;
}

interface ToolPairingIndex {
  byId: Map<string, ToolResultEntry[]>;
  messageIds: WeakMap<UnifiedMessage, string>;
  knownToolCallIds: Set<string>;
}

export interface PromptWriteResult {
  fileCount: number;
  fileNames: string[];
}

/**
 * Build filename for a conversation. Keeps existing naming convention
 * ({displayName}-{order:03d}.md) as confirmed by the user.
 */
function buildFilename(conv: UnifiedConversation): string {
  const topologySuffix = buildTopologyFilenameSuffix(conv);
  return `${conv.displayName}${topologySuffix}-${String(conv.order).padStart(3, "0")}.md`;
}

function buildTopologyFilenameSuffix(conv: UnifiedConversation): string {
  const topologyKind = metaText(conv.meta.topologyKind);
  const subQueryIndex = metaText(conv.meta.subQueryIndex);
  const tryIndex = metaText(conv.meta.tryIndex);

  if (!tryIndex) return "";
  if (topologyKind === "childTry" && subQueryIndex) {
    return `-${workspaceArtifactText().subQueryFilenameWord}${subQueryIndex}-try-${tryIndex}`;
  }
  if (topologyKind === "rootTry") {
    return `-try-${tryIndex}`;
  }
  return "";
}

function buildMarkdown(conv: UnifiedConversation): string {
  const lines: string[] = [];
  const rounds = conv.rounds;
  appendConversationHeader(lines, conv, rounds.length);

  const pairing = buildToolPairingIndex(rounds);
  const consumedToolResults = new Set<string>();
  const renderedToolCalls = new Set<string>();

  for (const round of rounds) {
    appendRound(lines, round, pairing, consumedToolResults, renderedToolCalls);
  }

  return lines.join("\n");
}

function appendConversationHeader(
  lines: string[],
  conv: UnifiedConversation,
  roundCount: number
): void {
  lines.push(`# ${conv.displayName} - #${conv.order}`);
  lines.push("");
  lines.push(`*Source: ${conv.source}*`);
  lines.push("");
  lines.push(tApp("diag.observe.workspace-artifact.prompt-unified-writer.0", { p0: conv.agentId }));
  appendConversationMeta(lines, conv);
  if (roundCount > 0) {
    lines.push(tApp("diag.observe.workspace-artifact.prompt-unified-writer.1", { p0: roundCount }));
  }
  if (conv.durationMs !== undefined) {
    lines.push(tApp("diag.observe.workspace-artifact.prompt-unified-writer.2", { p0: formatDuration(conv.durationMs) }));
  }
  lines.push("");
}

function appendConversationMeta(lines: string[], conv: UnifiedConversation): void {
  const sessionId = metaText(conv.meta.sessionId);
  const agentRunId = metaText(conv.meta.agentRunId);
  const topologyKind = metaText(conv.meta.topologyKind);
  const parentSessionId = metaText(conv.meta.parentSessionId);
  const rootSessionId = metaText(conv.meta.rootSessionId);
  const subQueryIndex = metaText(conv.meta.subQueryIndex);
  const tryIndex = metaText(conv.meta.tryIndex);

  if (sessionId) {
    lines.push(tApp("diag.observe.workspace-artifact.prompt-unified-writer.3", { p0: sessionId }));
  }
  if (agentRunId) {
    lines.push(`- Agent Run: ${agentRunId}`);
  }
  if (rootSessionId) {
    lines.push(tApp("diag.observe.workspace-artifact.prompt-unified-writer.4", { p0: rootSessionId }));
  }
  if (parentSessionId) {
    lines.push(tApp("diag.observe.workspace-artifact.prompt-unified-writer.5", { p0: parentSessionId }));
  }
  if (topologyKind) {
    lines.push(tApp("diag.observe.workspace-artifact.prompt-unified-writer.6", { p0: topologyKind }));
  }
  if (subQueryIndex) {
    lines.push(tApp("diag.observe.workspace-artifact.prompt-unified-writer.7", { p0: subQueryIndex }));
  }
  if (tryIndex) {
    lines.push(tApp("diag.observe.workspace-artifact.prompt-unified-writer.8", { p0: tryIndex }));
  }
}

function metaText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    return text || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function appendRound(
  lines: string[],
  round: UnifiedTranscriptRound,
  pairing: ToolPairingIndex,
  consumedToolResults: Set<string>,
  renderedToolCalls: Set<string>
): void {
  const text = workspaceArtifactText();
  const title =
    round.originalRound !== undefined && round.originalRound !== round.round
      ? text.roundTitle(round.round, round.originalRound)
      : text.roundTitle(round.originalRound ?? round.round);
  lines.push(title);
  lines.push("");

  const meta = roundMeta(round);
  if (meta) {
    lines.push(meta);
    lines.push("");
  }

  const deferredToolResults: ToolResultEntry[] = [];
  for (const message of round.incrementalMessages) {
    if (message.role === "tool") {
      const messageId = pairing.messageIds.get(message);
      if (messageId && consumedToolResults.has(messageId)) continue;
      if (messageId && toolResultCanBePaired(message, pairing)) {
        deferredToolResults.push({ id: messageId, message });
        continue;
      }
      appendToolReturn(lines, message);
      if (messageId) consumedToolResults.add(messageId);
      continue;
    }

    if (message.role === "assistant") {
      if (message.reasoningContent) {
        appendMarkedSection(lines, "reasoning", "context=true", message.reasoningContent);
      }
      if (message.text) {
        appendMarkedSection(lines, "llmOutput", "context=true", message.text);
      }
      for (const call of message.toolCalls ?? []) {
        const signature = toolCallSignature(call);
        if (signature && renderedToolCalls.has(signature)) continue;
        appendToolCall(
          lines,
          call,
          pairing,
          consumedToolResults,
          renderedToolCalls,
          "context=true"
        );
      }
      continue;
    }

    appendMessage(lines, message);
  }

  if (round.outputReasoningContent) {
    appendMarkedSection(lines, "reasoning", "", round.outputReasoningContent);
  }
  if (round.outputText) {
    appendMarkedSection(lines, "llmOutput", "", round.outputText);
  } else if (round.outputToolCalls.length === 0 && !round.error) {
    appendMarkedSection(lines, "llmOutput", "", tApp("diag.observe.workspace-artifact.prompt-unified-writer.9"));
  }

  for (const call of round.outputToolCalls) {
    appendToolCall(lines, call, pairing, consumedToolResults, renderedToolCalls);
  }

  for (const result of deferredToolResults) {
    if (consumedToolResults.has(result.id)) continue;
    appendToolReturn(lines, result.message);
    consumedToolResults.add(result.id);
  }

  if (round.finishReason) {
    lines.push(`Finish Reason: ${round.finishReason}`);
    lines.push("");
  }
  if (round.error) {
    appendMarkedSection(lines, "message", "type=error", round.error);
  }

  lines.push("---");
  lines.push("");
}

function roundMeta(round: UnifiedTranscriptRound): string {
  const meta: string[] = [];
  if (round.status) meta.push(`status=${round.status}`);
  if (round.model) meta.push(`model=${round.model}`);
  if (round.durationMs !== undefined) meta.push(`duration=${formatDuration(round.durationMs)}`);
  if (round.startedAt) meta.push(`startedAt=${round.startedAt}`);
  if (round.endedAt) meta.push(`endedAt=${round.endedAt}`);
  if (round.tokens) meta.push(`tokens=${JSON.stringify(round.tokens)}`);
  return meta.join(" | ");
}

function appendMessage(lines: string[], message: UnifiedMessage): void {
  if (message.reasoningContent) {
    appendMarkedSection(lines, "reasoning", "", message.reasoningContent);
  }
  const markerKind = markerKindForRole(message.role);
  const meta = markerMeta([
    ["role", markerKind === "message" ? message.role : undefined],
    ["toolName", message.toolName],
    ["toolCallId", message.toolCallId],
    ["truncated", message.truncated ? "true" : undefined],
  ]);
  appendMarkedSection(lines, markerKind, meta, message.text || tApp("diag.observe.workspace-artifact.prompt-unified-writer.10"));

  for (const call of message.toolCalls ?? []) {
    appendMarkedSection(lines, "toolCall", toolCallMeta(call), formatToolArguments(call.arguments));
  }
}

function appendToolCall(
  lines: string[],
  call: UnifiedToolCall,
  pairing: ToolPairingIndex,
  consumedToolResults: Set<string>,
  renderedToolCalls: Set<string>,
  extraMeta?: string
): void {
  const signature = toolCallSignature(call);
  if (signature) renderedToolCalls.add(signature);

  appendMarkedSection(
    lines,
    "toolCall",
    joinMeta(toolCallMeta(call), extraMeta),
    formatToolArguments(call.arguments)
  );

  const result = findToolResultForCall(call, pairing, consumedToolResults);
  if (result) {
    appendToolReturn(lines, result.message);
    consumedToolResults.add(result.id);
  }
}

function appendToolReturn(lines: string[], message: UnifiedMessage): void {
  const meta = markerMeta([
    ["name", message.toolName],
    ["id", message.toolCallId],
    ["truncated", message.truncated ? "true" : undefined],
  ]);
  appendMarkedSection(lines, "toolReturn", meta, message.text || tApp("diag.observe.workspace-artifact.prompt-unified-writer.10"));
}

function appendMarkedSection(
  lines: string[],
  kind: PromptMarkerKind,
  meta: string,
  content: string
): void {
  lines.push(markerLine(kind, meta, "BEGIN"));
  lines.push("");
  lines.push(...content.split(/\r?\n/));
  lines.push("");
  lines.push(markerLine(kind, meta, "END"));
  lines.push("");
}

function markerLine(kind: PromptMarkerKind, meta: string, boundary: "BEGIN" | "END"): string {
  return `-----${workspaceArtifactText().promptMarkers[kind]}${meta ? ` ${meta}` : ""} ${boundary}-----`;
}

function markerKindForRole(role: string): PromptMarkerKind {
  switch (role) {
    case "system":
      return "systemPrompt";
    case "user":
      return "userPrompt";
    case "assistant":
      return "llmOutput";
    case "tool":
      return "toolReturn";
    default:
      return "message";
  }
}

function buildToolPairingIndex(rounds: UnifiedTranscriptRound[]): ToolPairingIndex {
  const byId = new Map<string, ToolResultEntry[]>();
  const messageIds = new WeakMap<UnifiedMessage, string>();
  const knownToolCallIds = new Set<string>();

  rounds.forEach((round) => {
    for (const call of round.outputToolCalls) {
      if (call.id) knownToolCallIds.add(call.id);
    }
    round.incrementalMessages.forEach((message, index) => {
      for (const call of message.toolCalls ?? []) {
        if (call.id) knownToolCallIds.add(call.id);
      }
      if (message.role !== "tool") return;
      const id = `${round.round}:${index}`;
      messageIds.set(message, id);
      if (!message.toolCallId) return;
      const entries = byId.get(message.toolCallId) ?? [];
      entries.push({ id, message });
      byId.set(message.toolCallId, entries);
    });
  });

  return { byId, messageIds, knownToolCallIds };
}

function findToolResultForCall(
  call: UnifiedToolCall,
  pairing: ToolPairingIndex,
  consumedToolResults: Set<string>
): ToolResultEntry | undefined {
  if (!call.id) return undefined;
  const entries = pairing.byId.get(call.id) ?? [];
  return entries.find((candidate) => !consumedToolResults.has(candidate.id));
}

function toolResultCanBePaired(message: UnifiedMessage, pairing: ToolPairingIndex): boolean {
  return Boolean(message.toolCallId && pairing.knownToolCallIds.has(message.toolCallId));
}

function toolCallSignature(call: UnifiedToolCall): string | undefined {
  if (call.id) return `id:${call.id}`;
  if (call.name || call.arguments) return `name:${call.name || "unknown"}:${call.arguments || ""}`;
  return undefined;
}

function toolCallMeta(call: UnifiedToolCall): string {
  return markerMeta([
    ["name", call.name],
    ["id", call.id],
  ]);
}

function markerMeta(parts: Array<[string, string | undefined]>): string {
  return parts
    .filter((part): part is [string, string] => Boolean(part[1]))
    .map(([key, value]) => `${key}=${sanitizeMarkerValue(value)}`)
    .join(" ");
}

function joinMeta(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function sanitizeMarkerValue(value: string): string {
  return value.trim().replace(/\s+/g, "_");
}

function formatToolArguments(args: string | undefined): string {
  if (!args) return tApp("diag.observe.workspace-artifact.prompt-unified-writer.11");
  const trimmed = args.trim();
  if (!trimmed) return tApp("diag.observe.workspace-artifact.prompt-unified-writer.11");

  try {
    return fenced(JSON.stringify(JSON.parse(trimmed), null, 2), "json");
  } catch {
    return fenced(trimmed, "text");
  }
}

function fenced(content: string, lang: string): string {
  const fence = content.includes("```") ? "````" : "```";
  return `${fence}${lang}\n${content}\n${fence}`;
}

/**
 * Write all merged conversations to the prompts/ directory.
 */
export function writeConversationMarkdown(
  artifactDir: string,
  conversations: UnifiedConversation[]
): PromptWriteResult {
  if (conversations.length === 0) {
    return { fileCount: 0, fileNames: [] };
  }

  const promptDir = path.join(artifactDir, ARTIFACT_DIRS.PROMPTS);
  fs.mkdirSync(promptDir, { recursive: true });

  let fileCount = 0;
  const fileNames: string[] = [];

  for (const conv of conversations) {
    const filename = buildFilename(conv);
    const filePath = path.join(promptDir, filename);

    try {
      const content = buildMarkdown(conv);
      fs.writeFileSync(filePath, content, "utf-8");
      fileCount++;
      fileNames.push(filename);
    } catch (err) {
      logger.warn("Failed to write prompt markdown", {
        file: filename,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.debug("Prompt markdown written", {
    artifactDir,
    fileCount,
    total: conversations.length,
  });

  return { fileCount, fileNames };
}
