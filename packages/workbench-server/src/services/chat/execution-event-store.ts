import { createHash } from "node:crypto";
import { getPostgresPool, qualifiedTable } from "../../infrastructure/postgres";

export interface ExecutionEvent {
  id: string;
  threadId: string;
  requestSeq: number;
  eventSeq: number;
  eventType: string;
  eventName: string;
  eventIcon?: string;
  status?: "pending" | "in_progress" | "completed" | "failed" | string;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  error?: string;
  sourceKind: string;
  sourceRef: string;
  legacyChainId?: number;
  createdAt: Date;
  updatedAt: Date;
}

function eventId(threadId: string, requestSeq: number, sourceRef: string): string {
  return `event:${createHash("md5")
    .update(`${threadId}:${requestSeq}:${sourceRef}`)
    .digest("hex")}`;
}

function mapExecutionEventRow(row: any): ExecutionEvent {
  return {
    id: row.id,
    threadId: row.thread_id,
    requestSeq: row.request_seq,
    eventSeq: row.event_seq,
    eventType: row.event_type,
    eventName: row.event_name,
    eventIcon: row.event_icon || undefined,
    status: row.status || undefined,
    startedAt:
      row.started_at === null || row.started_at === undefined ? undefined : Number(row.started_at),
    endedAt: row.ended_at === null || row.ended_at === undefined ? undefined : Number(row.ended_at),
    durationMs:
      row.duration_ms === null || row.duration_ms === undefined
        ? undefined
        : Number(row.duration_ms),
    error: row.error || undefined,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    legacyChainId:
      row.legacy_chain_id === null || row.legacy_chain_id === undefined
        ? undefined
        : Number(row.legacy_chain_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function upsertExecutionEvent(
  input: Omit<ExecutionEvent, "id" | "sourceKind" | "legacyChainId" | "createdAt" | "updatedAt"> & {
    sourceKind?: string;
  }
): Promise<void> {
  const sourceKind = input.sourceKind || "runtime";
  const id = eventId(input.threadId, input.requestSeq, input.sourceRef);
  const now = new Date();
  await getPostgresPool().query(
    `INSERT INTO ${qualifiedTable("execution_events")}
        (id, thread_id, request_seq, event_seq, event_type, event_name, event_icon,
         status, started_at, ended_at, duration_ms, error, source_kind, source_ref,
         created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
       ON CONFLICT (thread_id, request_seq, source_kind, source_ref)
       DO UPDATE SET
         event_seq = EXCLUDED.event_seq,
         event_type = EXCLUDED.event_type,
         event_name = EXCLUDED.event_name,
         event_icon = EXCLUDED.event_icon,
         status = EXCLUDED.status,
         started_at = COALESCE(EXCLUDED.started_at, ${qualifiedTable("execution_events")}.started_at),
         ended_at = EXCLUDED.ended_at,
         duration_ms = EXCLUDED.duration_ms,
         error = EXCLUDED.error,
         updated_at = EXCLUDED.updated_at`,
    [
      id,
      input.threadId,
      input.requestSeq,
      input.eventSeq,
      input.eventType,
      input.eventName,
      input.eventIcon || null,
      input.status || null,
      input.startedAt ?? null,
      input.endedAt ?? null,
      input.durationMs ?? null,
      input.error || null,
      sourceKind,
      input.sourceRef,
      now,
    ]
  );
}

export async function listExecutionEvents(
  threadId: string,
  requestSeq?: number
): Promise<ExecutionEvent[]> {
  const params: any[] = [threadId];
  let where = "thread_id = $1";
  if (requestSeq !== undefined) {
    params.push(requestSeq);
    where += " AND request_seq = $2";
  }
  const result = await getPostgresPool().query(
    `SELECT * FROM ${qualifiedTable("execution_events")}
       WHERE ${where}
       ORDER BY request_seq, event_seq, created_at`,
    params
  );
  return result.rows.map(mapExecutionEventRow);
}

export async function deleteThreadExecutionEvents(threadId: string): Promise<void> {
  await getPostgresPool().query(
    `DELETE FROM ${qualifiedTable("execution_events")} WHERE thread_id = $1`,
    [threadId]
  );
}
