/**
 * Shared context compaction for agent loops.
 *
 * Compresses the early part of a long conversation into a structured summary
 * while keeping recent messages verbatim, so the conversation stays within the
 * model's context window. Ported from PI's `harness/compaction`.
 */

export {
  DEFAULT_COMPACTION_BUDGET,
  type CompactionPromptKeys,
  type ContextUsageEstimate,
} from "./types";

export {
  calculateContextTokens,
  estimateContextTokens,
  estimateTokens,
  shouldCompact,
} from "./tokens";

export { findCutPointIndex } from "./cut-point";

export { serializeConversation } from "./serialize";

export { generateSummary } from "./summarize";

export {
  COMPACTION_SUMMARY_PREFIX,
  COMPACTION_SUMMARY_SUFFIX,
  createCompactionSummaryMessage,
} from "./messages";

export { compactContext } from "./compact-messages";
