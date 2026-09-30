import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/** Per-agent hot report switch: when off, the analysis pipeline skips hot report matching and always re-analyzes with the current configuration. */
export async function ensureAnalysisAgentHotReportSchema(client: QueryableClient): Promise<void> {
  await client.query(`
    ALTER TABLE ${qualifiedTable("analysis_agents")}
      ADD COLUMN IF NOT EXISTS hot_report_enabled BOOLEAN NOT NULL DEFAULT true
  `);
}
