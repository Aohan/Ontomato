import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/**
 * 查询记录的后端会话列：按分支的会话列表 `[{branch, sessionId, nodeId}]`，
 * 取代此前的单值 `session_id`/`backend_node_id`（问数后端会话的定位与取消·设计 6）。
 */
export async function ensureQueryRunBackendSessionsSchema(client: QueryableClient): Promise<void> {
  await client.query(
    `ALTER TABLE ${qualifiedTable("query_runs")} ADD COLUMN IF NOT EXISTS backend_sessions JSONB`
  );
}
