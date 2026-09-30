import { createCompactionSummaryMessage } from "./compaction/messages";
import type { CompactionPromptKeys } from "./compaction/types";
import type { AgentMessage, AssistantMessage } from "./types";

/** Awaited persistence: a failed write must not be swallowed by UI event listeners. */
export interface HarnessTurnJournal {
  appendMessage(message: AgentMessage): Promise<number>;
  writeCompaction(record: { summary: string; coveredThroughSeq: number }): Promise<void>;
}
export interface HarnessModelContext {
  messages: AgentMessage[];
  /** Null denotes a summary or an unknown-result recovery projection, not a raw message. */
  seqs: Array<number | null>;
  previousSummary?: string;
}
export interface HarnessRun {
  journal: HarnessTurnJournal;
  contextWindow: number;
  promptKeys: CompactionPromptKeys;
  promptVariables?: Record<string, string>;
  summaryNote?: (summarized: AgentMessage[], previousSummary?: string) => string;
  context: HarnessModelContext;
}
export const INTERRUPTED_TOOL_RESULT =
  "Execution was interrupted before its result was recorded. The external outcome is unknown. Do not repeat this action automatically.";

/** Usage on retained messages describes the larger pre-compaction request, not the new context. */
export function withoutRecordedUsage(message: AgentMessage): AgentMessage {
  if (message.role !== "assistant") return message;
  const { usage: _usage, ...rest } = message;
  return rest;
}

/** Reconstruct context without mutating raw history or executing any missing tool calls. */
export function buildModelContext(
  rows: Array<{ seq: number; message: AgentMessage }>,
  compaction: { summary: string; coveredThroughSeq: number; createdAt: string } | null
): HarnessModelContext {
  const uncovered = compaction
    ? rows.filter((row) => row.seq > compaction.coveredThroughSeq)
    : rows;
  const messages: AgentMessage[] = [];
  const seqs: Array<number | null> = [];
  if (compaction) {
    messages.push(createCompactionSummaryMessage(compaction.summary, compaction.createdAt));
    seqs.push(null);
  }
  for (let index = 0; index < uncovered.length; index++) {
    const row = uncovered[index]!;
    const message = compaction ? withoutRecordedUsage(row.message) : row.message;
    messages.push(message);
    seqs.push(row.seq);
    if (message.role !== "assistant") continue;
    const answered = new Set<string>();
    while (uncovered[index + 1]?.message.role === "toolResult") {
      const result = uncovered[++index]!;
      messages.push(result.message);
      seqs.push(result.seq);
      answered.add((result.message as { toolCallId: string }).toolCallId);
    }
    for (const result of missingToolResults(message, answered)) {
      messages.push(result);
      seqs.push(null);
    }
  }
  return { messages, seqs, ...(compaction ? { previousSummary: compaction.summary } : {}) };
}

function missingToolResults(message: AssistantMessage, answered: Set<string>): AgentMessage[] {
  return message.content.flatMap((part): AgentMessage[] =>
    part.type === "toolCall" && !answered.has(part.id)
      ? [
          {
            role: "toolResult",
            toolCallId: part.id,
            toolName: part.name,
            isError: true,
            content: [{ type: "text", text: INTERRUPTED_TOOL_RESULT }],
            timestamp: message.timestamp,
          },
        ]
      : []
  );
}

/** Storage operations required by the real loop consumers; implemented by the PostgreSQL adapter. */
export interface HarnessSessionStorage {
  appendMessage(sessionId: string, turnId: string, message: AgentMessage): Promise<number>;
  writeCompaction(
    sessionId: string,
    turnId: string,
    summary: string,
    coveredThroughSeq: number
  ): Promise<void>;
  readContextSnapshot(sessionId: string): Promise<{
    rows: Array<{ seq: number; message: AgentMessage }>;
    compaction: { summary: string; coveredThroughSeq: number; createdAt: string } | null;
  }>;
}

/** Assemble a persistent loop from raw storage facts; context policy belongs to Harness, not PostgreSQL. */
export async function createHarnessRun(
  storage: HarnessSessionStorage,
  params: Omit<HarnessRun, "journal" | "context"> & { sessionId: string; turnId: string }
): Promise<HarnessRun> {
  const { sessionId, turnId, ...options } = params;
  const snapshot = await storage.readContextSnapshot(sessionId);
  return {
    ...options,
    context: buildModelContext(snapshot.rows, snapshot.compaction),
    journal: {
      appendMessage: (message) => storage.appendMessage(sessionId, turnId, message),
      writeCompaction: ({ summary, coveredThroughSeq }) =>
        storage.writeCompaction(sessionId, turnId, summary, coveredThroughSeq),
    },
  };
}
