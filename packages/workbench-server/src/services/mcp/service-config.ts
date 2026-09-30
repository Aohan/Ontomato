import { z } from "zod";
import { getPostgresPool, qualifiedTable } from "../../infrastructure/postgres";

export const McpServiceConfigSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z
    .string()
    .trim()
    .url()
    .refine((value) => /^https?:\/\//i.test(value)),
  headers: z
    .record(z.string())
    .default({})
    .superRefine((value, ctx) => {
      try {
        new Headers(value);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid HTTP headers" });
      }
    }),
});

export type McpServiceConfig = z.infer<typeof McpServiceConfigSchema>;

export async function listMcpServiceConfigs(domainId: string): Promise<McpServiceConfig[]> {
  if (!domainId) throw new Error("MCP configuration requires a domain");
  const result = await getPostgresPool().query(
    `SELECT name, url, headers FROM ${qualifiedTable("mcp_service_configs")}
     WHERE domain_id = $1 ORDER BY name`,
    [domainId]
  );
  return result.rows.map((row) => McpServiceConfigSchema.parse(row));
}

export async function saveMcpServiceConfig(
  domainId: string,
  config: McpServiceConfig,
  previousName?: string
): Promise<boolean> {
  if (!domainId) throw new Error("MCP configuration requires a domain");
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const values = [domainId, config.name, config.url, JSON.stringify(config.headers)];
    if (previousName === undefined) {
      await client.query(
        `INSERT INTO ${qualifiedTable("mcp_service_configs")} (domain_id, name, url, headers)
         VALUES ($1, $2, $3, $4::jsonb)`,
        values
      );
    } else {
      const updated = await client.query(
        `UPDATE ${qualifiedTable("mcp_service_configs")} SET name = $2, url = $3, headers = $4::jsonb
         WHERE domain_id = $1 AND name = $5 RETURNING name`,
        [...values, previousName]
      );
      if (!updated.rowCount) {
        await client.query("ROLLBACK");
        return false;
      }
      if (previousName !== config.name) {
        await client.query(
          `UPDATE ${qualifiedTable("analysis_agents")}
           SET enabled_mcp_service_names = array_replace(enabled_mcp_service_names, $2, $3)
           WHERE domain_id = $1 AND $2 = ANY(enabled_mcp_service_names)`,
          [domainId, previousName, config.name]
        );
      }
    }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteMcpServiceConfig(domainId: string, name: string): Promise<boolean> {
  if (!domainId) throw new Error("MCP configuration requires a domain");
  const result = await getPostgresPool().query(
    `DELETE FROM ${qualifiedTable("mcp_service_configs")} WHERE domain_id = $1 AND name = $2`,
    [domainId, name]
  );
  return Boolean(result.rowCount);
}
