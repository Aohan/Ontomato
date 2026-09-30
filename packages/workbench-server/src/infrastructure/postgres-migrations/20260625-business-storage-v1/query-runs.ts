import { qualifiedTable } from "../../postgres.js";
import {
  datasetRowCountSql,
  getTableColumns,
  hasRequiredColumns,
  integerJsonTextSql,
  jsonColumn,
  nullableColumn,
  numericColumn,
  queryRunIdSql,
  textColumn,
  timestampColumn,
  type QueryableClient,
} from "../helpers.js";

export async function copyLegacyQueryRuns(client: QueryableClient): Promise<number> {
  const stageColumns = await getTableColumns(client, "stage_results");
  if (!hasRequiredColumns(stageColumns, ["thread_id", "request_seq", "stage"])) return 0;

  let copied = 0;
  copied += await copyQueryRunsFromQueryStages(client, stageColumns);
  copied += await copyQueryRunsFromAnalysisSubQuestions(client, stageColumns);
  return copied;
}

async function copyQueryRunsFromQueryStages(
  client: QueryableClient,
  stageColumns: Set<string>
): Promise<number> {
  const idExpr = nullableColumn(stageColumns, "s", "id", "NULL::bigint");
  const resultExpr = jsonColumn(stageColumns, "s", "result");
  const statusExpr = textColumn(stageColumns, "s", "status", "'completed'");
  const errorExpr = nullableColumn(stageColumns, "s", "error", "NULL::text");
  const dslTextExpr = nullableColumn(stageColumns, "s", "dsl", "NULL::text");
  const irExpr = nullableColumn(stageColumns, "s", "ir", "NULL::text");
  const fullContentExpr = nullableColumn(stageColumns, "s", "full_content", "NULL::text");
  const thinkingSummaryExpr = nullableColumn(stageColumns, "s", "thinking_summary", "NULL::text");
  const thinkingStepsExpr = jsonColumn(stageColumns, "s", "thinking_steps");
  const thinkingStateExpr = jsonColumn(stageColumns, "s", "thinking_state");
  const qcResultExpr = jsonColumn(stageColumns, "s", "qc_result");
  const qcStateExpr = jsonColumn(stageColumns, "s", "qc_state");
  const objectClassesExpr = nullableColumn(stageColumns, "s", "object_classes", "NULL::text[]");
  const dataCountExpr = numericColumn(stageColumns, "s", "data_count", "NULL::integer");
  const createdAtExpr = timestampColumn(stageColumns, "s", "created_at");
  const legacyPayload = `jsonb_strip_nulls(jsonb_build_object('result', ${jsonColumn(stageColumns, "s", "result")}))`;

  const result = await client.query(`
    INSERT INTO ${qualifiedTable("query_runs")}
      (id, thread_id, request_seq, source_kind, source_ref, source_stage, question,
       status, error, result_payload, data_payload, datasets_payload, dsl_payload, dsl_text, ir,
       full_content, thinking_summary, thinking_steps, thinking_state, qc_result, qc_state,
       object_classes, data_count, legacy_stage_id, legacy_payload, created_at, updated_at)
    SELECT
      ${queryRunIdSql("s.thread_id", "s.request_seq", "s.stage")} AS id,
      s.thread_id,
      s.request_seq,
      CASE WHEN s.stage = 'abc_query' THEN 'abc_query_stage' ELSE 'query_stage' END,
      s.stage,
      s.stage,
      COALESCE(
        NULLIF(${resultExpr}->>'question', ''),
        NULLIF(${resultExpr}->>'originalQuestion', ''),
        NULLIF(${resultExpr}->>'userQuestion', '')
      ),
      ${statusExpr},
      ${errorExpr},
      ${resultExpr},
      ${resultExpr}->'data',
      COALESCE(${resultExpr}->'datasets', ${resultExpr}->'data'),
      ${resultExpr}->'dsl',
      ${dslTextExpr},
      ${irExpr},
      ${fullContentExpr},
      ${thinkingSummaryExpr},
      ${thinkingStepsExpr},
      ${thinkingStateExpr},
      ${qcResultExpr},
      ${qcStateExpr},
      ${objectClassesExpr},
      COALESCE(${dataCountExpr}, ${datasetRowCountSql(`COALESCE(${resultExpr}->'datasets', ${resultExpr}->'data')`)}),
      ${idExpr},
      ${legacyPayload},
      ${createdAtExpr},
      ${createdAtExpr}
    FROM ${qualifiedTable("stage_results")} s
    WHERE s.stage IN ('query', 'abc_query')
    ON CONFLICT (thread_id, request_seq, source_kind, source_ref)
    DO UPDATE SET
      status = EXCLUDED.status,
      result_payload = COALESCE(EXCLUDED.result_payload, ${qualifiedTable("query_runs")}.result_payload),
      data_payload = COALESCE(EXCLUDED.data_payload, ${qualifiedTable("query_runs")}.data_payload),
      datasets_payload = COALESCE(EXCLUDED.datasets_payload, ${qualifiedTable("query_runs")}.datasets_payload),
      dsl_payload = COALESCE(EXCLUDED.dsl_payload, ${qualifiedTable("query_runs")}.dsl_payload),
      dsl_text = COALESCE(EXCLUDED.dsl_text, ${qualifiedTable("query_runs")}.dsl_text),
      ir = COALESCE(EXCLUDED.ir, ${qualifiedTable("query_runs")}.ir),
      error = COALESCE(EXCLUDED.error, ${qualifiedTable("query_runs")}.error),
      updated_at = GREATEST(${qualifiedTable("query_runs")}.updated_at, EXCLUDED.updated_at)
  `);
  return result.rowCount ?? 0;
}

async function copyQueryRunsFromAnalysisSubQuestions(
  client: QueryableClient,
  stageColumns: Set<string>
): Promise<number> {
  if (!stageColumns.has("planned_dimensions")) return 0;

  const idExpr = nullableColumn(stageColumns, "s", "id", "NULL::bigint");
  const statusExpr = textColumn(stageColumns, "s", "status", "'completed'");
  const createdAtExpr = timestampColumn(stageColumns, "s", "created_at");

  const result = await client.query(`
    WITH source_rows AS (
      SELECT
        ${queryRunIdSql(
          "s.thread_id",
          "s.request_seq",
          "'analysis:' || COALESCE(q.item->>'abcRunId', q.item->>'id', d.idx::text || ':' || q.idx::text)"
        )} AS id,
        s.thread_id,
        s.request_seq,
        'analysis_sub_question' AS source_kind,
        COALESCE(q.item->>'abcRunId', q.item->>'id', d.idx::text || ':' || q.idx::text) AS source_ref,
        'analysis' AS source_stage,
        COALESCE(NULLIF(q.item->>'subQuestion', ''), NULLIF(q.item->>'question', '')) AS question,
        COALESCE(NULLIF(q.item->>'status', ''), ${statusExpr}) AS status,
        q.item AS result_payload,
        q.item->'data' AS data_payload,
        q.item->'datasets' AS datasets_payload,
        q.item->'dsl' AS dsl_payload,
        COALESCE(${integerJsonTextSql("q.item->>'dataCount'")}, ${datasetRowCountSql("q.item->'datasets'")}) AS data_count,
        q.item->'abcSubQuestions' AS abc_sub_questions,
        q.item->'abcDsls' AS abc_dsls,
        q.item->'abcCodes' AS abc_codes,
        q.item->'abcOutKeyRefs' AS abc_out_key_refs,
        q.item->'replayPlan' AS replay_plan,
        ${idExpr} AS legacy_stage_id,
        jsonb_build_object('plannedDimensionIndex', d.idx, 'subQuestionIndex', q.idx) AS legacy_payload,
        ${createdAtExpr} AS created_at,
        ${createdAtExpr} AS updated_at,
        d.idx AS planned_dimension_index,
        q.idx AS sub_question_index
      FROM ${qualifiedTable("stage_results")} s
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(s.planned_dimensions) = 'array' THEN s.planned_dimensions
          ELSE '[]'::jsonb
        END
      ) WITH ORDINALITY AS d(item, idx)
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(d.item->'subQuestions') = 'array' THEN d.item->'subQuestions'
          ELSE '[]'::jsonb
        END
      ) WITH ORDINALITY AS q(item, idx)
      WHERE s.stage = 'analysis'
        AND (
          q.item ? 'abcRunId'
          OR q.item ? 'data'
          OR q.item ? 'datasets'
          OR q.item ? 'dsl'
          OR q.item ? 'abcDsls'
          OR q.item ? 'replayPlan'
        )
    ),
    deduped_rows AS (
      SELECT DISTINCT ON (thread_id, request_seq, source_kind, source_ref)
        id, thread_id, request_seq, source_kind, source_ref, source_stage, question,
        status, result_payload, data_payload, datasets_payload, dsl_payload, data_count,
        abc_sub_questions, abc_dsls, abc_codes, abc_out_key_refs, replay_plan, legacy_stage_id, legacy_payload,
        created_at, updated_at
      FROM source_rows
      ORDER BY thread_id, request_seq, source_kind, source_ref, created_at DESC, planned_dimension_index DESC, sub_question_index DESC
    )
    INSERT INTO ${qualifiedTable("query_runs")}
      (id, thread_id, request_seq, source_kind, source_ref, source_stage, question,
       status, result_payload, data_payload, datasets_payload, dsl_payload, data_count,
       abc_sub_questions, abc_dsls, abc_codes, abc_out_key_refs, replay_plan, legacy_stage_id, legacy_payload,
       created_at, updated_at)
    SELECT
      id, thread_id, request_seq, source_kind, source_ref, source_stage, question,
      status, result_payload, data_payload, datasets_payload, dsl_payload, data_count,
      abc_sub_questions, abc_dsls, abc_codes, abc_out_key_refs, replay_plan, legacy_stage_id, legacy_payload,
      created_at, updated_at
    FROM deduped_rows
    ON CONFLICT (thread_id, request_seq, source_kind, source_ref)
    DO UPDATE SET
      status = EXCLUDED.status,
      result_payload = COALESCE(EXCLUDED.result_payload, ${qualifiedTable("query_runs")}.result_payload),
      data_payload = COALESCE(EXCLUDED.data_payload, ${qualifiedTable("query_runs")}.data_payload),
      datasets_payload = COALESCE(EXCLUDED.datasets_payload, ${qualifiedTable("query_runs")}.datasets_payload),
      dsl_payload = COALESCE(EXCLUDED.dsl_payload, ${qualifiedTable("query_runs")}.dsl_payload),
      data_count = COALESCE(EXCLUDED.data_count, ${qualifiedTable("query_runs")}.data_count),
      updated_at = GREATEST(${qualifiedTable("query_runs")}.updated_at, EXCLUDED.updated_at)
  `);
  return result.rowCount ?? 0;
}
