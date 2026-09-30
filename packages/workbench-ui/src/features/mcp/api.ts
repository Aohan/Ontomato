import { z } from "zod";
import { nodeApiGet, nodeApiPost, nodeApiPut, nodeApiDelete } from "../../utils/api";

const serviceSchema = z.object({
  name: z.string(),
  url: z.string(),
  headers: z.record(z.string()),
});
const toolSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: z.record(z.unknown()).optional(),
});
const publishedServiceSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  mcpUrl: z.string(),
  tools: z.array(toolSchema),
});
export type McpServiceConfig = z.infer<typeof serviceSchema>;
export type McpTool = z.infer<typeof toolSchema>;
export type PublishedMcpService = z.infer<typeof publishedServiceSchema>;

const base = "/mcp/services";
export async function listMcpServiceNames(): Promise<string[]> {
  return z.object({ names: z.array(z.string()) }).parse(await nodeApiGet(`${base}/names`)).names;
}
export async function listMcpServices(): Promise<McpServiceConfig[]> {
  return z.object({ services: z.array(serviceSchema) }).parse(await nodeApiGet(base)).services;
}
export async function saveMcpService(
  config: McpServiceConfig,
  previousName?: string
): Promise<void> {
  const result =
    previousName === undefined
      ? await nodeApiPost(base, config)
      : await nodeApiPut(`${base}/${encodeURIComponent(previousName)}`, config);
  z.object({ success: z.literal(true) }).parse(result);
}
export async function deleteMcpService(name: string): Promise<void> {
  z.object({ success: z.literal(true) }).parse(
    await nodeApiDelete(`${base}/${encodeURIComponent(name)}`)
  );
}
export async function listExternalMcpTools(name: string): Promise<McpTool[]> {
  return z
    .object({ tools: z.array(toolSchema) })
    .parse(await nodeApiGet(`${base}/${encodeURIComponent(name)}/tools`)).tools;
}
export async function listPublishedMcpServices(): Promise<PublishedMcpService[]> {
  return z
    .object({ services: z.array(publishedServiceSchema) })
    .parse(await nodeApiGet("/mcp/system/tools")).services;
}
