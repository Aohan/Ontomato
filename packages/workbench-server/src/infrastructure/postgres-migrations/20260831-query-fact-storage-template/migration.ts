import { qualifiedTable } from "../../postgres.js";
import { getTableColumns } from "../helpers.js";
import type { QueryableClient } from "../helpers.js";

export const QUERY_FACT_STORAGE_TEMPLATE_VERSION = "20260831_query_fact_storage_template_v1";
export const QUERY_FACT_STORAGE_TEMPLATE_NAME = "query facts stored by a single column template";

export type QueryFactStorageTemplateResult = {
  /** 搬运了内容的行数 */
  backfilledRows: number;
  /** 混装列是否已退役 */
  legacyColumnDropped: boolean;
};

/**
 * 把混装列 `result_payload` 中的查询事实搬进各自的结构化列，然后退役该列。
 *
 * 搬运只填空（`COALESCE(既有列, 混装值)`），因此可重复执行且不覆盖已有事实。
 * 混装列不存在时说明本迁移已经完成，直接返回；混装列存在则必须搬运成功才退役，
 * 任何失败都向上抛出，由编排层回滚事务并阻止记录版本。
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
 * 混装列里的单值会话转成按分支的会话列表（设计 6）：历史上只有 abc 产生过会话号。
 * 列形状在此写定，后续的列退役迁移只负责既有结构化列的历史行。
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
