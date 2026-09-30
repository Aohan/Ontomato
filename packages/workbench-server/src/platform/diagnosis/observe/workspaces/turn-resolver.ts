import type { WorkspaceUpstreamTurn } from "@ontomato/contracts/observe";
import type { QueryBackendSession } from "@ontomato/contracts/query-execution";
import type { BackendLogTimeWindow } from "../workspace-artifact/log-collector";
import type { LogFileTimeWindow } from "../../../../logging/log-file-transport";
import { getCheckpointer } from "../../../../infrastructure/connection";
import {
  buildTurnIdentity,
  buildTurnKey,
  parseTurnKey,
  type TurnIdentity,
} from "../../../../logging/log-context";

type QueryRun = import("../../../../services/data-query/query-run-store").QueryRun;
type ChatRenderSnapshot =
  import("../../../../services/chat/chat-snapshot-store").ChatRenderSnapshot;
type ExecutionEvent = import("../../../../services/chat/execution-event-store").ExecutionEvent;
type TurnRun = import("../../../../services/turn-run/turn-run-store").TurnRun;
type QueryRunStore = typeof import("../../../../services/data-query/query-run-store");
type ChatSnapshotStore = typeof import("../../../../services/chat/chat-snapshot-store");
type ExecutionEventStore = typeof import("../../../../services/chat/execution-event-store");
type TurnRunStore = typeof import("../../../../services/turn-run/turn-run-store");

const BACKEND_LOG_WINDOW_PADDING_MS = 5_000;
const FRONTEND_LOG_WINDOW_PADDING_MS = 5_000;

export interface ThreadMessage {
  role: "user" | "assistant";
  content: string;
  requestSeq?: number;
}

interface TurnResolverCheckpointer {
  getThreadMessages(threadId: string): Promise<ThreadMessage[]>;
}

export type TurnResolverStorage = Pick<
  QueryRunStore,
  "getPrimaryQueryRun" | "getQueryRunBySource" | "listQueryRuns"
> &
  Pick<ChatSnapshotStore, "listChatRenderSnapshots"> &
  Pick<ExecutionEventStore, "listExecutionEvents"> &
  Partial<Pick<TurnRunStore, "getTurnRun">>;

let turnResolverStorage: TurnResolverStorage;

export function setTurnResolverStorage(storage: TurnResolverStorage): void {
  turnResolverStorage = storage;
}

export interface TurnResolverDeps {
  storage?: TurnResolverStorage;
  checkpointer?: TurnResolverCheckpointer | null;
  includePreviousNoQueryTurn?: boolean;
}

export interface ResolvedUpstreamTurn extends WorkspaceUpstreamTurn {
  snapshot?: unknown;
}

export interface ResolvedTurnWorkspaceContext {
  turn: TurnIdentity;
  question?: string;
  finalAnswer?: string;
  snapshot?: ChatRenderSnapshot;
  turnRun?: TurnRun | null;
  selectedQueryRun?: QueryRun | null;
  primaryQueryRun?: QueryRun | null;
  frontendLogTimeWindow?: LogFileTimeWindow;
  upstreamTurns: ResolvedUpstreamTurn[];
}

type TurnWorkspaceInput = Pick<TurnIdentity, "threadId" | "requestSeq"> &
  Partial<Pick<TurnIdentity, "turnKey" | "parentTurnKey" | "sourceKind" | "sourceRef">>;

export function parseTurnKeyOrThrow(turnKey: string): TurnIdentity {
  const turn = parseTurnKey(turnKey);
  if (!turn) {
    throw new Error("Invalid turnKey");
  }
  return turn;
}

export async function resolveTurnWorkspaceContext(
  input: TurnWorkspaceInput,
  deps: TurnResolverDeps = {}
): Promise<ResolvedTurnWorkspaceContext> {
  const turn = normalizeTurnWorkspaceInput(input);
  const storage = deps.storage ?? turnResolverStorage;
  const checkpointer = Object.prototype.hasOwnProperty.call(deps, "checkpointer")
    ? deps.checkpointer
    : getCheckpointer();

  const shouldResolveUpstream = deps.includePreviousNoQueryTurn !== false;
  const sourceKind = stringValue(turn.sourceKind);
  const sourceRef = stringValue(turn.sourceRef);
  const queryRunPromise =
    sourceKind && sourceRef
      ? storage.getQueryRunBySource({
          threadId: turn.threadId,
          requestSeq: turn.requestSeq,
          sourceKind,
          sourceRef,
        })
      : storage.getPrimaryQueryRun(turn.threadId, turn.requestSeq);
  const turnRunPromise =
    typeof storage.getTurnRun === "function"
      ? storage.getTurnRun(turn.threadId, turn.requestSeq)
      : Promise.resolve(null);

  const [messages, snapshots, queryRun, turnRun, upstreamTurn] = await Promise.all([
    readThreadMessages(checkpointer, turn.threadId),
    storage.listChatRenderSnapshots(turn.threadId),
    queryRunPromise,
    turnRunPromise,
    shouldResolveUpstream ? resolvePreviousNoQueryTurn(turn, deps) : Promise.resolve(null),
  ]);

  const snapshot = snapshots.find((item) => item.requestSeq === turn.requestSeq);
  // Sub-turns share thread and request sequence with the parent turn; thread messages and reply snapshots belong to the parent turn.
  // A sub-turn's question and reply can only come from its own query facts, or they would render as the parent turn's reply.
  const text =
    sourceKind && sourceRef
      ? resolveSubTurnText(queryRun)
      : resolveTurnText(messages, turn.requestSeq, snapshot);

  return {
    turn,
    question: text.question,
    finalAnswer: text.finalAnswer,
    snapshot,
    turnRun,
    selectedQueryRun: queryRun,
    primaryQueryRun: sourceKind && sourceRef ? undefined : queryRun,
    frontendLogTimeWindow: resolveFrontendLogTimeWindow({ turnRun, queryRun, snapshot }),
    upstreamTurns: upstreamTurn ? [upstreamTurn] : [],
  };
}

export async function resolvePreviousNoQueryTurn(
  target: Pick<TurnIdentity, "threadId" | "requestSeq">,
  deps: TurnResolverDeps = {}
): Promise<ResolvedUpstreamTurn | null> {
  const previousRequestSeq = target.requestSeq - 1;
  if (previousRequestSeq < 0) return null;

  const storage = deps.storage ?? turnResolverStorage;
  const checkpointer = Object.prototype.hasOwnProperty.call(deps, "checkpointer")
    ? deps.checkpointer
    : getCheckpointer();

  const [queryRuns, executionEvents, snapshots, messages] = await Promise.all([
    storage.listQueryRuns(target.threadId, previousRequestSeq),
    storage.listExecutionEvents(target.threadId, previousRequestSeq),
    storage.listChatRenderSnapshots(target.threadId),
    readThreadMessages(checkpointer, target.threadId),
  ]);

  const hasQueryRun = queryRuns.length > 0;
  const hasQueryNodeEvent = executionEvents.some(isQueryExecutionEvent);
  if (hasQueryRun || hasQueryNodeEvent) return null;

  const snapshot = snapshots.find((item) => item.requestSeq === previousRequestSeq);
  const text = resolveTurnText(messages, previousRequestSeq, snapshot);
  const turnKey = buildTurnKey(target.threadId, previousRequestSeq);

  return {
    turnKey,
    threadId: target.threadId,
    requestSeq: previousRequestSeq,
    relation: "previous_no_query",
    reason: "previous turn has no query run and no query node execution event",
    question: text.question,
    finalAnswer: text.finalAnswer,
    snapshotMode: stringValue(snapshot?.snapshotMode ?? snapshot?.snapshot?.mode),
    snapshotStatus: stringValue(snapshot?.snapshotStatus ?? snapshot?.snapshot?.status),
    queryRunCount: queryRuns.length,
    executionEventCount: executionEvents.length,
    snapshot: snapshot?.snapshot,
  };
}

export function resolveQueryRunBackendSessions(queryRun?: QueryRun | null): QueryBackendSession[] {
  return queryRun?.backendSessions ?? [];
}

export function resolveTurnRunBackendTimeWindow(
  turnRun?: TurnRun | null
): BackendLogTimeWindow | undefined {
  if (!turnRun) return undefined;
  const start = parseTimestamp(turnRun.startedAt);
  if (start === null) return undefined;
  const minTs = Math.max(0, start - BACKEND_LOG_WINDOW_PADDING_MS);
  if (turnRun.status === "running") {
    return { minTs, turnRunning: true };
  }

  const end = parseTimestamp(turnRun.endedAt) ?? parseTimestamp(turnRun.updatedAt);
  if (end === null || end < start) return undefined;
  return {
    minTs,
    maxTs: end + BACKEND_LOG_WINDOW_PADDING_MS,
    turnRunning: false,
  };
}

export interface TurnActualTimes {
  startedAt: string;
  endedAt?: string;
}

/** Actual query start/end (turn run), without log time-window padding, kept separate from the workspace generation time in the manifest. */
export function resolveTurnRunActualTimes(turnRun?: TurnRun | null): TurnActualTimes | undefined {
  if (!turnRun) return undefined;
  const startedAt = toIsoString(turnRun.startedAt);
  if (!startedAt) return undefined;
  const endedAt = toIsoString(turnRun.endedAt);
  return endedAt ? { startedAt, endedAt } : { startedAt };
}

function toIsoString(value: unknown): string | undefined {
  const ts = parseTimestamp(value);
  return ts === null ? undefined : new Date(ts).toISOString();
}

function resolveFrontendLogTimeWindow(input: {
  turnRun?: TurnRun | null;
  queryRun?: QueryRun | null;
  snapshot?: ChatRenderSnapshot;
}): LogFileTimeWindow | undefined {
  const turnRunWindow = resolveTurnRunTimeWindow(input.turnRun);
  if (turnRunWindow) return turnRunWindow;

  const queryRunWindow = resolveTimestampWindow(
    [input.queryRun?.createdAt, input.queryRun?.updatedAt],
    FRONTEND_LOG_WINDOW_PADDING_MS
  );
  if (queryRunWindow) return queryRunWindow;

  return resolveTimestampWindow(
    [input.snapshot?.createdAt, input.snapshot?.updatedAt],
    FRONTEND_LOG_WINDOW_PADDING_MS
  );
}

function resolveTurnRunTimeWindow(turnRun?: TurnRun | null): LogFileTimeWindow | undefined {
  if (!turnRun) return undefined;
  const start = parseTimestamp(turnRun.startedAt);
  const end = parseTimestamp(turnRun.endedAt) ?? parseTimestamp(turnRun.updatedAt);
  if (start === null || end === null || end < start) return undefined;
  return {
    startTime: new Date(Math.max(0, start - FRONTEND_LOG_WINDOW_PADDING_MS)).toISOString(),
    endTime: new Date(end + FRONTEND_LOG_WINDOW_PADDING_MS).toISOString(),
  };
}

function resolveTimestampWindow(
  values: unknown[],
  paddingMs: number
): LogFileTimeWindow | undefined {
  const timestamps = values
    .map((value) => parseTimestamp(value))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (timestamps.length === 0) return undefined;
  return {
    startTime: new Date(Math.max(0, timestamps[0] - paddingMs)).toISOString(),
    endTime: new Date(timestamps[timestamps.length - 1] + paddingMs).toISOString(),
  };
}

async function readThreadMessages(
  checkpointer: TurnResolverCheckpointer | null | undefined,
  threadId: string
): Promise<ThreadMessage[]> {
  if (!checkpointer) return [];
  try {
    return await checkpointer.getThreadMessages(threadId);
  } catch {
    return [];
  }
}

function resolveTurnText(
  messages: ThreadMessage[],
  requestSeq: number,
  snapshot?: ChatRenderSnapshot
): { question?: string; finalAnswer?: string } {
  return {
    question: resolveUserQuestion(messages, requestSeq),
    finalAnswer:
      resolveAssistantAnswer(messages, requestSeq) ||
      stringValue(snapshot?.snapshot?.primaryText) ||
      stringValue(snapshot?.snapshot?.clarification?.message),
  };
}

function resolveUserQuestion(messages: ThreadMessage[], requestSeq: number): string | undefined {
  let currentSeq = 0;
  for (const message of messages) {
    if (message.role !== "user") continue;
    if (currentSeq === requestSeq) return stringValue(message.content);
    currentSeq++;
  }
  return undefined;
}

function resolveAssistantAnswer(messages: ThreadMessage[], requestSeq: number): string | undefined {
  const matched = messages.filter(
    (message) => message.role === "assistant" && message.requestSeq === requestSeq
  );
  for (let index = matched.length - 1; index >= 0; index--) {
    const content = stringValue(matched[index]?.content);
    if (content) return content;
  }
  return undefined;
}

/** A sub-turn's question and final reply come only from its own query run; a missing one is an evidence gap with no fallback to the parent turn. */
function resolveSubTurnText(queryRun?: QueryRun | null): {
  question?: string;
  finalAnswer?: string;
} {
  return {
    question: stringValue(queryRun?.question),
    finalAnswer: stringValue(queryRun?.fullContent) || stringValue(queryRun?.markdownTable),
  };
}

function isQueryExecutionEvent(event: ExecutionEvent): boolean {
  return (
    event.sourceRef === "query" ||
    (event.sourceKind === "workflow_node" && event.sourceRef === "query")
  );
}

function parseTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

function normalizeTurnWorkspaceInput(input: TurnWorkspaceInput): TurnIdentity {
  if (input.turnKey) {
    const parsed = parseTurnKeyOrThrow(input.turnKey);
    if (parsed.threadId !== input.threadId || parsed.requestSeq !== input.requestSeq) {
      throw new Error("turnKey does not match threadId/requestSeq");
    }
    return parsed;
  }
  return buildTurnIdentity(input.threadId, input.requestSeq);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
