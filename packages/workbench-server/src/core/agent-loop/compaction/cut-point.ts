/**
 * Cut-point selection for agent-loop compaction.
 *
 * A compaction cut point must land on the start of a turn so the retained
 * context is never a fragment: no assistant message is separated from its tool
 * results. What counts as a turn start differs per agent (a chat session
 * restarts at every user message; a single-question ReAct loop restarts at
 * every assistant message), so the caller supplies the predicate. Callers whose
 * history items are not messages themselves (for example persisted session
 * entries) also supply an accessor.
 */

import type { AgentMessage } from "../types";
import { estimateTokens } from "./tokens";

/**
 * Index of the first item kept after compaction, choosing the latest turn
 * boundary that still keeps approximately `keepRecentTokens` of recent context.
 * Returns `startIndex` when the range has no turn start.
 */
export function findCutPointIndex<T>(
  items: T[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
  getMessage: (item: T) => AgentMessage | undefined,
  isTurnStart: (message: AgentMessage) => boolean
): number {
  const cutPoints: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const message = getMessage(items[i]!);
    if (message && isTurnStart(message)) cutPoints.push(i);
  }

  if (cutPoints.length === 0) return startIndex;

  let accumulatedTokens = 0;
  let thresholdIndex = endIndex - 1;
  let thresholdReached = false;

  for (let i = endIndex - 1; i >= startIndex; i--) {
    const message = getMessage(items[i]!);
    if (!message) continue;
    accumulatedTokens += estimateTokens(message);
    if (accumulatedTokens >= keepRecentTokens) {
      thresholdIndex = i;
      thresholdReached = true;
      break;
    }
  }

  if (!thresholdReached) return cutPoints[0]!;

  let cutIndex = cutPoints[0]!;
  for (let i = cutPoints.length - 1; i >= 0; i--) {
    const candidate = cutPoints[i]!;
    if (candidate <= thresholdIndex) {
      cutIndex = candidate;
      break;
    }
  }

  return cutIndex;
}
