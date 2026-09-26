import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/** 存量与缺省创建均不授权外部服务；显式勾选保存服务 name 快照。 */
export async function ensureAnalysisAgentMcpServicesSchema(client: QueryableClient): Promise<void> {
  await client.query(`
    ALTER TABLE ${qualifiedTable("analysis_agents")}
      ADD COLUMN IF NOT EXISTS enabled_mcp_service_names TEXT[] NOT NULL DEFAULT '{}'
  `);
}
