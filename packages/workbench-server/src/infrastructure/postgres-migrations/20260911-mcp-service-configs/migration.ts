import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

export const MCP_SERVICE_CONFIGS_VERSION = "20260911_mcp_service_configs_v1";
export const MCP_SERVICE_CONFIGS_NAME = "domain MCP service configurations v1";

export async function migrateMcpServiceConfigs(client: QueryableClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("mcp_service_configs")} (
      domain_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      headers JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (domain_id, name)
    )
  `);
}
