import { qualifiedTable } from "../../postgres.js";
import {
  getTableColumns,
  hasRequiredColumns,
  timestampColumn,
  type QueryableClient,
} from "../helpers.js";

export async function copyLegacyChatRenderSnapshots(client: QueryableClient): Promise<number> {
  const snapshotColumns = await getTableColumns(client, "response_snapshots");
  if (!hasRequiredColumns(snapshotColumns, ["thread_id", "request_seq", "snapshot"])) return 0;

  const createdAtExpr = timestampColumn(snapshotColumns, "r", "created_at");
  const updatedAtExpr = timestampColumn(snapshotColumns, "r", "updated_at", createdAtExpr);

  const result = await client.query(`
    INSERT INTO ${qualifiedTable("chat_render_snapshots")}
      (id, thread_id, request_seq, snapshot, snapshot_mode, snapshot_status, source, created_at, updated_at)
    SELECT
      'snapshot:' || md5(r.thread_id || ':' || r.request_seq::text),
      r.thread_id,
      r.request_seq,
      r.snapshot,
      NULLIF(r.snapshot->>'mode', ''),
      NULLIF(r.snapshot->>'status', ''),
      'legacy_response_snapshots',
      ${createdAtExpr},
      COALESCE(${updatedAtExpr}, ${createdAtExpr})
    FROM ${qualifiedTable("response_snapshots")} r
    ON CONFLICT (thread_id, request_seq)
    DO UPDATE SET
      snapshot = EXCLUDED.snapshot,
      snapshot_mode = EXCLUDED.snapshot_mode,
      snapshot_status = EXCLUDED.snapshot_status,
      updated_at = GREATEST(${qualifiedTable("chat_render_snapshots")}.updated_at, EXCLUDED.updated_at)
  `);
  return result.rowCount ?? 0;
}
