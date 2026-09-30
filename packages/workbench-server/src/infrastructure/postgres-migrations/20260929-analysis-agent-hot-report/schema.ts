import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/** 分析智能体级的热报告开关：关闭后分析链路跳过热报告匹配，始终按当前配置重新分析。 */
export async function ensureAnalysisAgentHotReportSchema(client: QueryableClient): Promise<void> {
  await client.query(`
    ALTER TABLE ${qualifiedTable("analysis_agents")}
      ADD COLUMN IF NOT EXISTS hot_report_enabled BOOLEAN NOT NULL DEFAULT true
  `);
}
