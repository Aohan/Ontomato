import { qualifiedTable } from "../../postgres";
import type { QueryableClient } from "../helpers";

export async function ensureKnowledgeGovernanceSchema(client: QueryableClient): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS ${qualifiedTable("knowledge_governance_sessions")} (
    id UUID PRIMARY KEY,
    domain_id TEXT NOT NULL,
    initiator_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revision INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'stopped', 'failed')),
    run_id UUID,
    payload JSONB NOT NULL
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS knowledge_governance_owner_idx
    ON ${qualifiedTable("knowledge_governance_sessions")} (domain_id, initiator_id, updated_at DESC)`);
}
