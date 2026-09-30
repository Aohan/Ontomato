import { qualifiedTable } from "../../postgres.js";
import { getTableColumns } from "../helpers.js";
import type { QueryableClient } from "../helpers.js";

export const QUERY_RUN_BACKEND_SESSIONS_VERSION = "20260922_query_run_backend_sessions_v1";
export const QUERY_RUN_BACKEND_SESSIONS_NAME = "query runs store backend sessions per branch";

export type QueryRunBackendSessionsResult = {
  /** Number of rows converted into session lists */
  migratedRows: number;
  /** Whether the single-value session columns have been retired */
  legacyColumnsDropped: boolean;
};

/**
 * Carries the single-value session columns into the per-branch session list, then retires `session_id`/`backend_node_id`.
 * Historically only the abc branch produced session numbers, so old rows are uniformly recorded as abc (design 6).
 * Missing single-value columns mean this migration already completed and it returns directly.
 */
export async function migrateQueryRunBackendSessions(
  client: QueryableClient
): Promise<QueryRunBackendSessionsResult> {
  const columns = await getTableColumns(client, "query_runs");
  if (!columns.has("session_id")) {
    return { migratedRows: 0, legacyColumnsDropped: false };
  }

  const table = qualifiedTable("query_runs");
  const migrated = await client.query(
    `UPDATE ${table}
        SET backend_sessions = jsonb_build_array(
              jsonb_strip_nulls(jsonb_build_object(
                'branch', 'abc',
                'sessionId', session_id,
                'nodeId', backend_node_id)))
      WHERE session_id IS NOT NULL`
  );

  await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS session_id`);
  await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS backend_node_id`);

  return { migratedRows: migrated.rowCount ?? 0, legacyColumnsDropped: true };
}
