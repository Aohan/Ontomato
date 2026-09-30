import { qualifiedTable } from "../../postgres.js";
import { getTableColumns } from "../helpers.js";
import type { QueryableClient } from "../helpers.js";

export const QUERY_FACT_STORAGE_TEMPLATE_VERSION = "20260831_query_fact_storage_template_v1";
export const QUERY_FACT_STORAGE_TEMPLATE_NAME = "query facts stored by a single column template";

export type QueryFactStorageTemplateResult = {
  /** Number of rows whose content was carried over */
  backfilledRows: number;
  /** Whether the mixed column has been retired */
  legacyColumnDropped: boolean;
};

/**
 * Carries the query facts out of the mixed column `result_payload` into their structured columns, then retires the column.
 *
 * The carry only fills blanks (`COALESCE(existing column, mixed value)`), so it is repeatable and never overwrites existing facts.
 * A missing mixed column means this migration already completed and it returns directly; when the column exists the carry must succeed before retirement,
 * and any failure propagates upward for the orchestration layer to roll back the transaction and block version recording.
 */
export async function migrateQueryFactStorageTemplate(
  client: QueryableClient
): Promise<QueryFactStorageTemplateResult> {
  const columns = await getTableColumns(client, "query_runs");
  if (!columns.has("result_payload")) {
    return { backfilledRows: 0, legacyColumnDropped: false };
  }

  const table = qualifiedTable("query_runs");
  const backfilled = await client.query(
    `UPDATE ${table} SET
       backend_sessions = COALESCE(backend_sessions, ${backendSessionsFromLegacy()}),
       node_ids = COALESCE(node_ids, ${jsonArray("nodeIds")}),
       markdown_table = COALESCE(markdown_table, NULLIF(result_payload->>'markdownTable', '')),
       dataset_previews = COALESCE(dataset_previews, ${jsonArray("datasetPreviews")}),
       cards = COALESCE(cards, ${jsonArray("cards")}),
       winner = COALESCE(winner, NULLIF(result_payload->>'winner', '')),
       full_content = COALESCE(full_content, NULLIF(result_payload->>'fullContent', '')),
       thinking_summary = COALESCE(thinking_summary, NULLIF(result_payload->>'thinkingSummary', '')),
       thinking_state = COALESCE(thinking_state, ${jsonObject("thinkingState")}),
       data_payload = COALESCE(data_payload,
         CASE WHEN result_payload ? 'data' THEN result_payload->'data' END),
       datasets_payload = COALESCE(datasets_payload, ${jsonArray("datasets")}),
       dsl_payload = COALESCE(dsl_payload, CASE WHEN result_payload ? 'dsl' THEN result_payload->'dsl' END)
     WHERE result_payload IS NOT NULL`
  );

  await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS result_payload`);

  return { backfilledRows: backfilled.rowCount ?? 0, legacyColumnDropped: true };
}

function jsonArray(key: string): string {
  return `CASE WHEN jsonb_typeof(result_payload->'${key}') = 'array' THEN result_payload->'${key}' END`;
}

/**
 * Single-value sessions in the mixed column become the per-branch session list (design 6): historically only abc produced session numbers.
 * The column shape is pinned here; later column-retirement migrations only handle historical rows of existing structured columns.
 */
function backendSessionsFromLegacy(): string {
  const sessionId = `COALESCE(
         NULLIF(result_payload->>'sessionId', ''),
         NULLIF(result_payload->>'session_id', ''),
         NULLIF(result_payload->'replayPlan'->>'sessionId', ''),
         NULLIF(replay_plan->>'sessionId', ''))`;
  const nodeId = `COALESCE(
         NULLIF(result_payload->>'backendNodeId', ''),
         NULLIF(result_payload->>'backend_node_id', ''),
         NULLIF(result_payload->'replayPlan'->>'backendNodeId', ''))`;
  return `CASE WHEN ${sessionId} IS NOT NULL THEN jsonb_build_array(
            jsonb_strip_nulls(jsonb_build_object('branch', 'abc', 'sessionId', ${sessionId}, 'nodeId', ${nodeId})))
          END`;
}

function jsonObject(key: string): string {
  return `CASE WHEN jsonb_typeof(result_payload->'${key}') = 'object' THEN result_payload->'${key}' END`;
}
