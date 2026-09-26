import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/** 存量与新建智能体默认挂载报告交付件；显式关闭时由循环底座直接交付最终回复。 */
export async function ensureReportDeliverableToggleSchema(client: QueryableClient): Promise<void> {
  await client.query(`
    ALTER TABLE ${qualifiedTable("analysis_agents")}
      ADD COLUMN IF NOT EXISTS report_deliverable_enabled BOOLEAN NOT NULL DEFAULT true
  `);
}
