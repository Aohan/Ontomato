import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/**
 * 定时规则表：规则从 analysis_tasks 拆出后自己的运行时结构。
 * 与其他表一致采用幂等 DDL：空库一次到位，存量库按缺列收敛。
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
