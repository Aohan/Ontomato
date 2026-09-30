import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/**
 * Schedule rule table: the rules' own runtime structure after being split out of analysis_tasks.
 * Like the other tables it uses idempotent DDL: an empty database gets everything in one pass, existing databases converge by missing columns.
 */
export async function ensureScheduleRuleSchema(client: QueryableClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("analysis_schedule_rules")} (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      domain_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      question TEXT,
      schedule_expression TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      notify_email TEXT,
      notify_on_complete BOOLEAN NOT NULL DEFAULT false,
      token TEXT,
      last_error TEXT,
      last_run_at BIGINT,
      next_run_at BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_schedule_rules_due
      ON ${qualifiedTable("analysis_schedule_rules")} (enabled, next_run_at)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_schedule_rules_agent
      ON ${qualifiedTable("analysis_schedule_rules")} (agent_id, created_at DESC)
  `);
}
