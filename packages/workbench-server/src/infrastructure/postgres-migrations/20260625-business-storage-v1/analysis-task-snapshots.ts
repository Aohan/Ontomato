import { qualifiedTable } from "../../postgres.js";
import {
  getTableColumns,
  hasRequiredColumns,
  integerJsonTextSql,
  nullableColumn,
  type QueryableClient,
} from "../helpers.js";

export interface AnalysisTaskArtifactSyncResult {
  snapshots: number;
  reports: number;
  payloads: number;
}

const NOW_MS_SQL = "(EXTRACT(EPOCH FROM NOW()) * 1000)::bigint";

/**
 * The task snapshot table is this sync's own staging structure: the old database's page snapshots are merged here first,
 * then backfilled from it into the task rows' report and payload. The 20260828 migration drops it after syncing,
 * so the table is created inside the sync — it exists only while this sync actually runs, and the runtime never owns it.
 */
async function ensureAnalysisTaskSnapshotTable(client: QueryableClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("analysis_task_snapshots")} (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      thread_id TEXT,
      request_seq INTEGER,
      snapshot JSONB NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE (task_id)
    )
  `);
}

export async function syncAnalysisTaskArtifacts(
  client: QueryableClient
): Promise<AnalysisTaskArtifactSyncResult> {
  const taskColumns = await getTableColumns(client, "analysis_tasks");
  if (!hasRequiredColumns(taskColumns, ["id"])) {
    return { snapshots: 0, reports: 0, payloads: 0 };
  }
  await ensureAnalysisTaskSnapshotTable(client);

  const snapshotsFromChat = await copyAnalysisTaskSnapshotsFromChatSnapshots(client, taskColumns);
  const snapshotsFromTasks = await synthesizeAnalysisTaskSnapshotsFromTasks(client, taskColumns);
  const reports = await syncAnalysisTaskReportsFromSnapshots(client, taskColumns);
  const payloads = await syncAnalysisTaskPayloadsFromSnapshots(client, taskColumns);

  return {
    snapshots: snapshotsFromChat + snapshotsFromTasks,
    reports,
    payloads,
  };
}

async function copyAnalysisTaskSnapshotsFromChatSnapshots(
  client: QueryableClient,
  taskColumns: Set<string>
): Promise<number> {
  const snapshotColumns = await getTableColumns(client, "chat_render_snapshots");
  if (
    !hasRequiredColumns(taskColumns, ["id", "thread_id"]) ||
    !hasRequiredColumns(snapshotColumns, ["thread_id", "request_seq", "snapshot"])
  ) {
    return 0;
  }

  const snapshotModeExpr = nullableColumn(snapshotColumns, "s", "snapshot_mode", "NULL::text");
  const snapshotStatusExpr = nullableColumn(snapshotColumns, "s", "snapshot_status", "NULL::text");

  const result = await client.query(`
    WITH ranked_snapshots AS (
      SELECT
        t.id AS task_id,
        t.thread_id AS thread_id,
        s.request_seq AS request_seq,
        s.snapshot AS snapshot,
        ROW_NUMBER() OVER (
          PARTITION BY t.id
          ORDER BY
            CASE
              WHEN NULLIF(s.snapshot->>'taskId', '') = t.id THEN 0
              WHEN COALESCE(${snapshotModeExpr}, s.snapshot->>'mode') = 'deep-analysis' THEN 1
              WHEN s.snapshot ? 'deepAnalysis' THEN 2
              WHEN ${snapshotStatusExpr} = 'completed' THEN 3
              ELSE 4
            END,
            s.request_seq DESC
        ) AS rn
      FROM ${qualifiedTable("analysis_tasks")} t
      JOIN ${qualifiedTable("chat_render_snapshots")} s
        ON s.thread_id = t.thread_id
      WHERE t.thread_id IS NOT NULL
        AND (
          NULLIF(s.snapshot->>'taskId', '') = t.id
          OR COALESCE(${snapshotModeExpr}, s.snapshot->>'mode') = 'deep-analysis'
          OR s.snapshot ? 'deepAnalysis'
        )
    )
    INSERT INTO ${qualifiedTable("analysis_task_snapshots")}
      (id, task_id, thread_id, request_seq, snapshot, created_at, updated_at)
    SELECT
      'analysis-task-snapshot:' || task_id,
      task_id,
      thread_id,
      request_seq,
      snapshot,
      ${NOW_MS_SQL},
      ${NOW_MS_SQL}
    FROM ranked_snapshots
    WHERE rn = 1
    ON CONFLICT (task_id) DO NOTHING
  `);
  return result.rowCount ?? 0;
}

async function synthesizeAnalysisTaskSnapshotsFromTasks(
  client: QueryableClient,
  taskColumns: Set<string>
): Promise<number> {
  const hasArtifactColumn =
    taskColumns.has("analysis_payload") ||
    taskColumns.has("result_report") ||
    taskColumns.has("result_summary");
  if (!hasArtifactColumn) return 0;

  const threadExpr = nullableColumn(taskColumns, "t", "thread_id", "NULL::text");
  const statusExpr = nullableColumn(taskColumns, "t", "status", "NULL::text");
  const payloadExpr = nullableColumn(taskColumns, "t", "analysis_payload", "NULL::jsonb");
  const reportExpr = nullableColumn(taskColumns, "t", "result_report", "NULL::text");
  const summaryExpr = nullableColumn(taskColumns, "t", "result_summary", "NULL::text");
  const requestSeqExpr = integerJsonTextSql(`(${payloadExpr}->>'requestSeq')`);

  const result = await client.query(`
    WITH task_artifacts AS (
      SELECT
        t.id AS task_id,
        ${threadExpr} AS thread_id,
        ${requestSeqExpr} AS request_seq,
        ${payloadExpr} AS payload,
        COALESCE(NULLIF(${reportExpr}, ''), NULLIF(${summaryExpr}, ''), '') AS primary_text,
        ${statusExpr} AS task_status
      FROM ${qualifiedTable("analysis_tasks")} t
      WHERE ${payloadExpr} IS NOT NULL
        OR NULLIF(${reportExpr}, '') IS NOT NULL
        OR NULLIF(${summaryExpr}, '') IS NOT NULL
    )
    INSERT INTO ${qualifiedTable("analysis_task_snapshots")}
      (id, task_id, thread_id, request_seq, snapshot, created_at, updated_at)
    SELECT
      'analysis-task-snapshot:' || task_id,
      task_id,
      thread_id,
      request_seq,
      jsonb_strip_nulls(jsonb_build_object(
        'mode', 'deep-analysis',
        'status', CASE
          WHEN task_status IN ('failed', 'cancelled') THEN 'failed'
          WHEN task_status = 'completed' THEN 'completed'
          ELSE 'streaming'
        END,
        'source', 'history',
        'taskId', task_id,
        'threadId', thread_id,
        'requestSeq', request_seq,
        'primaryText', primary_text,
        'deepAnalysis', COALESCE(payload, jsonb_build_object('report', primary_text))
      )),
      ${NOW_MS_SQL},
      ${NOW_MS_SQL}
    FROM task_artifacts
    ON CONFLICT (task_id) DO NOTHING
  `);
  return result.rowCount ?? 0;
}

async function syncAnalysisTaskReportsFromSnapshots(
  client: QueryableClient,
  taskColumns: Set<string>
): Promise<number> {
  if (!taskColumns.has("result_report")) return 0;

  const updatedAtSet = taskColumns.has("updated_at")
    ? `, updated_at = GREATEST(COALESCE(t.updated_at, 0), ${NOW_MS_SQL})`
    : "";
  const result = await client.query(`
    UPDATE ${qualifiedTable("analysis_tasks")} t
    SET result_report = NULLIF(s.snapshot->>'primaryText', '')
        ${updatedAtSet}
    FROM ${qualifiedTable("analysis_task_snapshots")} s
    WHERE s.task_id = t.id
      AND NULLIF(s.snapshot->>'primaryText', '') IS NOT NULL
      AND NULLIF(t.result_report, '') IS NULL
  `);
  return result.rowCount ?? 0;
}

async function syncAnalysisTaskPayloadsFromSnapshots(
  client: QueryableClient,
  taskColumns: Set<string>
): Promise<number> {
  if (!taskColumns.has("analysis_payload")) return 0;

  const reportExpr = nullableColumn(taskColumns, "t", "result_report", "NULL::text");
  const updatedAtSet = taskColumns.has("updated_at")
    ? `, updated_at = GREATEST(COALESCE(t.updated_at, 0), ${NOW_MS_SQL})`
    : "";
  const result = await client.query(`
    UPDATE ${qualifiedTable("analysis_tasks")} t
    SET analysis_payload = COALESCE(s.snapshot->'deepAnalysis', '{}'::jsonb)
          || jsonb_strip_nulls(jsonb_build_object('requestSeq', s.request_seq,
               'report', COALESCE(NULLIF(s.snapshot->>'primaryText', ''), NULLIF(${reportExpr}, ''))))
        ${updatedAtSet}
    FROM ${qualifiedTable("analysis_task_snapshots")} s
    WHERE s.task_id = t.id
      AND t.analysis_payload IS NULL
      AND (
        s.snapshot ? 'deepAnalysis'
        OR NULLIF(s.snapshot->>'primaryText', '') IS NOT NULL
      )
  `);
  return result.rowCount ?? 0;
}
