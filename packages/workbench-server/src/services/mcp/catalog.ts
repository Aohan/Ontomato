import { workbenchProduct } from "../../product/installed";
import type {
  SystemMcpTool,
  SystemMcpService,
  SystemMcpToolsResponse,
  McpToolsResponse,
} from "@ontomato/contracts/mcp";
import type { McpToolDesc } from "@ontomato/contracts/mcp";
import { config } from "../../config/application";
import { getAnalysisAgentMcpUrlOverride, getSystemMcpUrl } from "../../config/mcp";
import { createLogger } from "../../logging/logger";
import { tApp } from "../../i18n";
import { listMcpTools } from "./client";

const logger = createLogger("api:mcp");
const ANALYSIS_AGENT_MCP_SUFFIX = "/mcp/analysis-agents";

export type McpRequestLocation = { protocol: string; headers: Record<string, unknown> };

function toolToClient(t: McpToolDesc): SystemMcpTool {
  return {
    name: t.name,
    title: t.title || t.name,
    description: t.description || "",
    inputSchema: t.inputSchema,
  };
}

function getAnalysisAgentMcpUrl(req: McpRequestLocation): string {
  const configured = getAnalysisAgentMcpUrlOverride();
  if (configured) return configured.replace(/\/$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http")
    .split(",")[0]
    .trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  const apiBase = config.apiBase || "/api";
  const mountBase = apiBase.endsWith("/api") ? apiBase.slice(0, -4) : "";
  const path = `${mountBase}${ANALYSIS_AGENT_MCP_SUFFIX}`.replace(/\/+/g, "/");
  return host ? `${proto}://${host}${path}` : path;
}

/** 对外 MCP 地址去掉末尾 `/mcp/analysis-agents`，得到与 `/api` 相同 mount 前缀的服务根。 */
export function analysisAgentPublicServiceRoot(req: McpRequestLocation): string {
  const mcpUrl = getAnalysisAgentMcpUrl(req);
  if (!mcpUrl.endsWith(ANALYSIS_AGENT_MCP_SUFFIX)) {
    throw new Error(`Analysis agent MCP URL must end with ${ANALYSIS_AGENT_MCP_SUFFIX}`);
  }
  return mcpUrl.slice(0, -ANALYSIS_AGENT_MCP_SUFFIX.length);
}

export function analysisReportPdfDownloadUrl(serviceRoot: string, taskId: string): string {
  return `${serviceRoot}/api/analysis-tasks/${encodeURIComponent(taskId)}/report.pdf`;
}

export async function buildMcpSystemToolsResponse(
  req: McpRequestLocation,
  analysisAgentMcpTools: McpToolDesc[]
): Promise<SystemMcpToolsResponse> {
  const mcpServerUrl = getSystemMcpUrl();
  const analysisMcpUrl = getAnalysisAgentMcpUrl(req);
  const product = workbenchProduct();
  const services: SystemMcpService[] = [
    {
      name: product.analysisMcpServerName,
      title: `${product.serviceDisplayName} Agents MCP`,
      mcpUrl: analysisMcpUrl,
      tools: analysisAgentMcpTools.map(toolToClient),
    },
  ];
  let tools: Awaited<ReturnType<typeof listMcpTools>> = [];
  if (mcpServerUrl) {
    try {
      tools = await listMcpTools(mcpServerUrl);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(tApp("foundation.log.mcp.catalogFallback"), {
        mcpServerUrl,
        error: errorMessage,
      });
    }
    services.unshift({
      name: product.systemMcpCatalogName,
      title: `${product.serviceDisplayName} MCP`,
      mcpUrl: mcpServerUrl,
      tools: tools.map(toolToClient),
    });
  }
  return {
    success: true,
    mcpUrl: mcpServerUrl,
    tools: tools.map(toolToClient),
    services,
  };
}

export async function buildMcpToolsResponse(
  analysisAgentMcpTools: McpToolDesc[]
): Promise<McpToolsResponse> {
  try {
    const mcpServerUrl = getSystemMcpUrl();
    const tools = mcpServerUrl ? await listMcpTools(mcpServerUrl) : [];
    return {
      tools: [...tools, ...analysisAgentMcpTools].map((t) => ({
        name: t.name,
        title: t.title || t.name,
        description: t.description || "",
      })),
    };
  } catch {
    return {
      tools: analysisAgentMcpTools.map((t) => ({
        name: t.name,
        title: t.title || t.name,
        description: t.description || "",
      })),
    };
  }
}
