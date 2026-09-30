import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/** Existing and newly created agents mount the report deliverable by default; when explicitly turned off, the loop base delivers the final reply directly. */
export async function ensureReportDeliverableToggleSchema(client: QueryableClient): Promise<void> {
  await client.query(`
    ALTER TABLE ${qualifiedTable("analysis_agents")}
      ADD COLUMN IF NOT EXISTS report_deliverable_enabled BOOLEAN NOT NULL DEFAULT true
  `);
}
