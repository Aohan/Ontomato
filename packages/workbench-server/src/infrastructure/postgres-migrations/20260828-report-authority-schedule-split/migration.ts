import { qualifiedTable } from "../../postgres.js";
import { getTableColumns, type QueryableClient } from "../helpers.js";

/**
 * Single authority for report results + schedule rule split.
 *
 * 1. Existing schedule rows move wholesale into the rule table; rows that never carried a report are deleted from the task table right away.
 *    Dirty rows that are both a rule and once carried report results move only their rule fields, keeping the task row as one report run.
 * 2. Task rows missing payload but holding result_report get a minimal backfill, so old task reviews never lose the body.
 * 3. Retires the report copy columns, schedule columns, and task snapshot table on the task table.
 */

export const REPORT_AUTHORITY_SPLIT_VERSION = "20260828_report_authority_schedule_split_v1";
export const REPORT_AUTHORITY_SPLIT_NAME = "report payload authority and schedule rule split v1";

const NOW_MS_SQL = "(EXTRACT(EPOCH FROM NOW()) * 1000)::bigint";

export interface ReportAuthoritySplitResult {
  movedRules: number;
  removedRuleRows: number;
  keptDirtyRuleRows: number;
  backfilledPayloads: number;
}

export async function migrateReportAuthorityScheduleSplit(
  client: QueryableClient
): Promise<ReportAuthoritySplitResult> {
  const taskColumns = await getTableColumns(client, "analysis_tasks");
  const hasSchedule = taskColumns.has("schedule_enabled");
  const hasReport = taskColumns.has("result_report");

  const movedRules = hasSchedule ? await moveScheduleRules(client, taskColumns) : 0;
  const keptDirtyRuleRows = hasSchedule ? await countDirtyRuleRows(client, hasReport) : 0;
  const removedRuleRows = hasSchedule ? await removeMovedRuleRows(client, hasReport) : 0;
  const backfilledPayloads = hasReport ? await backfillPayloadsFromReport(client) : 0;

  await retireLegacyArtifacts(client);

  return { movedRules, removedRuleRows, keptDirtyRuleRows, backfilledPayloads };
}

async function moveScheduleRules(
  client: QueryableClient,
  taskColumns: Set<string>
): Promise<number> {
  const expressionExpr = taskColumns.has("schedule_expression") ? "schedule_expression" : "NULL";
  const nextRunExpr = taskColumns.has("next_run_at") ? "next_run_at" : "NULL::bigint";
  const result = await client.query(`
    INSERT INTO ${qualifiedTable("analysis_schedule_rules")}
      (id, agent_id, user_id, name, description, question, schedule_expression, enabled,
       notify_email, notify_on_complete, token, last_run_at, next_run_at, created_at, updated_at)
    SELECT
      id, agent_id, user_id, name, COALESCE(description, ''), COALESCE(question, name),
      COALESCE(${expressionExpr}, ''), true,
      notify_email, COALESCE(notify_on_complete, false), token,
      last_run_at, ${nextRunExpr}, created_at, updated_at
    FROM ${qualifiedTable("analysis_tasks")}
    WHERE schedule_enabled = true
    ON CONFLICT (id) DO NOTHING
  `);
  return result.rowCount ?? 0;
}

/** Report traces: the presence of either payload or result_report means report results were once carried. */
function reportTraceSql(hasReport: boolean): string {
  return hasReport
    ? "(analysis_payload IS NOT NULL OR NULLIF(result_report, '') IS NOT NULL)"
    : "analysis_payload IS NOT NULL";
}

async function countDirtyRuleRows(client: QueryableClient, hasReport: boolean): Promise<number> {
  const result = await client.query(`
    SELECT COUNT(*)::int AS total
    FROM ${qualifiedTable("analysis_tasks")}
    WHERE schedule_enabled = true AND ${reportTraceSql(hasReport)}
  `);
  return Number(result.rows[0]?.total || 0);
}

async function removeMovedRuleRows(client: QueryableClient, hasReport: boolean): Promise<number> {
  const result = await client.query(`
    DELETE FROM ${qualifiedTable("analysis_tasks")}
    WHERE schedule_enabled = true AND NOT ${reportTraceSql(hasReport)}
  `);
  return result.rowCount ?? 0;
}

async function backfillPayloadsFromReport(client: QueryableClient): Promise<number> {
  const result = await client.query(`
    UPDATE ${qualifiedTable("analysis_tasks")}
    SET analysis_payload = jsonb_build_object(
          'report', result_report
        ),
        updated_at = GREATEST(COALESCE(updated_at, 0), ${NOW_MS_SQL})
    WHERE analysis_payload IS NULL
      AND NULLIF(result_report, '') IS NOT NULL
  `);
  return result.rowCount ?? 0;
}

async function retireLegacyArtifacts(client: QueryableClient): Promise<void> {
  for (const column of [
    "result_report",
    "schedule_enabled",
    "schedule_expression",
    "next_run_at",
  ]) {
    await client.query(
      `ALTER TABLE ${qualifiedTable("analysis_tasks")} DROP COLUMN IF EXISTS ${column}`
    );
  }
  await client.query(`DROP TABLE IF EXISTS ${qualifiedTable("analysis_task_snapshots")}`);
}
