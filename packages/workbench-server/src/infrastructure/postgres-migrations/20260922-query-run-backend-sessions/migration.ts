import { qualifiedTable } from "../../postgres.js";
import { getTableColumns } from "../helpers.js";
import type { QueryableClient } from "../helpers.js";

export const QUERY_RUN_BACKEND_SESSIONS_VERSION = "20260922_query_run_backend_sessions_v1";
export const QUERY_RUN_BACKEND_SESSIONS_NAME = "query runs store backend sessions per branch";

export type QueryRunBackendSessionsResult = {
  /** 转成会话列表的行数 */
  migratedRows: number;
  /** 单值会话列是否已退役 */
  legacyColumnsDropped: boolean;
};

/**
 * 把单值会话列搬进按分支的会话列表，然后退役 `session_id`/`backend_node_id`。
 * 历史上只有 abc 分支产生过会话号，旧行一律记为 abc（设计 6）。
 * 单值列不存在时说明本迁移已经完成，直接返回。
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
