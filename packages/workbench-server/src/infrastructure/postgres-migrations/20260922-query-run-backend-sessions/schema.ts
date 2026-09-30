import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/**
 * Backend session columns of a query record: the per-branch session list `[{branch, sessionId, nodeId}]`,
 * replacing the previous single-value `session_id`/`backend_node_id` (backend session locating and cancellation · design 6).
 */
export async function ensureQueryRunBackendSessionsSchema(client: QueryableClient): Promise<void> {
  await client.query(
    `ALTER TABLE ${qualifiedTable("query_runs")} ADD COLUMN IF NOT EXISTS backend_sessions JSONB`
  );
}
