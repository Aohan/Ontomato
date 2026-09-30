import { createHash } from "node:crypto";
import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

export const CHAT_SNAPSHOT_FACT_RETIREMENT_VERSION = "20260901_chat_snapshot_fact_retirement_v1";
export const CHAT_SNAPSHOT_FACT_RETIREMENT_NAME = "chat snapshots contain turn products only";

// Only fields the historical writer actually persisted are handled; `execution` was always an API read model, blocked by the write allowlist.
const LEGACY_SNAPSHOT_FIELDS = [
  "thinkingSummary",
  "thinkingSteps",
  "thinkingState",
  "qualityCheck",
  "datasets",
  "graphNodeIds",
  "hasQueryArtifacts",
  "executionSteps",
] as const;

type JsonObject = Record<string, unknown>;

type LegacySnapshotRow = {
  id: string;
  thread_id: string;
  request_seq: number;
  snapshot: unknown;
  display_message?: string | null;
};

type ExistingQueryRun = {
  id: string;
  data_payload?: unknown;
  datasets_payload?: unknown;
  thinking_summary?: unknown;
  thinking_state?: unknown;
};

type QueryFactBackfill = {
  question?: string;
  status: "completed" | "failed";
  nodeIds?: string[];
  datasets?: JsonObject[];
  dsl?: unknown;
  fullContent?: string;
  thinkingSummary?: string;
  thinkingSteps?: unknown[];
  thinkingState?: JsonObject;
  qcResult?: JsonObject;
  qcState?: JsonObject;
  hasFacts: boolean;
  unrecoverableFacts: string[];
};

export type ChatSnapshotFactRetirementResult = {
  snapshotsCleaned: number;
  queryRunsUpdated: number;
  queryRunsCreated: number;
  executionEventsCreated: number;
  unrecoverableSnapshots: string[];
};

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stableId(prefix: "query" | "event", value: string): string {
  return `${prefix}:${createHash("md5").update(value).digest("hex")}`;
}

function normalizeDatasets(value: unknown): {
  present: boolean;
  datasets?: JsonObject[];
  dsl?: unknown;
  valid: boolean;
} {
  if (value === undefined) return { present: false, valid: true };
  if (!Array.isArray(value)) return { present: true, valid: false };

  const datasets: JsonObject[] = [];
  for (const item of value) {
    if (!isObject(item)) return { present: true, valid: false };
    const rows = Array.isArray(item.rows)
      ? item.rows
      : Array.isArray(item.data)
        ? item.data
        : undefined;
    if (!rows) return { present: true, valid: false };
    const name = text(item.title) || text(item.name) || text(item.description);
    const subQuestion = text(item.subQuestion);
    datasets.push({
      ...(name ? { name } : {}),
      data: rows,
      ...(item.dsl !== undefined ? { dsl: item.dsl } : {}),
      ...(subQuestion ? { subQuestion } : {}),
    });
  }

  const dsls = datasets.map((dataset) => dataset.dsl);
  const dsl = dsls.some((item) => item !== undefined)
    ? dsls.length === 1
      ? dsls[0]
      : dsls
    : undefined;
  return { present: true, datasets, dsl, valid: true };
}

function queryThinkingState(value: unknown): JsonObject | undefined {
  if (!isObject(value)) return undefined;
  const branches = Array.isArray(value.branches) ? value.branches : [];
  return branches.length > 0 || typeof value.winner === "string" ? value : undefined;
}

function qualityFacts(value: unknown): { result?: JsonObject; state?: JsonObject } {
  if (!isObject(value)) return {};
  const state = isObject(value.state) ? value.state : undefined;
  const stateResult = state && isObject(state.result) ? state.result : undefined;
  const conclusion = text(value.content);
  const result =
    stateResult || conclusion
      ? {
          ...(stateResult || {}),
          ...(conclusion && !text(stateResult?.conclusion) ? { conclusion } : {}),
        }
      : undefined;
  return { result, state };
}

function queryStatus(snapshot: JsonObject): "completed" | "failed" {
  const steps = Array.isArray(snapshot.executionSteps) ? snapshot.executionSteps : [];
  const queryStep = steps.find(
    (step) => isObject(step) && (step.id === "stage:query" || step.id === "node:query")
  );
  return isObject(queryStep) && queryStep.status === "failed" ? "failed" : "completed";
}

function buildQueryFacts(row: LegacySnapshotRow): QueryFactBackfill {
  const snapshot = isObject(row.snapshot) ? row.snapshot : {};
  const normalizedDatasets = normalizeDatasets(snapshot.datasets);
  const nodeIds = Array.isArray(snapshot.graphNodeIds)
    ? snapshot.graphNodeIds.map(String).filter(Boolean)
    : undefined;
  const thinkingSteps = Array.isArray(snapshot.thinkingSteps) ? snapshot.thinkingSteps : undefined;
  const thinkingState = queryThinkingState(snapshot.thinkingState);
  const quality = qualityFacts(snapshot.qualityCheck);
  const unrecoverableFacts: string[] = [];

  if (normalizedDatasets.present && !normalizedDatasets.valid) {
    unrecoverableFacts.push("datasets");
  }
  if (snapshot.thinkingState !== undefined && !thinkingState) {
    unrecoverableFacts.push("thinkingState");
  }
  if (snapshot.thinkingSummary !== undefined && !thinkingState) {
    unrecoverableFacts.push("thinkingSummary");
  }

  const datasets = normalizedDatasets.valid ? normalizedDatasets.datasets : undefined;
  const hasFacts = Boolean(
    (normalizedDatasets.present && normalizedDatasets.valid) ||
    nodeIds?.length ||
    thinkingSteps?.length ||
    thinkingState ||
    quality.result ||
    quality.state
  );
  const primaryText = text(snapshot.primaryText);

  return {
    question: text(row.display_message),
    status: queryStatus(snapshot),
    nodeIds: nodeIds?.length ? nodeIds : undefined,
    datasets,
    dsl: normalizedDatasets.valid ? normalizedDatasets.dsl : undefined,
    fullContent: hasFacts ? primaryText : undefined,
    thinkingSummary: text(thinkingState?.summary),
    thinkingSteps,
    thinkingState,
    qcResult: quality.result,
    qcState: quality.state,
    hasFacts,
    unrecoverableFacts,
  };
}

async function findPrimaryStandardQueryRun(
  client: QueryableClient,
  threadId: string,
  requestSeq: number
): Promise<ExistingQueryRun | undefined> {
  const result = await client.query(
    `SELECT id, data_payload, datasets_payload, thinking_summary, thinking_state
     FROM ${qualifiedTable("query_runs")}
     WHERE thread_id = $1 AND request_seq = $2
       AND source_kind IN ('query_stage', 'abc_query_stage')
     ORDER BY
       CASE
         WHEN source_kind = 'query_stage' AND status = 'completed' THEN 0
         WHEN source_kind = 'abc_query_stage' AND status = 'completed' THEN 1
         WHEN status = 'completed' THEN 2
         ELSE 3
       END,
       created_at,
       id
     LIMIT 1`,
    [threadId, requestSeq]
  );
  return result.rows[0];
}

async function backfillQueryRun(
  client: QueryableClient,
  row: LegacySnapshotRow,
  facts: QueryFactBackfill,
  existing?: ExistingQueryRun
): Promise<"updated" | "created" | "none"> {
  if (!facts.hasFacts) return "none";
  const payload = JSON.stringify({
    nodeIds: facts.nodeIds,
    datasets: facts.datasets,
    dsl: facts.dsl,
    fullContent: facts.fullContent,
    thinkingSummary: facts.thinkingSummary,
    thinkingSteps: facts.thinkingSteps,
    thinkingState: facts.thinkingState,
    qcResult: facts.qcResult,
    qcState: facts.qcState,
  });
  const marker = JSON.stringify({ chatSnapshotFactBackfillSource: row.id });

  if (existing) {
    await client.query(
      `UPDATE ${qualifiedTable("query_runs")} SET
         question = COALESCE(question, $1),
         node_ids = COALESCE(node_ids, ($2::jsonb)->'nodeIds'),
         datasets_payload = COALESCE(datasets_payload, ($2::jsonb)->'datasets'),
         dsl_payload = COALESCE(dsl_payload, ($2::jsonb)->'dsl'),
         full_content = COALESCE(full_content, NULLIF(($2::jsonb)->>'fullContent', '')),
         thinking_summary = COALESCE(thinking_summary, NULLIF(($2::jsonb)->>'thinkingSummary', '')),
         thinking_steps = COALESCE(thinking_steps, ($2::jsonb)->'thinkingSteps'),
         thinking_state = COALESCE(thinking_state, ($2::jsonb)->'thinkingState'),
         qc_result = COALESCE(qc_result, ($2::jsonb)->'qcResult'),
         qc_state = COALESCE(qc_state, ($2::jsonb)->'qcState'),
         legacy_payload = COALESCE(legacy_payload, '{}'::jsonb) || $3::jsonb,
         status = CASE WHEN status IN ('pending', 'in_progress') THEN $4 ELSE status END
       WHERE id = $5`,
      [facts.question || null, payload, marker, facts.status, existing.id]
    );
    return "updated";
  }

  const sourceRef = "query";
  await client.query(
    `INSERT INTO ${qualifiedTable("query_runs")}
      (id, thread_id, request_seq, source_kind, source_ref, source_stage, question, status,
       node_ids, datasets_payload, dsl_payload, full_content, thinking_summary,
       thinking_steps, thinking_state, qc_result, qc_state, legacy_payload,
       created_at, updated_at)
     VALUES
      ($1,$2,$3,'query_stage',$4,'query',$5,$6,
       ($7::jsonb)->'nodeIds',($7::jsonb)->'datasets',($7::jsonb)->'dsl',
       NULLIF(($7::jsonb)->>'fullContent',''),
       NULLIF(($7::jsonb)->>'thinkingSummary',''),($7::jsonb)->'thinkingSteps',
       ($7::jsonb)->'thinkingState',($7::jsonb)->'qcResult',($7::jsonb)->'qcState',
       $8::jsonb,NOW(),NOW())`,
    [
      stableId("query", `${row.thread_id}:${row.request_seq}:${sourceRef}`),
      row.thread_id,
      row.request_seq,
      sourceRef,
      facts.question || null,
      facts.status,
      payload,
      marker,
    ]
  );
  return "created";
}

function legacyExecutionSteps(snapshot: unknown): JsonObject[] | undefined {
  if (!isObject(snapshot) || !Array.isArray(snapshot.executionSteps)) return undefined;
  const steps = snapshot.executionSteps.filter(
    (step): step is JsonObject => isObject(step) && Boolean(text(step.name))
  );
  return steps.length === snapshot.executionSteps.length ? steps : undefined;
}

async function backfillExecutionEvents(
  client: QueryableClient,
  row: LegacySnapshotRow
): Promise<{ created: number; unrecoverable: boolean }> {
  if (!isObject(row.snapshot) || row.snapshot.executionSteps === undefined) {
    return { created: 0, unrecoverable: false };
  }
  const existing = await client.query(
    `SELECT 1 FROM ${qualifiedTable("execution_events")}
     WHERE thread_id = $1 AND request_seq = $2 LIMIT 1`,
    [row.thread_id, row.request_seq]
  );
  if ((existing.rowCount ?? existing.rows.length) > 0) {
    return { created: 0, unrecoverable: false };
  }
  const steps = legacyExecutionSteps(row.snapshot);
  if (!steps) return { created: 0, unrecoverable: true };

  let created = 0;
  for (const [index, step] of (steps || []).entries()) {
    const sourceRef = text(step.id) || `step-${index + 1}`;
    const inserted = await client.query(
      `INSERT INTO ${qualifiedTable("execution_events")}
        (id, thread_id, request_seq, event_seq, event_type, event_name, event_icon,
         status, source_kind, source_ref, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'snapshot_backfill',$9,NOW(),NOW())`,
      [
        stableId("event", `${row.thread_id}:${row.request_seq}:${sourceRef}`),
        row.thread_id,
        row.request_seq,
        index + 1,
        step.kind === "stage" ? "node" : "tool",
        text(step.name),
        text(step.icon) || null,
        text(step.status) || "completed",
        sourceRef,
      ]
    );
    created += inserted.rowCount ?? 0;
  }
  return { created, unrecoverable: false };
}

function unresolvedQueryFacts(facts: QueryFactBackfill, existing?: ExistingQueryRun): string[] {
  if (!existing) return facts.unrecoverableFacts;
  return facts.unrecoverableFacts.filter((field) => {
    if (field === "datasets") {
      return existing.datasets_payload == null && existing.data_payload == null;
    }
    if (field === "thinkingState") return existing.thinking_state == null;
    if (field === "thinkingSummary") return existing.thinking_summary == null;
    return true;
  });
}

/** The outer orchestration owns the transaction, version recording, and advisory lock; I/O errors must keep throwing. */
export async function migrateChatSnapshotFactRetirement(
  client: QueryableClient
): Promise<ChatSnapshotFactRetirementResult> {
  const result: ChatSnapshotFactRetirementResult = {
    snapshotsCleaned: 0,
    queryRunsUpdated: 0,
    queryRunsCreated: 0,
    executionEventsCreated: 0,
    unrecoverableSnapshots: [],
  };
  const rows = await client.query(
    `SELECT s.id, s.thread_id, s.request_seq, s.snapshot, t.display_message
     FROM ${qualifiedTable("chat_render_snapshots")} s
     LEFT JOIN ${qualifiedTable("turn_runs")} t
       ON t.thread_id = s.thread_id AND t.request_seq = s.request_seq
     WHERE s.snapshot ?| $1::text[]
     ORDER BY s.thread_id, s.request_seq, s.id`,
    [LEGACY_SNAPSHOT_FIELDS]
  );

  for (const row of rows.rows as LegacySnapshotRow[]) {
    const facts = buildQueryFacts(row);
    const existing = await findPrimaryStandardQueryRun(client, row.thread_id, row.request_seq);
    const queryResult = await backfillQueryRun(client, row, facts, existing);
    if (queryResult === "updated") result.queryRunsUpdated += 1;
    if (queryResult === "created") result.queryRunsCreated += 1;

    const eventResult = await backfillExecutionEvents(client, row);
    result.executionEventsCreated += eventResult.created;
    const unrecoverable = [
      ...unresolvedQueryFacts(facts, existing),
      ...(eventResult.unrecoverable ? ["executionSteps"] : []),
    ];
    if (unrecoverable.length > 0) {
      result.unrecoverableSnapshots.push(
        `${row.thread_id}:${row.request_seq}:${row.id}:${Array.from(new Set(unrecoverable)).join(",")}`
      );
    }

    await client.query(
      `UPDATE ${qualifiedTable("chat_render_snapshots")}
       SET snapshot = snapshot - $2::text[]
       WHERE id = $1`,
      [row.id, LEGACY_SNAPSHOT_FIELDS]
    );
    result.snapshotsCleaned += 1;
  }

  return result;
}
