import type { RouteLocationRaw } from "vue-router";
import type { ResponseSnapshot } from "../../../types/chat";

export const TURN_COLLECT_QUERY_VALUE = "1";
export const TURN_DIAGNOSE_QUERY_VALUE = "1";

/** Identity needed to locate a Turn; a reply snapshot satisfies it. */
export type TurnIdentity = Partial<
  Pick<ResponseSnapshot, "status" | "turnKey" | "threadId" | "requestSeq">
>;

/** The Turn of a reply: the server turnKey, else thread + request sequence; empty when neither is known. */
export function snapshotTurnKey(snapshot: TurnIdentity): string {
  if (snapshot.turnKey) return snapshot.turnKey;
  if (snapshot.threadId && Number.isInteger(snapshot.requestSeq)) {
    return `turn.${snapshot.threadId}.${snapshot.requestSeq}`;
  }
  return "";
}

export function buildTurnDiagnoseRoute(turnKey: string): RouteLocationRaw {
  return {
    name: "ObserveTurnDetail",
    params: { turnKey },
    query: {
      collect: TURN_COLLECT_QUERY_VALUE,
      diagnose: TURN_DIAGNOSE_QUERY_VALUE,
    },
  };
}

export function isTurnCollectRequested(value: unknown): boolean {
  return isTurnFlagRequested(value, TURN_COLLECT_QUERY_VALUE);
}

export function isTurnDiagnoseRequested(value: unknown): boolean {
  return isTurnFlagRequested(value, TURN_DIAGNOSE_QUERY_VALUE);
}

function isTurnFlagRequested(value: unknown, expected: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => item === expected || item === "true");
  }
  return value === expected || value === "true";
}
