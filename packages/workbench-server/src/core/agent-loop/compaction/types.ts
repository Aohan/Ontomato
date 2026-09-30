/**
 * Settings and estimates shared by every agent-loop context compaction.
 *
 * Agent-specific compaction bookkeeping (session entries, file operations,
 * persisted compaction records) stays with the owning subsystem.
 */

/* ================================================================== */
/*  Settings                                                           */
/* ================================================================== */

/** Default summary and recent-context budgets; model windows always come from model configuration. */
export const DEFAULT_COMPACTION_BUDGET = {
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
};

/* ================================================================== */
/*  Token estimation results                                           */
/* ================================================================== */

export interface ContextUsageEstimate {
  /** Estimated total context tokens. */
  tokens: number;
  /** Tokens reported by the most recent assistant usage block. */
  usageTokens: number;
  /** Estimated tokens after the most recent assistant usage block. */
  trailingTokens: number;
  /** Index of the message that provided usage, or null when none exists. */
  lastUsageIndex: number | null;
}

/* ================================================================== */
/*  Summary prompt binding                                             */
/* ================================================================== */

/**
 * Prompt keys used to produce a compaction summary. The mechanism is shared,
 * but what a summary must preserve is agent-specific, so every caller binds
 * its own templates.
 */
export interface CompactionPromptKeys {
  /** System prompt key for the summarizer. */
  system: string;
  /** User prompt key for a first summary. */
  summarize: string;
  /** User prompt key for updating a previous summary. */
  update: string;
}
