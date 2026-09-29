import { tApp } from "../../../../i18n";
import { boundPromptMessages, truncateText } from "../../../../utils/prompt-context";
import type { QueryArtifactRef, TaskPlannerOutputRecord } from "../state";

export type TaskPlannerPriorMessage = {
  role: "user" | "assistant";
  content: string;
  queryRunId?: string;
};

export type TaskPlannerThreadMessage = {
  role: "user" | "assistant";
  content: string;
  requestSeq?: number;
};

export type HistoricalQueryRefsById = Record<string, QueryArtifactRef>;

const TASK_PLANNER_HISTORY_LIMITS = {
  maxMessages: 9,
  maxCharsPerMessage: 1200,
  maxTotalChars: 6000,
};

const TASK_PLANNER_MESSAGES_PER_TURN = 3;
const MAX_TASK_PLANNER_HISTORY_TURNS = Math.floor(
  TASK_PLANNER_HISTORY_LIMITS.maxMessages / TASK_PLANNER_MESSAGES_PER_TURN
);

function text(value: unknown): string {
  return String(value || "").trim();
}

function jsonForPrompt(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function datasetMarkdown(dataset: any, index: number): string {
  const rows = Array.isArray(dataset?.rows) ? dataset.rows : [];
  const columns = Array.isArray(dataset?.columns)
    ? dataset.columns
    : rows[0] && typeof rows[0] === "object"
      ? Object.keys(rows[0])
      : [];

  return [
    tApp("queryFixed.118", { v0: (index + 1), v1: (text(dataset?.title) || tApp("queryFixed.132")) }),
    tApp("queryFixed.119", { v0: (rows.length) }),
    columns.length > 0 ? tApp("queryFixed.120", { v0: (columns.slice(0, 12).join(", ")) }) : "",
    rows.length > 0 ? tApp("queryFixed.121", { v0: (truncateText(JSON.stringify(rows.slice(0, 2)), 500)) }) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function snapshotMarkdown(
  snapshot: any,
  qualityCheck?: QualityCheckView,
  datasets: unknown[] = []
): string {
  const sections: string[] = [];

  if (text(snapshot?.primaryText)) {
    sections.push(tApp("queryFixed.122", { v0: (truncateText(snapshot.primaryText, 1800)) }));
  }

  if (snapshot?.clarification) {
    const options = Array.isArray(snapshot.clarification.options)
      ? snapshot.clarification.options
          .map((option: any) => `- ${option?.id}: ${option?.resolvedQuestion || ""}`)
          .join("\n")
      : "";
    sections.push(
      [tApp("queryFixed.133"), text(snapshot.clarification.message), options ? tApp("queryFixed.123", { v0: (options) }) : ""]
        .filter(Boolean)
        .join("\n")
    );
  }

  if (text(snapshot?.analysisText)) {
    sections.push(tApp("queryFixed.124", { v0: (truncateText(snapshot.analysisText, 1800)) }));
  }

  // The quality check has exactly one channel: it is a field of the execution facts, fetched by the caller from the query run facts and passed in,
  // no longer read from the page snapshot — the snapshot no longer stores it.
  const quality =
    text(qualityCheck?.content) || text((qualityCheck?.state as any)?.result?.conclusion);
  if (quality) {
    sections.push(tApp("queryFixed.125", { v0: (truncateText(quality, 800)) }));
  }

  if (text(snapshot?.visualizationHTML)) {
    sections.push(tApp("queryFixed.134"));
  }

  if (datasets.length > 0) {
    sections.push(tApp("queryFixed.126", { v0: (datasets.slice(0, 3).map(datasetMarkdown).join("\n")) }));
  }

  return truncateText(sections.join("\n\n") || tApp("queryFixed.135"), 5000);
}

export function indexUserMessagesByRequest(
  messages: TaskPlannerThreadMessage[]
): Map<number, string> {
  const result = new Map<number, string>();
  let ordinal = 0;
  let pending: { question: string; ordinal: number; requestSeq?: number } | undefined;

  for (const message of messages) {
    if (message.role === "user") {
      if (pending) {
        result.set(pending.requestSeq ?? pending.ordinal, pending.question);
      }
      pending = {
        question: message.content,
        ordinal,
        requestSeq: message.requestSeq,
      };
      ordinal += 1;
      continue;
    }
    if (pending) {
      result.set(pending.requestSeq ?? message.requestSeq ?? pending.ordinal, pending.question);
      pending = undefined;
    }
  }

  if (pending) {
    result.set(pending.requestSeq ?? pending.ordinal, pending.question);
  }
  return result;
}

export function collectTaskPlannerHistoryRequestSeqs(input: {
  records: TaskPlannerOutputRecord[];
  snapshots: Array<{ requestSeq: number; snapshot?: any }>;
  messages: TaskPlannerThreadMessage[];
  currentRequestSeq?: number;
}): number[] {
  const requestSeqs = new Set<number>();
  const add = (requestSeq: number) => {
    if (!Number.isInteger(requestSeq) || requestSeq < 0) return;
    if (input.currentRequestSeq !== undefined && requestSeq >= input.currentRequestSeq) return;
    requestSeqs.add(requestSeq);
  };

  input.records.forEach((record) => add(record.requestSeq));
  input.snapshots.forEach((snapshot) => add(snapshot.requestSeq));
  indexUserMessagesByRequest(input.messages).forEach((_question, requestSeq) => add(requestSeq));

  return Array.from(requestSeqs)
    .sort((a, b) => a - b)
    .slice(-MAX_TASK_PLANNER_HISTORY_TURNS);
}

/** Display form of the quality check, fetched by the caller from the query run facts; the snapshot no longer stores it. */
export type QualityCheckView = { state?: unknown; content?: string };

export function buildTaskPlannerHistoryContext(input: {
  records: TaskPlannerOutputRecord[];
  snapshots: Array<{ requestSeq: number; snapshot?: any }>;
  messages: TaskPlannerThreadMessage[];
  requestSeqs: number[];
  historicalQueryRefsById: HistoricalQueryRefsById;
  qualityChecksByRequestSeq?: Map<number, QualityCheckView>;
  datasetsByRequestSeq?: Map<number, unknown[]>;
}): {
  priorMessages: TaskPlannerPriorMessage[];
  historicalQueryRefsById: HistoricalQueryRefsById;
} {
  const recordsBySeq = new Map(input.records.map((record) => [record.requestSeq, record]));
  const snapshotsBySeq = new Map(input.snapshots.map((item) => [item.requestSeq, item.snapshot]));
  const userInputsBySeq = indexUserMessagesByRequest(input.messages);
  const queryRunIdsByRequestSeq = new Map(
    Object.entries(input.historicalQueryRefsById).map(([queryRunId, ref]) => [
      ref.requestSeq,
      queryRunId,
    ])
  );

  const messages = input.requestSeqs.flatMap((requestSeq) => {
    const record = recordsBySeq.get(requestSeq);
    const hasSnapshot = snapshotsBySeq.has(requestSeq);
    const queryRunId = hasSnapshot ? queryRunIdsByRequestSeq.get(requestSeq) : undefined;
    const userInput = text(userInputsBySeq.get(requestSeq)) || text(record?.userInput);

    return [
      {
        role: "user" as const,
        content: userInput || tApp("queryFixed.127", { v0: (requestSeq) }),
      },
      {
        role: "assistant" as const,
        content: record?.normalizedResult
          ? tApp("queryFixed.128", { v0: (jsonForPrompt(record.normalizedResult)) })
          : tApp("queryFixed.129", { v0: (requestSeq) }),
      },
      {
        role: "assistant" as const,
        content: hasSnapshot
          ? [
              tApp("queryFixed.136"),
              queryRunId ? tApp("queryFixed.130", { v0: (queryRunId) }) : "",
              snapshotMarkdown(
                snapshotsBySeq.get(requestSeq),
                input.qualityChecksByRequestSeq?.get(requestSeq),
                input.datasetsByRequestSeq?.get(requestSeq)
              ),
            ]
              .filter(Boolean)
              .join("\n")
          : tApp("queryFixed.131", { v0: (requestSeq) }),
        queryRunId,
      },
    ];
  });

  const priorMessages = boundPromptMessages(messages, TASK_PLANNER_HISTORY_LIMITS);
  const historicalQueryRefsById = Object.fromEntries(
    priorMessages.flatMap(({ queryRunId }) => {
      const ref = queryRunId ? input.historicalQueryRefsById[queryRunId] : undefined;
      return ref ? [[queryRunId, ref]] : [];
    })
  );

  return { priorMessages, historicalQueryRefsById };
}
