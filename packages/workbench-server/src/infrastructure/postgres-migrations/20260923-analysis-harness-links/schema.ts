import { qualifiedTable } from "../../postgres";
import type { QueryableClient } from "../helpers";

/** Business references only; raw conversation messages remain in Harness. No historical backfill. */
export async function ensureAnalysisHarnessLinks(client: QueryableClient): Promise<void> {
  await client.query(`ALTER TABLE ${qualifiedTable("analysis_tasks")} ADD COLUMN IF NOT EXISTS harness_session_id TEXT;
    ALTER TABLE ${qualifiedTable("analysis_task_turns")} ADD COLUMN IF NOT EXISTS harness_turn_id TEXT;`);
}
