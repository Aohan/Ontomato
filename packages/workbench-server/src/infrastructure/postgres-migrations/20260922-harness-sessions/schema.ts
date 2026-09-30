import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/** Harness session facts and the business links that point at them. No data backfill. */
export async function ensureHarnessSessionsSchema(client: QueryableClient): Promise<void> {
  const sessions = qualifiedTable("harness_sessions");
  const turns = qualifiedTable("harness_turns");
  const messages = qualifiedTable("harness_messages");
  const compactions = qualifiedTable("harness_compactions");
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${sessions} (
      id TEXT PRIMARY KEY,
      parent_session_id TEXT REFERENCES ${sessions}(id) ON DELETE CASCADE,
      parent_tool_call_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('idle', 'running')),
      active_turn_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS ${turns} (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES ${sessions}(id) ON DELETE CASCADE,
      turn_index INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'cancelled', 'failed', 'interrupted')),
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      UNIQUE (session_id, turn_index),
      UNIQUE (id, session_id)
    );
    CREATE TABLE IF NOT EXISTS ${messages} (
      session_id TEXT NOT NULL REFERENCES ${sessions}(id) ON DELETE CASCADE,
      turn_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      message JSONB NOT NULL,
      PRIMARY KEY (session_id, seq),
      FOREIGN KEY (turn_id, session_id) REFERENCES ${turns}(id, session_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS ${compactions} (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES ${sessions}(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      covered_through_seq INTEGER NOT NULL,
      FOREIGN KEY (session_id, covered_through_seq) REFERENCES ${messages}(session_id, seq) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("diagnosis_sessions")} (
      id TEXT PRIMARY KEY REFERENCES ${sessions}(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      context JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}
