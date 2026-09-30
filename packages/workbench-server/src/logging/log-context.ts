import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface TurnIdentity {
  threadId: string;
  requestSeq: number;
  turnKey: string;
  parentTurnKey?: string;
  sourceKind?: string;
  sourceRef?: string;
}

export interface LogContext {
  requestId?: string;
  turn?: TurnIdentity;
  taskId?: string;
  domainId?: string;
  token?: string;
  apiKey?: string;
}

const TURN_KEY_PREFIX = "turn";
export const ANALYSIS_SUB_QUESTION_SOURCE_KIND = "analysis_sub_question";
const TURN_KEY_SEGMENT_PATTERN = /^[^.:/\\]+$/u;
const asyncLocalStorage = new AsyncLocalStorage<LogContext>();

/**
 * Generate a short request id for generic request logs before a Turn exists.
 */
export function generateRequestId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

export function buildTurnKey(threadId: string, requestSeq: number): string {
  const normalizedThreadId = normalizeTurnKeySegment(threadId, "threadId");
  if (!Number.isInteger(requestSeq) || requestSeq < 0) {
    throw new Error("requestSeq must be a non-negative integer to build turnKey");
  }

  return `${TURN_KEY_PREFIX}.${normalizedThreadId}.${requestSeq}`;
}

export function buildAnalysisSubQuestionTurnKey(
  threadId: string,
  requestSeq: number,
  sourceRef: string
): string {
  const normalizedSourceRef = normalizeTurnKeySegment(sourceRef, "sourceRef");

  return `${buildTurnKey(
    threadId,
    requestSeq
  )}.${ANALYSIS_SUB_QUESTION_SOURCE_KIND}.${normalizedSourceRef}`;
}

export function parseTurnKey(turnKey: string): TurnIdentity | null {
  const parts = String(turnKey || "")
    .trim()
    .split(".");
  if ((parts.length !== 3 && parts.length !== 5) || parts[0] !== TURN_KEY_PREFIX) return null;

  const requestSeq = Number(parts[2]);
  if (!Number.isInteger(requestSeq) || requestSeq < 0) return null;

  const threadId = parseTurnKeySegment(parts[1]);
  if (!threadId) return null;
  if (parts.length === 5) {
    if (parts[3] !== ANALYSIS_SUB_QUESTION_SOURCE_KIND) return null;
    const sourceRef = parseTurnKeySegment(parts[4]);
    if (!sourceRef) return null;
    return {
      threadId,
      requestSeq,
      turnKey: buildAnalysisSubQuestionTurnKey(threadId, requestSeq, sourceRef),
      parentTurnKey: buildTurnKey(threadId, requestSeq),
      sourceKind: ANALYSIS_SUB_QUESTION_SOURCE_KIND,
      sourceRef,
    };
  }
  return {
    threadId,
    requestSeq,
    turnKey: buildTurnKey(threadId, requestSeq),
  };
}

export function buildTurnIdentity(threadId: string, requestSeq: number): TurnIdentity {
  return {
    threadId,
    requestSeq,
    turnKey: buildTurnKey(threadId, requestSeq),
  };
}

export function getLogContext(): LogContext | undefined {
  return asyncLocalStorage.getStore();
}

export function getRequestId(): string | undefined {
  return asyncLocalStorage.getStore()?.requestId;
}

export function getTurnContext(): TurnIdentity | undefined {
  return asyncLocalStorage.getStore()?.turn;
}

export function getTurnKey(): string | undefined {
  return asyncLocalStorage.getStore()?.turn?.turnKey;
}

export function getTaskId(): string | undefined {
  return asyncLocalStorage.getStore()?.taskId;
}

export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return asyncLocalStorage.run({ ...asyncLocalStorage.getStore(), ...context }, fn);
}

export function runWithRequestContext<T>(requestId: string, fn: () => T): T {
  return runWithLogContext({ requestId }, fn);
}

export function runWithTurnContext<T>(
  turn: Omit<TurnIdentity, "turnKey"> | TurnIdentity,
  fn: () => T
): T {
  const identity = resolveTurnIdentityForContext(turn);
  return runWithLogContext({ turn: identity }, fn);
}

export function runWithTaskContext<T>(taskId: string, fn: () => T): T {
  return runWithLogContext({ taskId }, fn);
}

function resolveTurnIdentityForContext(
  turn: Omit<TurnIdentity, "turnKey"> | TurnIdentity
): TurnIdentity {
  if ("turnKey" in turn && turn.turnKey) {
    const parsed = parseTurnKey(turn.turnKey);
    if (!parsed) {
      throw new Error("Invalid turnKey");
    }
    if (parsed.threadId !== turn.threadId || parsed.requestSeq !== turn.requestSeq) {
      throw new Error("turnKey does not match threadId/requestSeq");
    }
    return parsed;
  }
  return buildTurnIdentity(turn.threadId, turn.requestSeq);
}

function normalizeTurnKeySegment(value: string, label: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`${label} is required to build turnKey`);
  }
  if (!TURN_KEY_SEGMENT_PATTERN.test(normalized)) {
    throw new Error(`${label} contains unsupported characters for turnKey`);
  }
  return normalized;
}

function parseTurnKeySegment(value: string | undefined): string | null {
  if (!value || !TURN_KEY_SEGMENT_PATTERN.test(value)) return null;
  return value;
}
