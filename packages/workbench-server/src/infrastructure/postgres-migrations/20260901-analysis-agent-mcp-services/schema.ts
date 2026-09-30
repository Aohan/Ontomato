import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/** Neither existing rows nor default creation authorize external services; explicit selection saves the services' name snapshot. */
export async function ensureAnalysisAgentMcpServicesSchema(client: QueryableClient): Promise<void> {
  await client.query(`
    ALTER TABLE ${qualifiedTable("analysis_agents")}
      ADD COLUMN IF NOT EXISTS enabled_mcp_service_names TEXT[] NOT NULL DEFAULT '{}'
  `);
}
