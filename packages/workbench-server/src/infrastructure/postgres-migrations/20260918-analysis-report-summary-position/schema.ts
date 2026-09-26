import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/** 控制报告综合总结的展示位置；历史智能体默认保持原有的末尾展示。 */
export async function ensureAnalysisReportSummaryPositionSchema(
  client: QueryableClient
): Promise<void> {
  await client.query(`
    ALTER TABLE ${qualifiedTable("analysis_agents")}
      ADD COLUMN IF NOT EXISTS summary_position TEXT NOT NULL DEFAULT 'bottom'
  `);
}
