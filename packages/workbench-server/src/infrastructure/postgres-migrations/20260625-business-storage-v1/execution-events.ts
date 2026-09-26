import { qualifiedTable } from "../../postgres.js";
import {
  getTableColumns,
  hasRequiredColumns,
  nullableColumn,
  numericColumn,
  textColumn,
  timestampColumn,
  type QueryableClient,
} from "../helpers.js";

export async function copyLegacyExecutionEvents(client: QueryableClient): Promise<number> {
  const chainColumns = await getTableColumns(client, "execution_chains");
  if (!hasRequiredColumns(chainColumns, ["thread_id", "request_seq"])) return 0;

  const idExpr = nullableColumn(chainColumns, "e", "id", "NULL::bigint");
  const chainTypeExpr = textColumn(chainColumns, "e", "chain_type", "'execution'");
  const chainNameExpr = textColumn(chainColumns, "e", "chain_name", "'execution'");
  const chainIconExpr = nullableColumn(chainColumns, "e", "chain_icon", "NULL::text");
  const statusExpr = nullableColumn(chainColumns, "e", "status", "NULL::text");
  const startTimeExpr = numericColumn(chainColumns, "e", "start_time", "NULL::bigint");
  const endTimeExpr = numericColumn(chainColumns, "e", "end_time", "NULL::bigint");
  const durationExpr = numericColumn(chainColumns, "e", "duration", "NULL::bigint");
  const errorExpr = nullableColumn(chainColumns, "e", "error", "NULL::text");
  const createdAtExpr = timestampColumn(chainColumns, "e", "created_at");
  const sourceRefExpr = `COALESCE(${idExpr}::text, md5(e.thread_id || ':' || e.request_seq::text || ':' || ${chainNameExpr} || ':' || ${createdAtExpr}::text))`;

  const result = await client.query(`
    WITH legacy_events AS (
      SELECT
        e.*,
        ROW_NUMBER() OVER (
          PARTITION BY e.thread_id, e.request_seq
          ORDER BY ${createdAtExpr}, ${sourceRefExpr}
        )::integer AS event_seq
      FROM ${qualifiedTable("execution_chains")} e
    )
    INSERT INTO ${qualifiedTable("execution_events")}
      (id, thread_id, request_seq, event_seq, event_type, event_name, event_icon,
       status, started_at, ended_at, duration_ms, error, source_kind, source_ref,
       legacy_chain_id, created_at, updated_at)
    SELECT
      'event:' || md5(e.thread_id || ':' || e.request_seq::text || ':' || ${sourceRefExpr}),
      e.thread_id,
      e.request_seq,
      e.event_seq,
      ${chainTypeExpr},
      ${chainNameExpr},
      ${chainIconExpr},
      ${statusExpr},
      ${startTimeExpr},
      ${endTimeExpr},
      ${durationExpr},
      ${errorExpr},
      'legacy_execution_chain',
      ${sourceRefExpr},
      ${idExpr},
      ${createdAtExpr},
      ${createdAtExpr}
    FROM legacy_events e
    ON CONFLICT (thread_id, request_seq, source_kind, source_ref)
    DO UPDATE SET
      event_seq = EXCLUDED.event_seq,
      event_type = EXCLUDED.event_type,
      event_name = EXCLUDED.event_name,
      event_icon = EXCLUDED.event_icon,
      status = EXCLUDED.status,
      started_at = EXCLUDED.started_at,
      ended_at = EXCLUDED.ended_at,
      duration_ms = EXCLUDED.duration_ms,
      error = EXCLUDED.error,
      updated_at = GREATEST(${qualifiedTable("execution_events")}.updated_at, EXCLUDED.updated_at)
  `);
  return result.rowCount ?? 0;
}
