import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/** Controls the display position of the report's comprehensive summary; historical agents keep the original end-of-report display. */
export async function ensureAnalysisReportSummaryPositionSchema(
  client: QueryableClient
): Promise<void> {
  await client.query(`
    ALTER TABLE ${qualifiedTable("analysis_agents")}
      ADD COLUMN IF NOT EXISTS summary_position TEXT NOT NULL DEFAULT 'bottom'
  `);
}
