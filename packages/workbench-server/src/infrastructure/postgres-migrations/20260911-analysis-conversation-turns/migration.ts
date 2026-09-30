import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

export const ANALYSIS_CONVERSATION_TURNS_VERSION = "20260911_analysis_conversation_turns_v1";
export const ANALYSIS_CONVERSATION_TURNS_NAME = "durable analysis conversation turns v1";

/** Shared migration identity for 3.1.4 and the architecture release. */
export async function migrateAnalysisConversationTurns(client: QueryableClient): Promise<void> {
  await client.query(`
    ALTER TABLE ${qualifiedTable("analysis_agents")}
      ADD COLUMN IF NOT EXISTS report_deliverable_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS enabled_mcp_service_names TEXT[] NOT NULL DEFAULT '{}';
    ALTER TABLE ${qualifiedTable("analysis_tasks")}
      ADD COLUMN IF NOT EXISTS report_deliverable_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    UPDATE ${qualifiedTable("analysis_tasks")} task
      SET report_deliverable_enabled = agent.report_deliverable_enabled
      FROM ${qualifiedTable("analysis_agents")} agent WHERE task.agent_id = agent.id;
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("analysis_task_turns")} (
      task_id TEXT NOT NULL REFERENCES ${qualifiedTable("analysis_tasks")}(id) ON DELETE CASCADE,
      request_seq INTEGER NOT NULL,
      user_message TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running','completed','failed','cancelled')),
      messages JSONB NOT NULL DEFAULT '[]',
      activities JSONB NOT NULL DEFAULT '[]',
      subagent_audits JSONB NOT NULL DEFAULT '[]',
      evidence_refs JSONB NOT NULL DEFAULT '[]',
      summary_charts JSONB NOT NULL DEFAULT '[]',
      chart_diagnostics JSONB NOT NULL DEFAULT '[]',
      final_answer TEXT,
      error TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (task_id, request_seq)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_task_turns_running
      ON ${qualifiedTable("analysis_task_turns")} (task_id) WHERE status = 'running';
  `);
}
