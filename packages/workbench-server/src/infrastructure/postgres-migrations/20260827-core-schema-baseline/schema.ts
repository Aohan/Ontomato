import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/**
 * Core business table baseline: carries over the inline table creation and column backfill history of initializePostgres.
 * Like business-storage-v1 it uses idempotent DDL: an empty database gets everything in one pass, existing databases converge by missing columns.
 * The report copy columns and schedule columns retired with the 20260828 migration are no longer backfilled by this baseline.
 */
export async function ensureCoreSchemaBaseline(client: QueryableClient): Promise<void> {
  await ensureThreadMetadata(client);
  await ensureAnalysisAgents(client);
  await ensureAnalysisDimensions(client);
  await ensureAnalysisReportHotCards(client);
  await ensureDashboards(client);
  await ensureAnalysisTasks(client);
  await ensureAnalysisTaskEvents(client);
  await ensureFeedbackRecords(client);
  await ensureKvStore(client);
}

async function addColumns(
  client: QueryableClient,
  table: string,
  columns: string[]
): Promise<void> {
  for (const column of columns) {
    await client.query(`ALTER TABLE ${qualifiedTable(table)} ADD COLUMN IF NOT EXISTS ${column}`);
  }
}

async function ensureThreadMetadata(client: QueryableClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("thread_metadata")} (
      thread_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      domain_id TEXT NOT NULL,
      title TEXT,
      title_locked BOOLEAN NOT NULL DEFAULT false,
      thread_type TEXT DEFAULT 'qa',
      last_request_seq INTEGER NOT NULL DEFAULT -1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )
  `);
  await addColumns(client, "thread_metadata", [
    "title_locked BOOLEAN NOT NULL DEFAULT false",
    "thread_type TEXT DEFAULT 'qa'",
    "last_request_seq INTEGER NOT NULL DEFAULT -1",
  ]);
}

async function ensureAnalysisAgents(client: QueryableClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("analysis_agents")} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      execution_mode TEXT NOT NULL DEFAULT 'dimension',
      loop_prompt TEXT,
      analysis_dimension_prompt TEXT,
      summarizer_prompt TEXT,
      conclusion_maker_prompt TEXT,
      enabled_skill_ids TEXT[] DEFAULT '{}',
      enabled_visualization_skill_ids TEXT[] DEFAULT '{}',
      class_names TEXT[] DEFAULT '{}',
      is_enabled BOOLEAN DEFAULT true,
      sort_order INTEGER DEFAULT 0,
      domain_id TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await addColumns(client, "analysis_agents", [
    "domain_id TEXT",
    "sort_order INTEGER DEFAULT 0",
    "class_names TEXT[] DEFAULT '{}'",
    // Existing agents keep dimension orchestration
    "execution_mode TEXT NOT NULL DEFAULT 'dimension'",
    "loop_prompt TEXT",
  ]);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_agents_enabled
      ON ${qualifiedTable("analysis_agents")} (is_enabled)
  `);
}

async function ensureAnalysisDimensions(client: QueryableClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("analysis_dimensions")} (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      dimension_type TEXT,
      values JSONB,
      value_source TEXT,
      dataset_field TEXT,
      sub_question_template TEXT,
      "order" INTEGER DEFAULT 0,
      is_enabled BOOLEAN DEFAULT true,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_dims_agent
      ON ${qualifiedTable("analysis_dimensions")} (agent_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_dims_agent_enabled
      ON ${qualifiedTable("analysis_dimensions")} (agent_id, is_enabled)
  `);
}

async function ensureAnalysisReportHotCards(client: QueryableClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("analysis_report_hot_cards")} (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      dimensions JSONB NOT NULL,
      report_content TEXT,
      status TEXT DEFAULT 'PENDING_REVIEW',
      business_description TEXT,
      agent_id TEXT,
      session_id TEXT,
      domain_id TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await addColumns(client, "analysis_report_hot_cards", ["domain_id TEXT"]);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_hotcards_status
      ON ${qualifiedTable("analysis_report_hot_cards")} (status)
  `);
}

async function ensureDashboards(client: QueryableClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("dashboards")} (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      domain_id TEXT NOT NULL,
      name TEXT NOT NULL,
      source JSONB,
      groups JSONB,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_dashboards_owner
      ON ${qualifiedTable("dashboards")} (owner_id, domain_id, updated_at DESC)
  `);
}

async function ensureAnalysisTasks(client: QueryableClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("analysis_tasks")} (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      domain_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      thread_id TEXT,
      question TEXT,
      notify_email TEXT,
      notify_on_complete BOOLEAN DEFAULT false,
      result_summary TEXT,
      analysis_payload JSONB,
      trigger_source TEXT DEFAULT 'manual',
      token TEXT DEFAULT '',
      last_run_at BIGINT,
      run_history JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await addColumns(client, "analysis_tasks", [
    "name TEXT",
    "agent_id TEXT",
    "user_id TEXT",
    "status TEXT NOT NULL DEFAULT 'pending'",
    "description TEXT DEFAULT ''",
    "thread_id TEXT",
    "question TEXT",
    "notify_email TEXT",
    "notify_on_complete BOOLEAN DEFAULT false",
    "result_summary TEXT",
    "analysis_payload JSONB",
    "trigger_source TEXT DEFAULT 'manual'",
    "last_run_at BIGINT",
    "token TEXT DEFAULT ''",
    "run_history JSONB NOT NULL DEFAULT '[]'::jsonb",
    "created_at BIGINT",
    "updated_at BIGINT",
  ]);
  await client.query(`
    ALTER TABLE ${qualifiedTable("analysis_tasks")} ALTER COLUMN trigger_source SET DEFAULT 'manual'
  `);
  // Indexes are created after column backfill (old tables may lack agent_id/user_id/status)
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_tasks_agent
      ON ${qualifiedTable("analysis_tasks")} (agent_id, created_at DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_tasks_user
      ON ${qualifiedTable("analysis_tasks")} (user_id, created_at DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_tasks_status
      ON ${qualifiedTable("analysis_tasks")} (status)
  `);
}

async function ensureAnalysisTaskEvents(client: QueryableClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("analysis_task_events")} (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      event_seq INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      event_name TEXT NOT NULL,
      status TEXT,
      phase TEXT,
      source_kind TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      payload JSONB,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE (task_id, source_kind, source_ref)
    )
  `);
  // Structured fact columns carry the loop analysis trajectory
  await addColumns(client, "analysis_task_events", ["payload JSONB"]);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_analysis_task_events_task
      ON ${qualifiedTable("analysis_task_events")} (task_id, event_seq)
  `);
}

async function ensureFeedbackRecords(client: QueryableClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("feedback_records")} (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      thread_id TEXT,
      request_seq INTEGER,
      task_id TEXT,
      rating TEXT NOT NULL,
      user_id TEXT NOT NULL,
      domain_id TEXT,
      user_name TEXT,
      user_input TEXT,
      assistant_output TEXT,
      feedback_text TEXT,
      metadata JSONB,
      created_at BIGINT NOT NULL
    )
  `);
  await addColumns(client, "feedback_records", ["user_name TEXT", "domain_id TEXT"]);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_feedback_created_at
      ON ${qualifiedTable("feedback_records")} (created_at DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_feedback_source_rating
      ON ${qualifiedTable("feedback_records")} (source_type, rating, created_at DESC)
  `);
  // Before the unique index lands, deduplicate deterministically by the target keys, keeping each target's latest feedback.
  await client.query(`
    WITH ranked AS (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY source_type,
            COALESCE(
              NULLIF(metadata->>'turnKey', ''),
              CASE
                WHEN thread_id IS NOT NULL AND request_seq IS NOT NULL
                THEN 'turn.' || thread_id || '.' || request_seq::text
              END,
              NULLIF(task_id, ''),
              target_id
            )
          ORDER BY created_at DESC, id DESC
        ) AS rn
      FROM ${qualifiedTable("feedback_records")}
    )
    DELETE FROM ${qualifiedTable("feedback_records")} f
    USING ranked r
    WHERE f.id = r.id AND r.rn > 1
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_unique_target
      ON ${qualifiedTable("feedback_records")} (
        source_type,
        COALESCE(
          NULLIF(metadata->>'turnKey', ''),
          CASE
            WHEN thread_id IS NOT NULL AND request_seq IS NOT NULL
            THEN 'turn.' || thread_id || '.' || request_seq::text
          END,
          NULLIF(task_id, ''),
          target_id
        )
      )
  `);
}

async function ensureKvStore(client: QueryableClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("kv_store")} (
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (namespace, key)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_kv_namespace
      ON ${qualifiedTable("kv_store")} (namespace)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_kv_updated
      ON ${qualifiedTable("kv_store")} (updated_at DESC)
  `);
}
