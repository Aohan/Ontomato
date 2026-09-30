import { createHash } from "node:crypto";
import { getPostgresPool, qualifiedTable } from "../../infrastructure/postgres";
import type { QueryBackendSession } from "@ontomato/contracts/query-execution";

export interface QueryRun {
  id: string;
  threadId: string;
  requestSeq: number;
  sourceKind: string;
  sourceRef: string;
  sourceStage?: string;
  question?: string;
  status: "pending" | "in_progress" | "completed" | "failed" | string;
  error?: string;
  backendSessions?: QueryBackendSession[];
  nodeIds?: string[];
  markdownTable?: string;
  datasetPreviews?: any;
  cards?: any;
  winner?: string;
  dataPayload?: any;
  datasetsPayload?: any;
  dslPayload?: any;
  dslText?: string;
  ir?: string;
  fullContent?: string;
  thinkingSummary?: string;
  thinkingSteps?: any;
  thinkingState?: any;
  qcResult?: any;
  qcState?: any;
  objectClasses?: string[];
  dataCount?: number;
  abcSubQuestions?: any;
  abcDsls?: any;
  abcCodes?: any;
  abcOutKeyRefs?: any;
  replayPlan?: any;
  legacyStageId?: number;
  legacyPayload?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertQueryRunInput {
  threadId: string;
  requestSeq: number;
  sourceKind: string;
  sourceRef: string;
  sourceStage?: string;
  question?: string;
  status?: "pending" | "in_progress" | "completed" | "failed" | string;
  error?: string;
  backendSessions?: QueryBackendSession[];
  nodeIds?: string[];
  markdownTable?: string;
  datasetPreviews?: unknown;
  cards?: unknown;
  winner?: string;
  dataPayload?: unknown;
  datasetsPayload?: unknown;
  dslPayload?: unknown;
  dslText?: string;
  ir?: string;
  fullContent?: string;
  thinkingSummary?: string;
  thinkingSteps?: unknown;
  thinkingState?: unknown;
  objectClasses?: string[];
  dataCount?: number;
  abcSubQuestions?: unknown;
  abcDsls?: unknown;
  abcCodes?: unknown;
  abcOutKeyRefs?: unknown;
  replayPlan?: unknown;
}

type QueryRunKey = Pick<
  UpsertQueryRunInput,
  "threadId" | "requestSeq" | "sourceKind" | "sourceRef"
>;

export function buildQueryRunId(threadId: string, requestSeq: number, sourceRef: string): string {
  return `query:${createHash("md5").update(`${threadId}:${requestSeq}:${sourceRef}`).digest("hex")}`;
}

function jsonParam(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function mapQueryRunRow(row: any): QueryRun {
  return {
    id: row.id,
    threadId: row.thread_id,
    requestSeq: row.request_seq,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    sourceStage: row.source_stage || undefined,
    question: row.question || undefined,
    status: row.status,
    error: row.error || undefined,
    backendSessions: row.backend_sessions || undefined,
    nodeIds: row.node_ids || undefined,
    markdownTable: row.markdown_table || undefined,
    datasetPreviews: row.dataset_previews,
    cards: row.cards,
    winner: row.winner || undefined,
    dataPayload: row.data_payload,
    datasetsPayload: row.datasets_payload,
    dslPayload: row.dsl_payload,
    dslText: row.dsl_text || undefined,
    ir: row.ir || undefined,
    fullContent: row.full_content || undefined,
    thinkingSummary: row.thinking_summary || undefined,
    thinkingSteps: row.thinking_steps,
    thinkingState: row.thinking_state,
    qcResult: row.qc_result,
    qcState: row.qc_state,
    objectClasses: row.object_classes || undefined,
    dataCount: row.data_count === null || row.data_count === undefined ? undefined : row.data_count,
    abcSubQuestions: row.abc_sub_questions,
    abcDsls: row.abc_dsls,
    abcCodes: row.abc_codes,
    abcOutKeyRefs: row.abc_out_key_refs,
    replayPlan: row.replay_plan,
    legacyStageId:
      row.legacy_stage_id === null || row.legacy_stage_id === undefined
        ? undefined
        : Number(row.legacy_stage_id),
    legacyPayload: row.legacy_payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function upsertQueryRun(input: UpsertQueryRunInput): Promise<void> {
  const id = buildQueryRunId(input.threadId, input.requestSeq, input.sourceRef);
  const now = new Date();
  await getPostgresPool().query(
    `INSERT INTO ${qualifiedTable("query_runs")}
        (id, thread_id, request_seq, source_kind, source_ref, source_stage, question,
         status, error, backend_sessions, node_ids, markdown_table, dataset_previews,
         cards, winner, data_payload, datasets_payload, dsl_payload, dsl_text, ir,
         full_content, thinking_summary, thinking_steps, thinking_state,
         object_classes, data_count, abc_sub_questions, abc_dsls, abc_codes, abc_out_key_refs, replay_plan,
         created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$32)
       ON CONFLICT (thread_id, request_seq, source_kind, source_ref)
       DO UPDATE SET
         source_stage = COALESCE(EXCLUDED.source_stage, ${qualifiedTable("query_runs")}.source_stage),
         question = COALESCE(EXCLUDED.question, ${qualifiedTable("query_runs")}.question),
         status = EXCLUDED.status,
         error = EXCLUDED.error,
         backend_sessions = COALESCE(EXCLUDED.backend_sessions, ${qualifiedTable("query_runs")}.backend_sessions),
         node_ids = EXCLUDED.node_ids,
         markdown_table = EXCLUDED.markdown_table,
         dataset_previews = EXCLUDED.dataset_previews,
         cards = EXCLUDED.cards,
         winner = EXCLUDED.winner,
         data_payload = EXCLUDED.data_payload,
         datasets_payload = EXCLUDED.datasets_payload,
         dsl_payload = EXCLUDED.dsl_payload,
         dsl_text = EXCLUDED.dsl_text,
         ir = EXCLUDED.ir,
         full_content = EXCLUDED.full_content,
         thinking_summary = EXCLUDED.thinking_summary,
         thinking_steps = EXCLUDED.thinking_steps,
         thinking_state = EXCLUDED.thinking_state,
         object_classes = EXCLUDED.object_classes,
         data_count = EXCLUDED.data_count,
         abc_sub_questions = EXCLUDED.abc_sub_questions,
         abc_dsls = EXCLUDED.abc_dsls,
         abc_codes = EXCLUDED.abc_codes,
         abc_out_key_refs = EXCLUDED.abc_out_key_refs,
         replay_plan = EXCLUDED.replay_plan,
         updated_at = EXCLUDED.updated_at`,
    [
      id,
      input.threadId,
      input.requestSeq,
      input.sourceKind,
      input.sourceRef,
      input.sourceStage || null,
      input.question || null,
      input.status || "completed",
      input.error || null,
      jsonParam(input.backendSessions),
      jsonParam(input.nodeIds),
      input.markdownTable || null,
      jsonParam(input.datasetPreviews),
      jsonParam(input.cards),
      input.winner || null,
      jsonParam(input.dataPayload),
      jsonParam(input.datasetsPayload),
      jsonParam(input.dslPayload),
      input.dslText || null,
      input.ir || null,
      input.fullContent || null,
      input.thinkingSummary || null,
      jsonParam(input.thinkingSteps),
      jsonParam(input.thinkingState),
      input.objectClasses || null,
      input.dataCount ?? null,
      jsonParam(input.abcSubQuestions),
      jsonParam(input.abcDsls),
      jsonParam(input.abcCodes),
      jsonParam(input.abcOutKeyRefs),
      jsonParam(input.replayPlan),
      now,
    ]
  );
}

export async function startQueryRun(
  input: QueryRunKey & Pick<UpsertQueryRunInput, "sourceStage" | "question">
): Promise<void> {
  const now = new Date();
  await getPostgresPool().query(
    `INSERT INTO ${qualifiedTable("query_runs")}
        (id, thread_id, request_seq, source_kind, source_ref, source_stage, question,
         status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'in_progress',$8,$8)
       ON CONFLICT (thread_id, request_seq, source_kind, source_ref) DO NOTHING`,
    [
      buildQueryRunId(input.threadId, input.requestSeq, input.sourceRef),
      input.threadId,
      input.requestSeq,
      input.sourceKind,
      input.sourceRef,
      input.sourceStage || null,
      input.question || null,
      now,
    ]
  );
}

export async function updateQueryRunBackendSessions(
  input: QueryRunKey & { backendSessions: QueryBackendSession[] }
): Promise<void> {
  await getPostgresPool().query(
    `UPDATE ${qualifiedTable("query_runs")}
       SET backend_sessions = $5::jsonb,
           updated_at = $6
       WHERE thread_id = $1
         AND request_seq = $2
         AND source_kind = $3
         AND source_ref = $4`,
    [
      input.threadId,
      input.requestSeq,
      input.sourceKind,
      input.sourceRef,
      JSON.stringify(input.backendSessions),
      new Date(),
    ]
  );
}

/** Writes back only the two quality-check columns: a late fact must never overwrite a whole row of already finalized execution facts. Returns the number of rows hit. */
export async function updateQueryRunQualityCheck(
  input: QueryRunKey & { qcResult?: unknown; qcState?: unknown }
): Promise<number> {
  const result = await getPostgresPool().query(
    `UPDATE ${qualifiedTable("query_runs")}
       SET qc_result = $5::jsonb,
           qc_state = $6::jsonb,
           updated_at = $7
       WHERE thread_id = $1
         AND request_seq = $2
         AND source_kind = $3
         AND source_ref = $4`,
    [
      input.threadId,
      input.requestSeq,
      input.sourceKind,
      input.sourceRef,
      jsonParam(input.qcResult),
      jsonParam(input.qcState),
      new Date(),
    ]
  );
  return result.rowCount ?? 0;
}

export async function listQueryRuns(threadId: string, requestSeq?: number): Promise<QueryRun[]> {
  const params: any[] = [threadId];
  let where = "thread_id = $1";
  if (requestSeq !== undefined) {
    params.push(requestSeq);
    where += " AND request_seq = $2";
  }
  const result = await getPostgresPool().query(
    `SELECT * FROM ${qualifiedTable("query_runs")}
       WHERE ${where}
       ORDER BY request_seq, created_at, source_kind, source_ref`,
    params
  );
  return result.rows.map(mapQueryRunRow);
}

export async function getPrimaryQueryRun(
  threadId: string,
  requestSeq: number
): Promise<QueryRun | null> {
  const result = await getPostgresPool().query(
    `SELECT * FROM ${qualifiedTable("query_runs")}
       WHERE thread_id = $1
         AND request_seq = $2
         AND source_kind IN ('query_stage', 'abc_query_stage')
       ORDER BY
         CASE source_kind WHEN 'query_stage' THEN 0 ELSE 1 END,
         created_at DESC
       LIMIT 1`,
    [threadId, requestSeq]
  );
  return result.rows[0] ? mapQueryRunRow(result.rows[0]) : null;
}

export async function getQueryRunBySource(input: {
  threadId: string;
  requestSeq: number;
  sourceKind: string;
  sourceRef: string;
}): Promise<QueryRun | null> {
  const result = await getPostgresPool().query(
    `SELECT * FROM ${qualifiedTable("query_runs")}
       WHERE thread_id = $1
         AND request_seq = $2
         AND source_kind = $3
         AND source_ref = $4
       LIMIT 1`,
    [input.threadId, input.requestSeq, input.sourceKind, input.sourceRef]
  );
  return result.rows[0] ? mapQueryRunRow(result.rows[0]) : null;
}

export async function getObjectClasses(threadId: string, requestSeq?: number): Promise<string[]> {
  const params: any[] = [threadId];
  let where = "thread_id = $1";
  if (requestSeq !== undefined) {
    params.push(requestSeq);
    where += " AND request_seq = $2";
  }
  const result = await getPostgresPool().query(
    `SELECT DISTINCT unnest(object_classes) AS class
       FROM ${qualifiedTable("query_runs")}
       WHERE ${where}
         AND object_classes IS NOT NULL
         AND array_length(object_classes, 1) > 0`,
    params
  );
  return result.rows.map((row) => String(row.class)).filter(Boolean);
}

export async function deleteThreadQueryRuns(threadId: string): Promise<void> {
  await getPostgresPool().query(
    `DELETE FROM ${qualifiedTable("query_runs")} WHERE thread_id = $1`,
    [threadId]
  );
}
