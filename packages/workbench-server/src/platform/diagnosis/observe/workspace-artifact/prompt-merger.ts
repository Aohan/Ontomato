import { createLogger } from "../../../../logging/logger";
import type { UnifiedConversation } from "./prompt-types";

const logger = createLogger("workspace-artifact:prompt-merger");

export function mergeConversations(
  frontend: UnifiedConversation[],
  backend: UnifiedConversation[]
): UnifiedConversation[] {
  const merged = [...frontend, ...backend].filter(hasContent);
  const result = merged.sort(compareConversation);

  logger.debug("Prompt assembly complete", {
    frontend: frontend.length,
    backend: backend.length,
    total: result.length,
  });

  return result;
}

function hasContent(conv: UnifiedConversation): boolean {
  return conv.rounds.some(
    (round) =>
      round.incrementalMessages.length > 0 ||
      Boolean(round.outputText) ||
      round.outputToolCalls.length > 0 ||
      Boolean(round.error)
  );
}

function compareConversation(a: UnifiedConversation, b: UnifiedConversation): number {
  const slot = slotRank(a.slotId) - slotRank(b.slotId);
  if (slot !== 0) return slot;

  const display = displayPrefix(a.displayName) - displayPrefix(b.displayName);
  if (display !== 0) return display;

  return (
    a.displayName.localeCompare(b.displayName) ||
    a.order - b.order ||
    a.agentId.localeCompare(b.agentId)
  );
}

function slotRank(slotId: UnifiedConversation["slotId"]): number {
  return slotId === "front" ? 0 : 1;
}

function displayPrefix(displayName: string): number {
  const match = /^(\d+(?:\.\d+)?)/.exec(displayName);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
