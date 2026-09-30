import type { ClarificationOption } from "@ontomato/contracts/chat";
import { createHash } from "node:crypto";
import { getPostgresPool, qualifiedTable } from "../../infrastructure/postgres";

/**
 * Standard query turn snapshot persisted in PostgreSQL.
 *
 * Only turn-level assembly artifacts belong here; query facts are owned by query_runs and execution diagnostics
 * by execution_events. The combined read model the API returns to the page is not this type.
 */
export interface PersistedChatRenderSnapshot {
  mode: string;
  status: string;
  primaryText: string;
  analysisText?: string;
  visualizationHTML?: string;
  clarification?: {
    message: string;
    options: ClarificationOption[];
  };
  followUpUserMessage?: string;
}

export interface ChatRenderSnapshot {
  id: string;
  threadId: string;
  requestSeq: number;
  snapshot: PersistedChatRenderSnapshot;
  snapshotMode?: string;
  snapshotStatus?: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

function snapshotId(threadId: string, requestSeq: number): string {
  return `snapshot:${createHash("md5").update(`${threadId}:${requestSeq}`).digest("hex")}`;
}

function persistedSnapshotJson(snapshot: PersistedChatRenderSnapshot): string {
  const persisted: PersistedChatRenderSnapshot = {
    mode: snapshot.mode,
    status: snapshot.status,
    primaryText: snapshot.primaryText,
    ...(snapshot.analysisText !== undefined ? { analysisText: snapshot.analysisText } : {}),
    ...(snapshot.visualizationHTML !== undefined
      ? { visualizationHTML: snapshot.visualizationHTML }
      : {}),
    ...(snapshot.clarification !== undefined ? { clarification: snapshot.clarification } : {}),
    ...(snapshot.followUpUserMessage !== undefined
      ? { followUpUserMessage: snapshot.followUpUserMessage }
      : {}),
  };
  return JSON.stringify(persisted);
}

function mapSnapshotRow(row: any): ChatRenderSnapshot {
  return {
    id: row.id,
    threadId: row.thread_id,
    requestSeq: row.request_seq,
    snapshot: row.snapshot,
    snapshotMode: row.snapshot_mode || undefined,
    snapshotStatus: row.snapshot_status || undefined,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function upsertChatRenderSnapshot(
  input: Omit<ChatRenderSnapshot, "id" | "source" | "createdAt" | "updatedAt"> & {
    source?: string;
  }
): Promise<void> {
  const id = snapshotId(input.threadId, input.requestSeq);
  const snapshot = input.snapshot;
  const mode = input.snapshotMode || snapshot.mode || null;
  const status = input.snapshotStatus || snapshot.status || null;
  const now = new Date();

  await getPostgresPool().query(
    `INSERT INTO ${qualifiedTable("chat_render_snapshots")}
        (id, thread_id, request_seq, snapshot, snapshot_mode, snapshot_status,
         source, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       ON CONFLICT (thread_id, request_seq)
       DO UPDATE SET
         snapshot = EXCLUDED.snapshot,
         snapshot_mode = EXCLUDED.snapshot_mode,
         snapshot_status = EXCLUDED.snapshot_status,
         source = EXCLUDED.source,
         updated_at = EXCLUDED.updated_at`,
    [
      id,
      input.threadId,
      input.requestSeq,
      persistedSnapshotJson(input.snapshot),
      mode,
      status,
      input.source || "runtime",
      now,
    ]
  );
}

export async function listChatRenderSnapshots(threadId: string): Promise<ChatRenderSnapshot[]> {
  const result = await getPostgresPool().query(
    `SELECT * FROM ${qualifiedTable("chat_render_snapshots")}
       WHERE thread_id = $1
       ORDER BY request_seq`,
    [threadId]
  );
  return result.rows.map(mapSnapshotRow);
}

export async function deleteThreadChatRenderSnapshots(threadId: string): Promise<void> {
  await getPostgresPool().query(
    `DELETE FROM ${qualifiedTable("chat_render_snapshots")} WHERE thread_id = $1`,
    [threadId]
  );
}
