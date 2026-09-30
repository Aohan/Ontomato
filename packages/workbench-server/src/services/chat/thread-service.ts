import type { ThreadMessagesPayload } from "@ontomato/contracts/chat";
import {
  isWonByRetiredBranch,
  toDisplayFact,
  toQueryExecutionFact,
} from "../data-query/query-fact";
import { createHash } from "node:crypto";
import { t } from "../../i18n";
import { getCheckpointer } from "../../infrastructure/connection";
import type { ExtendedPostgresSaver, ThreadReadAccess } from "../../infrastructure/checkpointer";
import { convertRowsToCsv, sanitizeDownloadName } from "./download";
import {
  extractDatasetsFromQueryRun,
  extractDslTextFromQueryRun,
} from "../data-query/query-run-artifacts";
import { listChatRenderSnapshots, type PersistedChatRenderSnapshot } from "./chat-snapshot-store";
import { listExecutionEvents, type ExecutionEvent } from "./execution-event-store";
import {
  getPrimaryQueryRun as getStoredPrimaryQueryRun,
  listQueryRuns,
  type QueryRun,
} from "../data-query/query-run-store";
import { listTurnRuns } from "../turn-run/turn-run-store";
import { deleteThreadBusinessData, deleteThreadMetadata } from "./thread-store";

type ThreadDownloadPayload = {
  fileName: string;
  contentType: string;
  body: string;
};

function requireCheckpointer(): ExtendedPostgresSaver {
  const checkpointer = getCheckpointer();
  if (!checkpointer) {
    throw new Error(t("api.checkpointerNotInitialized"));
  }
  return checkpointer as unknown as ExtendedPostgresSaver;
}

export async function deleteThread(
  threadId: string,
  userId: string,
  domainId: string
): Promise<void> {
  const checkpointer = requireCheckpointer();
  await checkpointer.verifyThreadAccess(threadId, userId, domainId);
  await deleteThreadBusinessData(threadId);
  await deleteThreadMetadata(threadId);
  await checkpointer.deleteThreadRecoveryData(threadId);
}

async function getQuestionBaseName(
  checkpointer: ExtendedPostgresSaver,
  threadId: string,
  requestSeq: number,
  fallback: string
) {
  const messages = await checkpointer.getThreadMessages(threadId);
  let userSeq = 0;
  let question = "";
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    if (userSeq === requestSeq) {
      question = msg.content;
      break;
    }
    userSeq += 1;
  }
  return sanitizeDownloadName(question || fallback, fallback);
}

function getDslFingerprint(dsl?: string) {
  if (!dsl) return "dsl";
  return createHash("sha1").update(dsl).digest("hex").slice(0, 8);
}

function groupByRequestSeq<T extends { requestSeq: number }>(items: T[]): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const item of items) {
    const list = grouped.get(item.requestSeq) || [];
    list.push(item);
    grouped.set(item.requestSeq, list);
  }
  return grouped;
}

function mapEventsToExecutionSteps(events: ExecutionEvent[]) {
  return events.map((event) => ({
    id: `${event.sourceKind}:${event.sourceRef}`,
    name: event.eventName,
    icon: event.eventIcon,
    status: event.status || "completed",
    kind: event.eventType === "stage" || event.eventType === "node" ? "stage" : "tool",
  }));
}

function getPrimaryQueryRun(queryRuns: QueryRun[]): QueryRun | undefined {
  return (
    queryRuns.find((run) => run.sourceKind === "query_stage" && run.status === "completed") ||
    queryRuns.find((run) => run.sourceKind === "abc_query_stage" && run.status === "completed") ||
    queryRuns.find((run) => run.status === "completed") ||
    queryRuns[0]
  );
}

function buildHistoryReadSnapshot(input: {
  persisted?: PersistedChatRenderSnapshot;
  fallbackContent?: string;
  queryRun?: QueryRun;
  events: ExecutionEvent[];
}) {
  const { persisted, fallbackContent, queryRun, events } = input;
  const datasets = queryRun
    ? extractDatasetsFromQueryRun(queryRun).map((dataset, index) => ({
        id: `dataset-${index}`,
        title: dataset.title,
        rows: dataset.rows,
        dsl: dataset.dsl,
        subQuestion: dataset.subQuestion,
      }))
    : [];
  const graphNodeIds = Array.isArray(queryRun?.nodeIds)
    ? queryRun.nodeIds.map((item: unknown) => String(item)).filter(Boolean)
    : undefined;

  return {
    mode: persisted?.mode === "error" ? ("error" as const) : ("standard" as const),
    status:
      persisted?.status === "failed" || (!persisted && queryRun?.status === "failed")
        ? ("failed" as const)
        : ("completed" as const),
    source: "history" as const,
    // The persisted snapshot is the rendering authority and is used even with an empty body; message content only backfills old turns without a snapshot.
    primaryText: persisted
      ? String(persisted.primaryText ?? "")
      : fallbackContent || queryRun?.fullContent || "",
    analysisText: typeof persisted?.analysisText === "string" ? persisted.analysisText : undefined,
    visualizationHTML:
      typeof persisted?.visualizationHTML === "string" ? persisted.visualizationHTML : undefined,
    clarification: persisted?.clarification,
    execution: queryRun ? toDisplayFact(toQueryExecutionFact(queryRun)) : undefined,
    executionSteps: mapEventsToExecutionSteps(events),
    datasets,
    graphNodeIds,
    hasQueryArtifacts: datasets.length > 0,
  };
}

export async function getThreadMessagesPayload(
  threadId: string,
  access: ThreadReadAccess
): Promise<ThreadMessagesPayload> {
  const checkpointer = requireCheckpointer();
  if (access.scope === "domain") await checkpointer.verifyThreadDomain(threadId, access.domainId);
  else await checkpointer.verifyThreadAccess(threadId, access.userId, access.domainId);
  const [rawMessages, snapshots, queryRuns, events, turnRuns] = await Promise.all([
    checkpointer.getThreadMessages(threadId),
    listChatRenderSnapshots(threadId),
    listQueryRuns(threadId),
    listExecutionEvents(threadId),
    listTurnRuns(threadId),
  ]);

  const snapshotsByRequest = new Map(snapshots.map((snapshot) => [snapshot.requestSeq, snapshot]));
  const queryRunsByRequest = groupByRequestSeq(queryRuns);
  const eventsByRequest = groupByRequestSeq(events);
  const activeTurn = [...turnRuns]
    .reverse()
    .find((turn) => turn.source === "chat" && turn.status === "running");
  const activeRequestSeq = activeTurn?.requestSeq;

  const messages: ThreadMessagesPayload["messages"] = [];
  const seenUserRequests = new Set<number>();
  const assistantRequests = new Set<number>();
  const turnsByRequest = new Map(turnRuns.map((turn) => [turn.requestSeq, turn]));
  const appendTurnQuestion = (requestSeq: number) => {
    const turn = turnsByRequest.get(requestSeq);
    if (!turn?.displayMessage || seenUserRequests.has(requestSeq)) return;
    messages.push({ role: "user", content: turn.displayMessage, requestSeq });
    seenUserRequests.add(requestSeq);
  };
  let requestCounter = 0;

  for (const msg of rawMessages) {
    if (msg.role === "user") {
      messages.push({
        role: "user",
        content: msg.content,
        ...(msg.requestSeq === undefined ? {} : { requestSeq: msg.requestSeq }),
      });
      if (typeof msg.requestSeq === "number") seenUserRequests.add(msg.requestSeq);
      requestCounter += 1;
      continue;
    }

    const requestSeq = msg.requestSeq ?? requestCounter - 1;
    if (requestSeq === activeRequestSeq) continue;
    assistantRequests.add(requestSeq);
    const requestEvents = eventsByRequest.get(requestSeq) || [];
    const requestQueryRuns = queryRunsByRequest.get(requestSeq) || [];
    const primaryQueryRun = getPrimaryQueryRun(requestQueryRuns);
    // The pre-computed branch is retired: old answers and processes it won no longer appear, while user questions are kept as usual.
    if (isWonByRetiredBranch(primaryQueryRun)) continue;
    const snapshotRow = snapshotsByRequest.get(requestSeq);
    const snapshot = snapshotRow?.snapshot;

    messages.push({
      role: "assistant",
      content: msg.content,
      requestSeq,
      snapshot: buildHistoryReadSnapshot({
        persisted: snapshot,
        fallbackContent: msg.content,
        queryRun: primaryQueryRun,
        events: requestEvents,
      }),
    });
  }

  for (const snapshot of snapshots) {
    if (snapshot.requestSeq === activeRequestSeq) {
      appendTurnQuestion(snapshot.requestSeq);
      continue;
    }
    if (assistantRequests.has(snapshot.requestSeq)) continue;
    appendTurnQuestion(snapshot.requestSeq);
    const content = snapshot.snapshot?.primaryText || "";
    if (snapshot.snapshot?.mode === "follow-up") {
      if (snapshot.snapshot.followUpUserMessage && !seenUserRequests.has(snapshot.requestSeq)) {
        messages.push({
          role: "user",
          content: snapshot.snapshot.followUpUserMessage,
          requestSeq: snapshot.requestSeq,
        });
        seenUserRequests.add(snapshot.requestSeq);
      }
      messages.push({
        role: "assistant",
        content,
        requestSeq: snapshot.requestSeq,
        snapshot: {
          mode: "standard",
          status: snapshot.snapshot.status || "completed",
          source: "history",
          primaryText: content,
        },
      });
      continue;
    }

    const primaryQueryRun = getPrimaryQueryRun(queryRunsByRequest.get(snapshot.requestSeq) || []);
    if (content && !isWonByRetiredBranch(primaryQueryRun)) {
      const requestEvents = eventsByRequest.get(snapshot.requestSeq) || [];
      messages.push({
        role: "assistant",
        content,
        requestSeq: snapshot.requestSeq,
        snapshot: buildHistoryReadSnapshot({
          persisted: snapshot.snapshot,
          fallbackContent: content,
          queryRun: primaryQueryRun,
          events: requestEvents,
        }),
      });
    }
  }

  for (const turn of turnRuns) appendTurnQuestion(turn.requestSeq);

  return {
    messages,
    ...(activeTurn ? { activeTurn: { requestSeq: activeTurn.requestSeq } } : {}),
  };
}

export async function getThreadDataCsvDownload(
  threadId: string,
  requestSeq: number,
  userId: string,
  domainId: string
): Promise<ThreadDownloadPayload> {
  const checkpointer = requireCheckpointer();
  await checkpointer.verifyThreadAccess(threadId, userId, domainId);
  const queryRun = await getStoredPrimaryQueryRun(threadId, requestSeq);
  const datasets = queryRun ? extractDatasetsFromQueryRun(queryRun) : [];
  const rows = datasets.flatMap((dataset) => dataset.rows);

  if (!rows.length) {
    throw new Error(t("api.threadNoDataDownload"));
  }

  const baseName = await getQuestionBaseName(
    checkpointer,
    threadId,
    requestSeq,
    `data_${requestSeq}`
  );

  return {
    fileName: `${baseName}.csv`,
    contentType: "text/csv; charset=utf-8",
    body: `\uFEFF${convertRowsToCsv(rows)}`,
  };
}

export async function getThreadDslDownload(
  threadId: string,
  requestSeq: number,
  userId: string,
  domainId: string
): Promise<ThreadDownloadPayload> {
  const checkpointer = requireCheckpointer();
  await checkpointer.verifyThreadAccess(threadId, userId, domainId);
  const queryRun = await getStoredPrimaryQueryRun(threadId, requestSeq);
  const dsl = queryRun ? extractDslTextFromQueryRun(queryRun) : "";

  if (!dsl) {
    throw new Error(t("api.threadNoDslDownload"));
  }

  const baseName = await getQuestionBaseName(
    checkpointer,
    threadId,
    requestSeq,
    `dsl_${requestSeq}`
  );
  const fingerprint = getDslFingerprint(dsl);

  return {
    fileName: `${baseName}-${fingerprint}.json`,
    contentType: "application/json; charset=utf-8",
    body: dsl,
  };
}
