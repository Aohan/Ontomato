import { qualifiedTable } from "../../postgres";
import type { QueryableClient } from "../helpers";

/** Schema only. Legacy payload and status columns remain available to external upgrade tooling. */
export async function ensureGovernanceHarnessLinks(client: QueryableClient): Promise<void> {
  await client.query(`ALTER TABLE ${qualifiedTable("knowledge_governance_sessions")}
    ADD COLUMN IF NOT EXISTS harness_session_id TEXT REFERENCES ${qualifiedTable("harness_sessions")}(id);
    ALTER TABLE ${qualifiedTable("knowledge_governance_sessions")} ALTER COLUMN status DROP NOT NULL;`);
}
