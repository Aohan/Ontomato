import { workbenchProduct } from "../../../../product/installed";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../../../../logging/logger";
import { ARTIFACT_DIRS } from "./utils";
import { getDisplayNameForBackendAgent, getDisplayNameForDataAgent } from "./prompt-agent-catalog";
import type {
  UnifiedConversation,
  UnifiedMessage,
  UnifiedToolCall,
  UnifiedTranscriptRound,
} from "./prompt-types";

const logger = createLogger("workspace-artifact:agent-llm-transcript");

export interface AgentLlmExtractResult {
  conversations: UnifiedConversation[];
  fileExists: boolean;
  parsedCount: number;
  matchingCount: number;
  parseErrorCount: number;
  skippedSessionCount: number;
}

interface AgentLlmParseOptions {
  source: UnifiedConversation["source"];
  slotId: UnifiedConversation["slotId"];
  displayNameForAgent: (agentName: string) => string;
  sessionIds?: string[];
  matchSession?: (rawSessionId: unknown, expectedSessionIds: string[]) => boolean;
  contextIdForRecord: (record: RawAgentLlmRecord) => string;
}

interface RawAgentLlmRecord {
  time?: string;
  agentRunId?: string;
  requestId?: string;
  turnKey?: string;
  threadId?: string;
  requestSeq?: number;
  taskId?: string;
  sessionId?: string | null;
  backendNodeId?: string;
  agentName?: string | null;
  round?: number | string | null;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  status?: string;
  model?: string;
  messages?: RawAgentMessage[];
  output?: {
    reasoningContent?: unknown;
    text?: unknown;
    toolCalls?: RawToolCall[];
    finishReason?: string;
  };
  tokens?: Record<string, unknown>;
  error?: string;
}

interface RawAgentMessage {
  role?: string;
  reasoningContent?: unknown;
  text?: unknown;
  toolCalls?: RawToolCall[];
  toolCallId?: string;
  toolName?: string;
  truncated?: boolean;
}

interface RawToolCall {
  id?: string;
  name?: string;
  arguments?: unknown;
}

interface ParsedAgentLlmRecord extends RawAgentLlmRecord {
  originalIndex: number;
  agentName: string;
  normalizedAgentRunId?: string;
  normalizedContextId: string;
  normalizedMessages: UnifiedMessage[];
}

type SessionTopologyKind = "root" | "rootTry" | "child" | "childTry" | "unknown";

interface SessionTopology {
  topologyKind: SessionTopologyKind;
  rootSessionId?: string;
  parentSessionId?: string;
  subQueryIndex?: number;
  tryIndex?: number;
  sessionSuffix?: string;
}

export function extractBackendAgentLlmTranscripts(
  artifactDir: string,
  sessionIds?: string[]
): AgentLlmExtractResult {
  const filePath = path.join(artifactDir, ARTIFACT_DIRS.RAW_LOGS, "agent-llm.jsonl");
  return extractAgentLlmTranscriptsFromFile(filePath, backendParseOptions(sessionIds));
}

export function extractFrontendAgentLlmTranscripts(artifactDir: string): AgentLlmExtractResult {
  const filePath = path.join(artifactDir, ARTIFACT_DIRS.RAW_LOGS, "llm-calls.jsonl");
  return extractAgentLlmTranscriptsFromFile(filePath, frontendParseOptions());
}

export function parseBackendAgentLlmJsonlLines(
  lines: string[],
  sessionIds?: string[]
): AgentLlmExtractResult {
  return parseAgentLlmJsonlLines(lines, backendParseOptions(sessionIds));
}

export function parseFrontendAgentLlmJsonlLines(lines: string[]): AgentLlmExtractResult {
  return parseAgentLlmJsonlLines(lines, frontendParseOptions());
}

function parseAgentLlmJsonlLines(
  lines: string[],
  options: AgentLlmParseOptions
): AgentLlmExtractResult {
  const records: ParsedAgentLlmRecord[] = [];
  let parseErrorCount = 0;
  let skippedSessionCount = 0;

  lines.forEach((line, index) => {
    try {
      const raw = JSON.parse(line) as RawAgentLlmRecord;
      if (
        options.sessionIds &&
        options.sessionIds.length > 0 &&
        options.matchSession &&
        !options.matchSession(raw.sessionId, options.sessionIds)
      ) {
        skippedSessionCount++;
        return;
      }

      const normalizedAgentRunId = normalizeOptionalText(raw.agentRunId);
      records.push({
        ...raw,
        originalIndex: index,
        agentName: normalizeAgentName(raw.agentName),
        normalizedAgentRunId,
        normalizedContextId: options.contextIdForRecord(raw),
        normalizedMessages: normalizeMessages(raw.messages, Boolean(normalizedAgentRunId)),
      });
    } catch (error) {
      parseErrorCount++;
      logger.debug("agent-llm line parse failed", {
        index,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const conversations = buildConversations(records, options);
  return {
    conversations,
    fileExists: true,
    parsedCount: records.length,
    matchingCount: records.length,
    parseErrorCount,
    skippedSessionCount,
  };
}

function extractAgentLlmTranscriptsFromFile(
  filePath: string,
  options: AgentLlmParseOptions
): AgentLlmExtractResult {
  if (!fs.existsSync(filePath)) {
    return {
      conversations: [],
      fileExists: false,
      parsedCount: 0,
      matchingCount: 0,
      parseErrorCount: 0,
      skippedSessionCount: 0,
    };
  }

  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/).filter(Boolean);
  return parseAgentLlmJsonlLines(lines, options);
}

function backendParseOptions(sessionIds?: string[]): AgentLlmParseOptions {
  return {
    source: "agent-llm",
    slotId: "s1",
    displayNameForAgent: getDisplayNameForBackendAgent,
    sessionIds,
    matchSession: agentRecordMatchesSession,
    contextIdForRecord: (record) => normalizeSessionId(record.sessionId),
  };
}

function frontendParseOptions(): AgentLlmParseOptions {
  return {
    source: workbenchProduct().logSource,
    slotId: "front",
    displayNameForAgent: getDisplayNameForDataAgent,
    contextIdForRecord: frontendContextId,
  };
}

function buildConversations(
  records: ParsedAgentLlmRecord[],
  options: AgentLlmParseOptions
): UnifiedConversation[] {
  const legacyRecords = records.filter((record) => !record.normalizedAgentRunId);
  const runAwareRecords = records.filter((record) => record.normalizedAgentRunId);

  // Compatibility boundary: keep no-agentRunId records isolated here until every producer is verified.
  // Both branches return UnifiedConversation and share the single Markdown writer downstream;
  // legacy snapshot/replay semantics intentionally remain unchanged until that branch is removed.
  const legacyConversations = buildLegacyConversations(legacyRecords, options);
  const runAwareConversations = buildAgentRunConversations(
    runAwareRecords,
    options,
    legacyConversations.length
  );

  return [...legacyConversations, ...runAwareConversations].sort(compareConversationDisplay);
}

function buildLegacyConversations(
  records: ParsedAgentLlmRecord[],
  options: AgentLlmParseOptions
): UnifiedConversation[] {
  const groups = new Map<string, ParsedAgentLlmRecord[]>();
  for (const record of records) {
    const groupKey = `${record.normalizedContextId}::${record.agentName}`;
    const group = groups.get(groupKey) ?? [];
    group.push(record);
    groups.set(groupKey, group);
  }

  const conversations: UnifiedConversation[] = [];
  let sourceOrder = 0;

  for (const group of groups.values()) {
    sourceOrder++;
    const firstRecord = group[0];
    const agentName = firstRecord?.agentName ?? "unknown";
    const contextId = firstRecord?.normalizedContextId ?? "unknown-context";
    const topology =
      options.source === "agent-llm"
        ? parseSessionTopology(firstRecord?.sessionId, options.sessionIds)
        : undefined;
    const sorted = sortAgentRounds(group);
    let previousMessages: UnifiedMessage[] = [];
    const rounds: UnifiedTranscriptRound[] = [];

    sorted.forEach((record, index) => {
      const incrementalMessages = diffMessages(previousMessages, record.normalizedMessages);
      previousMessages = record.normalizedMessages;
      rounds.push({
        round: index + 1,
        originalRound: normalizeRound(record.round),
        startedAt: record.startedAt,
        endedAt: record.endedAt ?? record.time,
        durationMs: normalizeDuration(record.durationMs),
        status: record.status,
        model: record.model,
        tokens: normalizeTokens(record.tokens),
        incrementalMessages,
        outputText: normalizeText(record.output?.text),
        outputToolCalls: normalizeToolCalls(record.output?.toolCalls),
        finishReason: record.output?.finishReason,
        error: record.error,
      });
    });

    conversations.push({
      agentId: `${contextId}:${agentName}`,
      displayName: options.displayNameForAgent(agentName),
      source: options.source,
      slotId: options.slotId,
      order: sourceOrder,
      durationMs: sumDurations(rounds),
      rounds,
      meta: {
        agentName,
        contextId,
        roundCount: rounds.length,
        sourceOrder,
        ...(topology ? topology : {}),
        ...(firstRecord?.sessionId ? { sessionId: firstRecord.sessionId } : {}),
        ...(firstRecord?.turnKey ? { turnKey: firstRecord.turnKey } : {}),
        ...(firstRecord?.taskId ? { taskId: firstRecord.taskId } : {}),
        ...(firstRecord?.threadId ? { threadId: firstRecord.threadId } : {}),
        ...(firstRecord?.requestSeq !== undefined ? { requestSeq: firstRecord.requestSeq } : {}),
      },
    });
  }

  return conversations.sort(compareConversationDisplay);
}

function buildAgentRunConversations(
  records: ParsedAgentLlmRecord[],
  options: AgentLlmParseOptions,
  initialSourceOrder: number
): UnifiedConversation[] {
  const groups = new Map<string, ParsedAgentLlmRecord[]>();
  for (const record of records) {
    const groupKey = `${record.normalizedContextId}::${record.agentName}::${record.normalizedAgentRunId}`;
    const group = groups.get(groupKey) ?? [];
    group.push(record);
    groups.set(groupKey, group);
  }

  const conversations: UnifiedConversation[] = [];
  let sourceOrder = initialSourceOrder;

  for (const group of groups.values()) {
    sourceOrder++;
    const firstRecord = group[0];
    const agentName = firstRecord?.agentName ?? "unknown";
    const contextId = firstRecord?.normalizedContextId ?? "unknown-context";
    const agentRunId = firstRecord?.normalizedAgentRunId ?? "unknown-run";
    const topology =
      options.source === "agent-llm"
        ? parseSessionTopology(firstRecord?.sessionId, options.sessionIds)
        : undefined;
    const sorted = sortAgentRounds(group);
    let previousMessages: UnifiedMessage[] = [];
    let previousOutput: UnifiedMessage | undefined;
    const rounds: UnifiedTranscriptRound[] = [];

    sorted.forEach((record, index) => {
      const rawIncrementalMessages = diffMessages(previousMessages, record.normalizedMessages);
      const incrementalMessages = previousOutput
        ? removeAssistantHistoryReplay(rawIncrementalMessages, previousOutput)
        : rawIncrementalMessages;
      previousMessages = record.normalizedMessages;

      const outputReasoningContent = normalizeText(record.output?.reasoningContent);
      const outputText = normalizeText(record.output?.text);
      const outputToolCalls = normalizeToolCalls(record.output?.toolCalls);
      previousOutput = {
        role: "assistant",
        reasoningContent: outputReasoningContent,
        text: outputText,
        toolCalls: outputToolCalls,
      };

      rounds.push({
        round: index + 1,
        originalRound: normalizeRound(record.round),
        startedAt: record.startedAt,
        endedAt: record.endedAt ?? record.time,
        durationMs: normalizeDuration(record.durationMs),
        status: record.status,
        model: record.model,
        tokens: normalizeTokens(record.tokens),
        incrementalMessages,
        outputReasoningContent,
        outputText,
        outputToolCalls,
        finishReason: record.output?.finishReason,
        error: record.error,
      });
    });

    conversations.push({
      agentId: `${contextId}:${agentName}:${agentRunId}`,
      displayName: options.displayNameForAgent(agentName),
      source: options.source,
      slotId: options.slotId,
      order: sourceOrder,
      durationMs: sumDurations(rounds),
      rounds,
      meta: {
        agentName,
        agentRunId,
        contextId,
        roundCount: rounds.length,
        sourceOrder,
        ...(topology ? topology : {}),
        ...(firstRecord?.sessionId ? { sessionId: firstRecord.sessionId } : {}),
        ...(firstRecord?.turnKey ? { turnKey: firstRecord.turnKey } : {}),
        ...(firstRecord?.taskId ? { taskId: firstRecord.taskId } : {}),
        ...(firstRecord?.threadId ? { threadId: firstRecord.threadId } : {}),
        ...(firstRecord?.requestSeq !== undefined ? { requestSeq: firstRecord.requestSeq } : {}),
      },
    });
  }

  return conversations;
}

function sortAgentRounds(records: ParsedAgentLlmRecord[]): ParsedAgentLlmRecord[] {
  return [...records].sort((a, b) => {
    const aRound = normalizeRound(a.round);
    const bRound = normalizeRound(b.round);
    if (aRound !== undefined && bRound !== undefined && aRound !== bRound) {
      return aRound - bRound;
    }
    if (aRound !== undefined && bRound === undefined) return -1;
    if (aRound === undefined && bRound !== undefined) return 1;
    return getRecordTime(a) - getRecordTime(b) || a.originalIndex - b.originalIndex;
  });
}

function diffMessages(
  previousMessages: UnifiedMessage[],
  currentMessages: UnifiedMessage[]
): UnifiedMessage[] {
  if (previousMessages.length === 0) return currentMessages;

  let commonPrefix = 0;
  const max = Math.min(previousMessages.length, currentMessages.length);
  while (
    commonPrefix < max &&
    JSON.stringify(previousMessages[commonPrefix]) === JSON.stringify(currentMessages[commonPrefix])
  ) {
    commonPrefix++;
  }

  return currentMessages.slice(commonPrefix);
}

function removeAssistantHistoryReplay(
  messages: UnifiedMessage[],
  previousOutput: UnifiedMessage
): UnifiedMessage[] {
  const replayIndex = messages.findIndex(
    (message) => message.role === "assistant" && isAssistantHistoryReplay(message, previousOutput)
  );
  if (replayIndex < 0) return messages;
  return messages.filter((_message, index) => index !== replayIndex);
}

function isAssistantHistoryReplay(
  candidate: UnifiedMessage,
  previousOutput: UnifiedMessage
): boolean {
  const candidateToolIds = toolCallIds(candidate.toolCalls);
  const outputToolIds = toolCallIds(previousOutput.toolCalls);
  const candidateHasToolIds = hasAnyToolCallId(candidate.toolCalls);
  const outputHasToolIds = hasAnyToolCallId(previousOutput.toolCalls);

  if (candidateHasToolIds || outputHasToolIds) {
    return (
      candidateToolIds.length > 0 &&
      candidateToolIds.length === outputToolIds.length &&
      candidateToolIds.every((id, index) => id === outputToolIds[index])
    );
  }

  const candidateReasoning = normalizeReplayText(candidate.reasoningContent);
  const outputReasoning = normalizeReplayText(previousOutput.reasoningContent);
  const candidateText = normalizeReplayText(candidate.text);
  const outputText = normalizeReplayText(previousOutput.text);
  const hasTextPayload = Boolean(
    candidateReasoning || outputReasoning || candidateText || outputText
  );

  return hasTextPayload && candidateReasoning === outputReasoning && candidateText === outputText;
}

function toolCallIds(toolCalls: UnifiedToolCall[] | undefined): string[] {
  if (!toolCalls || toolCalls.length === 0) return [];
  const ids = toolCalls.map((call) => normalizeOptionalText(call.id));
  return ids.every((id): id is string => Boolean(id)) ? ids : [];
}

function hasAnyToolCallId(toolCalls: UnifiedToolCall[] | undefined): boolean {
  return Boolean(toolCalls?.some((call) => normalizeOptionalText(call.id)));
}

function normalizeReplayText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/\r\n?/g, "\n");
}

function normalizeAgentName(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "unknown";
}

function normalizeSessionId(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "unknown-session";
}

function frontendContextId(record: RawAgentLlmRecord): string {
  if (typeof record.turnKey === "string" && record.turnKey.trim()) return record.turnKey.trim();
  if (typeof record.taskId === "string" && record.taskId.trim())
    return `task:${record.taskId.trim()}`;
  if (record.threadId && record.requestSeq !== undefined) {
    return `${record.threadId}:${record.requestSeq}`;
  }
  if (typeof record.requestId === "string" && record.requestId.trim()) {
    return `request:${record.requestId.trim()}`;
  }
  return workbenchProduct().logSource;
}

function agentRecordMatchesSession(value: unknown, baseSessionIds: string[]): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  const sessionId = value.trim();
  return baseSessionIds.some((base) => {
    const trimmed = base.trim();
    return sessionId === trimmed || sessionId.startsWith(`${trimmed}-`);
  });
}

function parseSessionTopology(
  value: unknown,
  baseSessionIds?: string[]
): SessionTopology | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const sessionId = value.trim();
  const bases = baseSessionIds ?? [];
  if (bases.length === 0) return { topologyKind: "unknown" };

  const base = bases.find(
    (candidate) => sessionId === candidate || sessionId.startsWith(`${candidate}-`)
  );
  if (!base) return { topologyKind: "unknown" };

  if (sessionId === base) {
    return { topologyKind: "root", rootSessionId: base };
  }

  if (!sessionId.startsWith(`${base}-`)) {
    return { topologyKind: "unknown", rootSessionId: base };
  }

  const suffix = sessionId.slice(base.length + 1);
  const rootTryMatch = /^try-(\d+)$/.exec(suffix);
  if (rootTryMatch) {
    return {
      topologyKind: "rootTry",
      rootSessionId: base,
      parentSessionId: base,
      tryIndex: Number(rootTryMatch[1]),
      sessionSuffix: suffix,
    };
  }

  const childMatch = /^(\d+)$/.exec(suffix);
  if (childMatch) {
    return {
      topologyKind: "child",
      rootSessionId: base,
      parentSessionId: base,
      subQueryIndex: Number(childMatch[1]),
      sessionSuffix: suffix,
    };
  }

  const childTryMatch = /^(\d+)-try-(\d+)$/.exec(suffix);
  if (childTryMatch) {
    const subQueryIndex = Number(childTryMatch[1]);
    return {
      topologyKind: "childTry",
      rootSessionId: base,
      parentSessionId: `${base}-${subQueryIndex}`,
      subQueryIndex,
      tryIndex: Number(childTryMatch[2]),
      sessionSuffix: suffix,
    };
  }

  return {
    topologyKind: "unknown",
    rootSessionId: base,
    parentSessionId: base,
    sessionSuffix: suffix,
  };
}

function normalizeMessages(messages: unknown, includeReasoningContent: boolean): UnifiedMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => {
    const raw = (message && typeof message === "object" ? message : {}) as RawAgentMessage;
    return {
      role: typeof raw.role === "string" && raw.role ? raw.role : "unknown",
      ...(includeReasoningContent ? { reasoningContent: normalizeText(raw.reasoningContent) } : {}),
      text: normalizeText(raw.text),
      toolCalls: normalizeToolCalls(raw.toolCalls),
      toolCallId: typeof raw.toolCallId === "string" ? raw.toolCallId : undefined,
      toolName: typeof raw.toolName === "string" ? raw.toolName : undefined,
      truncated: raw.truncated === true,
    };
  });
}

function normalizeToolCalls(toolCalls: unknown): UnifiedToolCall[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.map((call) => {
    const raw = (call && typeof call === "object" ? call : {}) as RawToolCall;
    return {
      id: typeof raw.id === "string" ? raw.id : undefined,
      name: typeof raw.name === "string" ? raw.name : undefined,
      arguments: normalizeText(raw.arguments),
    };
  });
}

function normalizeText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeRound(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeDuration(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeTokens(tokens: unknown): Record<string, number> | undefined {
  if (!tokens || typeof tokens !== "object") return undefined;
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(tokens as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function getRecordTime(record: ParsedAgentLlmRecord): number {
  const raw = record.startedAt ?? record.time ?? record.endedAt;
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumDurations(rounds: UnifiedTranscriptRound[]): number | undefined {
  const total = rounds.reduce((sum, round) => sum + (round.durationMs ?? 0), 0);
  return total > 0 ? total : undefined;
}

function compareConversationDisplay(a: UnifiedConversation, b: UnifiedConversation): number {
  return (
    getDisplayPrefix(a.displayName) - getDisplayPrefix(b.displayName) ||
    String(a.displayName).localeCompare(String(b.displayName)) ||
    a.order - b.order ||
    String(a.agentId).localeCompare(String(b.agentId))
  );
}

function getDisplayPrefix(displayName: string): number {
  const match = /^(\d+(?:\.\d+)?)/.exec(displayName);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
