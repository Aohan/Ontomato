import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

export async function ensureBusinessStorageV1Schema(client: QueryableClient): Promise<void> {
  await client.query(`
    ALTER TABLE ${qualifiedTable("thread_metadata")}
    ADD COLUMN IF NOT EXISTS title_locked BOOLEAN NOT NULL DEFAULT false
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("turn_runs")} (
      thread_id TEXT NOT NULL,
      request_seq INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      source TEXT,
      display_message TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (thread_id, request_seq)
    )
  `);
  await client.query(`
    ALTER TABLE ${qualifiedTable("turn_runs")}
    ADD COLUMN IF NOT EXISTS display_message TEXT
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_turn_runs_updated
      ON ${qualifiedTable("turn_runs")} (updated_at DESC)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("query_runs")} (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      request_seq INTEGER NOT NULL,
      source_kind TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      source_stage TEXT,
      question TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      error TEXT,
      result_payload JSONB,
      data_payload JSONB,
      datasets_payload JSONB,
      dsl_payload JSONB,
      dsl_text TEXT,
      ir TEXT,
      full_content TEXT,
      thinking_summary TEXT,
      thinking_steps JSONB,
      thinking_state JSONB,
      qc_result JSONB,
      qc_state JSONB,
      object_classes TEXT[],
      data_count INTEGER,
      abc_sub_questions JSONB,
      abc_dsls JSONB,
      abc_codes JSONB,
      abc_out_key_refs JSONB,
      replay_plan JSONB,
      legacy_stage_id BIGINT,
      legacy_payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (thread_id, request_seq, source_kind, source_ref)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_query_runs_thread_req
      ON ${qualifiedTable("query_runs")} (thread_id, request_seq)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_query_runs_source
      ON ${qualifiedTable("query_runs")} (source_kind, source_ref)
  `);
  await client.query(`
    ALTER TABLE ${qualifiedTable("query_runs")}
    ADD COLUMN IF NOT EXISTS abc_out_key_refs JSONB
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("chat_render_snapshots")} (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      request_seq INTEGER NOT NULL,
      snapshot JSONB NOT NULL,
      snapshot_mode TEXT,
      snapshot_status TEXT,
      source TEXT NOT NULL DEFAULT 'legacy_migration',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (thread_id, request_seq)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_chat_render_snapshots_thread
      ON ${qualifiedTable("chat_render_snapshots")} (thread_id, request_seq)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_chat_render_snapshots_updated
      ON ${qualifiedTable("chat_render_snapshots")} (updated_at DESC)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("execution_events")} (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      request_seq INTEGER NOT NULL,
      event_seq INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      event_name TEXT NOT NULL,
      event_icon TEXT,
      status TEXT,
      started_at BIGINT,
      ended_at BIGINT,
      duration_ms BIGINT,
      error TEXT,
      source_kind TEXT NOT NULL DEFAULT 'legacy_execution_chain',
      source_ref TEXT NOT NULL,
      legacy_chain_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (thread_id, request_seq, source_kind, source_ref)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_execution_events_thread_req
      ON ${qualifiedTable("execution_events")} (thread_id, request_seq, event_seq)
  `);
}
