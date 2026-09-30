/**
 * Compaction summary message wrapping.
 *
 * Ported from PI's `harness/messages.ts`. data-agent has no dedicated
 * `compactionSummary` message role, so a persisted compaction summary is
 * materialized into the context as a plain `user` message whose text is the
 * summary wrapped in the PI prefix/suffix. Keeping these strings byte-for-byte
 * identical to PI means the model sees exactly the framing PI uses.
 */

import type { UserMessage } from "../types";

export const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;

export const COMPACTION_SUMMARY_SUFFIX = `
</summary>`;

/**
 * Build the synthetic `user` message that injects a compaction summary at the
 * top of the reconstructed context. `timestamp` is the compaction entry's ISO
 * string, converted to epoch ms to match data-agent's numeric timestamps.
 */
export function createCompactionSummaryMessage(summary: string, timestamp: string): UserMessage {
  return {
    role: "user",
    content: [
      { type: "text", text: COMPACTION_SUMMARY_PREFIX + summary + COMPACTION_SUMMARY_SUFFIX },
    ],
    timestamp: new Date(timestamp).getTime(),
  };
}
