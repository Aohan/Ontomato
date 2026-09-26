import { createLogger } from "../../../logging/logger";
import { withoutRecordedUsage, type HarnessModelContext } from "../session-run";
import type { AgentMessage, AgentTool, ModelConfig } from "../types";
import { findCutPointIndex } from "./cut-point";
import { createCompactionSummaryMessage } from "./messages";
import { generateSummary } from "./summarize";
import { estimateContextTokens, estimateTokens, shouldCompact } from "./tokens";
import { DEFAULT_COMPACTION_BUDGET, type CompactionPromptKeys } from "./types";

const logger = createLogger("agent-loop:compact-messages");

export type ContextCompaction = HarnessModelContext &
  ({ compacted: false } | { compacted: true; previousSummary: string; coveredThroughSeq: number });

/** Include fixed prompt and tool schemas when the provider has not reported request usage. */
export function estimateRequestTokens(
  messages: AgentMessage[],
  systemPrompt: string,
  tools: AgentTool[]
): number {
  const fixedChars =
    systemPrompt.length +
    JSON.stringify(
      tools.map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }))
    ).length;
  const heuristic = messages.reduce(
    (total, message) => total + estimateTokens(message),
    Math.ceil(fixedChars / 4)
  );
  return Math.max(heuristic, estimateContextTokens(messages).tokens);
}

/** Compress model context only; the session journal persists the resulting summary and boundary. */
export async function compactContext(params: {
  messages: AgentMessage[];
  seqs: Array<number | null>;
  config: ModelConfig;
  contextWindow: number;
  promptKeys: CompactionPromptKeys;
  systemPrompt?: string;
  tools?: AgentTool[];
  promptVariables?: Record<string, string>;
  previousSummary?: string;
  summaryNote?: (summarized: AgentMessage[], previousSummary?: string) => string;
  keepRecentTokens?: number;
  reserveTokens?: number;
  signal?: AbortSignal;
}): Promise<ContextCompaction> {
  const { messages } = params;
  const unchanged: ContextCompaction = {
    messages,
    seqs: params.seqs,
    previousSummary: params.previousSummary,
    compacted: false,
  };
  const tokensBefore = estimateRequestTokens(
    messages,
    params.systemPrompt ?? "",
    params.tools ?? []
  );
  if (!shouldCompact(tokensBefore, params.contextWindow)) return unchanged;

  // Preserve existing budgets for ordinary windows; scale them down for smaller configured models.
  const headroom = Math.max(1, Math.floor(params.contextWindow * 0.2));
  const keepRecentTokens = Math.min(
    params.keepRecentTokens ?? DEFAULT_COMPACTION_BUDGET.keepRecentTokens,
    headroom
  );
  const cutIndex = findCutPointIndex(
    messages,
    0,
    messages.length,
    keepRecentTokens,
    (message) => message,
    (message) => message.role !== "toolResult"
  );
  if (cutIndex <= 0) return unchanged;
  const covered = params.seqs.slice(0, cutIndex).filter((seq): seq is number => seq !== null);
  if (covered.length === 0) return unchanged;
  // The previous summary is already passed separately to its update prompt.
  const source = messages.slice(
    params.previousSummary && params.seqs[0] === null ? 1 : 0,
    cutIndex
  );
  try {
    let summary = await generateSummary(
      source,
      params.config,
      Math.min(params.reserveTokens ?? DEFAULT_COMPACTION_BUDGET.reserveTokens, headroom),
      params.promptKeys,
      params.previousSummary,
      params.signal,
      params.promptVariables
    );
    if (!summary.trim()) throw new Error("Compaction summary is empty");
    const note = params.summaryNote?.(source, params.previousSummary);
    if (note) summary += note;
    logger.info("Loop context compacted", {
      tokensBefore,
      contextWindow: params.contextWindow,
      summarizedMessages: source.length,
      keptMessages: messages.length - cutIndex,
    });
    return {
      compacted: true,
      previousSummary: summary,
      coveredThroughSeq: Math.max(...covered),
      messages: [
        createCompactionSummaryMessage(summary, new Date().toISOString()),
        ...messages.slice(cutIndex).map(withoutRecordedUsage),
      ],
      seqs: [null, ...params.seqs.slice(cutIndex)],
    };
  } catch (error) {
    // Existing model-call failure behavior: preserve context; no compaction-specific retry or stop policy.
    logger.error("Loop context compaction failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return unchanged;
  }
}
