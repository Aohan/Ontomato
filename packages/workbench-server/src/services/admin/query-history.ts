import type {
  QueryHistoryChainItem,
  QueryHistoryTimelineStep,
} from "@ontomato/contracts/query-history";
import { getCheckpointer } from "../../infrastructure/connection";
import { t } from "../../i18n";
import { listChatRenderSnapshots, type ChatRenderSnapshot } from "../chat/chat-snapshot-store";
import { listExecutionEvents, type ExecutionEvent } from "../chat/execution-event-store";
import { getObjectClasses, listQueryRuns, type QueryRun } from "../data-query/query-run-store";

type QueryHistoryFilters = {
  userId: string;
  domainId: string;
  status?: string;
  objectClass?: string;
  startDate?: string;
  endDate?: string;
  limit: number;
  offset: number;
};

function requireCheckpointer() {
  const checkpointer = getCheckpointer();
  if (!checkpointer) {
    throw new Error(t("api.checkpointerNotInitialized"));
  }
  return checkpointer;
}

function userMessagesByRequest(
  messages: Array<{ role: "user" | "assistant"; content: string; requestSeq?: number }>
): Map<number, string> {
  const map = new Map<number, string>();
  // The question text lives on the user message, but the turn's real requestSeq lives on the
  // assistant reply that follows it (user messages carry no requestSeq). Pairing them keeps
  // attribution correct even when a follow-up turn allocates a requestSeq without writing a
  // checkpointer user message. Fall back to a positional ordinal for legacy data whose
  // assistant messages predate requestSeq stamping.
  let ordinal = 0;
  let pending: { question: string; ordinal: number } | null = null;
  for (const msg of messages) {
    if (msg.role === "user") {
      if (pending) map.set(pending.ordinal, pending.question);
      pending = { question: msg.content, ordinal };
      ordinal += 1;
      continue;
    }
    if (pending) {
      map.set(msg.requestSeq ?? pending.ordinal, pending.question);
      pending = null;
    }
  }
  if (pending) map.set(pending.ordinal, pending.question);
  return map;
}

function getQueryStatus(runs: QueryRun[], events: ExecutionEvent[]) {
  if (
    runs.some((run) => run.status === "failed") ||
    events.some((event) => event.status === "failed")
  ) {
    return "failed";
  }
  if (
    runs.some((run) => run.status === "in_progress" || run.status === "pending") ||
    events.some((event) => event.status === "in_progress" || event.status === "pending")
  ) {
    return "processing";
  }
  return "completed";
}

function buildResultProjection(run?: QueryRun | null) {
  if (!run?.markdownTable && !run?.datasetsPayload) return undefined;
  return { markdownTable: run.markdownTable, datasets: run.datasetsPayload };
}

function mapQueryRun(run: QueryRun) {
  return {
    stage: run.sourceStage || run.sourceKind,
    status: run.status,
    // Display projection: assembled from structured columns for the admin page to read; never a second facts channel.
    // When neither item exists, no empty shell is returned — the page would otherwise render a result block with empty content.
    result: buildResultProjection(run),
    thinkingSummary: run.thinkingSummary,
    thinkingState: run.thinkingState,
    qcState: run.qcState,
    fullContent: run.fullContent,
    dsl: run.dslText,
    ir: run.ir,
    objectClasses: run.objectClasses,
    dataCount: run.dataCount,
    timestamp: run.createdAt ? new Date(run.createdAt).getTime() : Date.now(),
  };
}

function mapTimelineStep(event: ExecutionEvent, queryRuns: QueryRun[]): QueryHistoryTimelineStep {
  const relatedRun = queryRuns.find(
    (run) => run.sourceStage === event.eventType || run.sourceKind === event.eventType
  );

  return {
    name: event.eventName,
    type: event.eventType,
    icon: event.eventIcon,
    status: event.status || relatedRun?.status || "completed",
    thinkingSummary: relatedRun?.thinkingSummary || null,
    thinkingState: relatedRun?.thinkingState || null,
    qcState: relatedRun?.qcState || null,
    input: null,
    output: buildResultProjection(relatedRun) || null,
    dsl: relatedRun?.dslText,
    ir: relatedRun?.ir,
    startTime: event.startedAt,
    endTime: event.endedAt,
    duration: event.durationMs,
    error: event.error,
    timestamp:
      event.startedAt || (event.createdAt ? new Date(event.createdAt).getTime() : Date.now()),
  };
}

function collectRequestSeqs(
  queryRuns: QueryRun[],
  events: ExecutionEvent[],
  snapshots: ChatRenderSnapshot[]
): number[] {
  return Array.from(
    new Set([
      ...queryRuns.map((run) => run.requestSeq),
      ...events.map((event) => event.requestSeq),
      ...snapshots.map((snapshot) => snapshot.requestSeq),
    ])
  ).sort((a, b) => a - b);
}

function earliestDate(
  fallback: Date | string | undefined,
  queryRuns: QueryRun[],
  events: ExecutionEvent[],
  snapshot?: ChatRenderSnapshot
): Date {
  const candidates = [
    ...queryRuns.map((run) => run.createdAt),
    ...events.map((event) => event.createdAt),
    snapshot?.createdAt,
    fallback,
  ].filter(Boolean);
  const timestamps = candidates
    .map((candidate) => new Date(candidate as Date | string).getTime())
    .filter((time) => !Number.isNaN(time));
  const min = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
  return new Date(min);
}

export async function getQueryHistoryList(filters: QueryHistoryFilters) {
  const checkpointer = requireCheckpointer();
  const threadList = await checkpointer.getThreadList({
    userId: filters.userId,
    domainId: filters.domainId,
    limit: filters.limit * 2,
    offset: filters.offset,
  });

  const historyItems: any[] = [];
  for (const thread of threadList.threads) {
    const messages = await checkpointer.getThreadMessages(thread.threadId);
    const questions = userMessagesByRequest(messages);
    const queryRuns = await listQueryRuns(thread.threadId);
    const events = await listExecutionEvents(thread.threadId);
    const snapshots = await listChatRenderSnapshots(thread.threadId);

    for (const requestSeq of collectRequestSeqs(queryRuns, events, snapshots)) {
      const question = questions.get(requestSeq) || "";
      if (!question) continue;
      const runsForTurn = queryRuns.filter((run) => run.requestSeq === requestSeq);
      const eventsForTurn = events.filter((event) => event.requestSeq === requestSeq);
      const snapshotForTurn = snapshots.find((snapshot) => snapshot.requestSeq === requestSeq);
      const queryStatus = getQueryStatus(runsForTurn, eventsForTurn);
      if (filters.status && filters.status !== queryStatus) continue;

      const createdAt = earliestDate(thread.createdAt, runsForTurn, eventsForTurn, snapshotForTurn);
      if (filters.startDate && createdAt < new Date(filters.startDate)) continue;
      if (filters.endDate && createdAt > new Date(filters.endDate)) continue;

      const objectClasses = await getObjectClasses(thread.threadId, requestSeq);
      if (filters.objectClass && !objectClasses.includes(filters.objectClass)) continue;

      const primaryRun =
        runsForTurn.find((run) => run.sourceKind === "query_stage") ||
        runsForTurn.find((run) => run.sourceKind === "abc_query_stage") ||
        runsForTurn[0];

      historyItems.push({
        id: `${thread.threadId}-${requestSeq}`,
        threadId: thread.threadId,
        requestSeq,
        question,
        status: queryStatus,
        createdAt,
        userId: filters.userId || "anonymous",
        abcAnalysis: primaryRun?.fullContent || null,
        thinkingSummary: primaryRun?.thinkingSummary || null,
        thinkingState: primaryRun?.thinkingState || null,
        qcState: primaryRun?.qcState || null,
        chain: eventsForTurn.map(
          (event): QueryHistoryChainItem => ({
            type: event.eventType,
            name: event.eventName,
            icon: event.eventIcon,
          })
        ),
        objectClasses,
      });
    }
  }

  return {
    items: historyItems.slice(0, filters.limit),
    total: historyItems.length,
  };
}

export async function getQueryHistoryDetail(
  threadId: string,
  requestSeq: number,
  userId: string,
  domainId: string
) {
  const checkpointer = requireCheckpointer();
  await checkpointer.verifyThreadAccess(threadId, userId, domainId);
  const messages = await checkpointer.getThreadMessages(threadId);
  const questions = userMessagesByRequest(messages);
  const queryRuns = await listQueryRuns(threadId, requestSeq);
  const events = await listExecutionEvents(threadId, requestSeq);
  const primaryRun =
    queryRuns.find((run) => run.sourceKind === "query_stage") ||
    queryRuns.find((run) => run.sourceKind === "abc_query_stage") ||
    queryRuns[0];

  return {
    threadId,
    requestSeq,
    question: questions.get(requestSeq) || "",
    abcAnalysis: primaryRun?.fullContent || null,
    thinkingSummary: primaryRun?.thinkingSummary || null,
    thinkingState: primaryRun?.thinkingState || null,
    qcState: primaryRun?.qcState || null,
    chain: events.map(
      (event): QueryHistoryChainItem => ({
        type: event.eventType,
        name: event.eventName,
        icon: event.eventIcon,
      })
    ),
    objectClasses: await getObjectClasses(threadId, requestSeq),
    stageResults: queryRuns.map(mapQueryRun),
  };
}

export async function getQueryHistoryTimeline(
  threadId: string,
  requestSeq: number,
  userId: string,
  domainId: string
) {
  await requireCheckpointer().verifyThreadAccess(threadId, userId, domainId);
  const queryRuns = await listQueryRuns(threadId, requestSeq);
  const events = await listExecutionEvents(threadId, requestSeq);
  const timeline = events.map((event) => mapTimelineStep(event, queryRuns));

  return {
    threadId,
    requestSeq,
    timeline,
    totalDuration: timeline.reduce((sum: number, step: any) => sum + (step.duration || 0), 0),
  };
}
