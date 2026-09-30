import type { AgentTool, AgentToolResult } from "../../../core/agent-loop/types";
import { createLogger } from "../../../logging/logger";
import { callMcpTool, listMcpTools } from "../../mcp";
import { listMcpServiceConfigs } from "../../mcp/service-config";
import type { DeepAnalysisArtifactStore } from "../task/artifacts";
import { tApp } from "../../../i18n";


const logger = createLogger("analysis-loop-external-mcp");

export type ExternalMcpToolParams = {
  selectedServiceNames: string[];
  domainId: string;
  signal?: AbortSignal;
  trajectory: Pick<DeepAnalysisArtifactStore, "start" | "settle">;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeToolNamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_");
}

function recordUnavailable(
  trajectory: Pick<DeepAnalysisArtifactStore, "start" | "settle">,
  serviceName: string,
  error: string
): void {
  logger.warn(tApp("analysis.loop.external-mcp-tools.263"), { serviceName, error });
  const activityId = trajectory.start("external_tool", { serviceName });
  trajectory.settle(activityId, "failed", { error });
}

/** Discovers external MCP tools from the task's current configuration and adapts them directly into supervisor AgentTools. */
export async function loadExternalMcpTools(params: ExternalMcpToolParams): Promise<AgentTool[]> {
  params.signal?.throwIfAborted();
  if (params.selectedServiceNames.length === 0) return [];

  let services: Awaited<ReturnType<typeof listMcpServiceConfigs>>;
  try {
    services = await listMcpServiceConfigs(params.domainId);
  } catch (error) {
    if (params.signal?.aborted) throw error;
    const message = errorMessage(error);
    for (const serviceName of params.selectedServiceNames) {
      recordUnavailable(params.trajectory, serviceName, message);
    }
    return [];
  }

  const currentServices = new Map(services.map((service) => [service.name, service]));
  const tools: AgentTool[] = [];

  for (const serviceName of params.selectedServiceNames) {
    const service = currentServices.get(serviceName);
    if (!service) {
      recordUnavailable(params.trajectory, serviceName, tApp("analysis.loop.external-mcp-tools.264"));
      continue;
    }

    let discovered;
    try {
      discovered = await listMcpTools(service.url, service.headers, params.signal);
    } catch (error) {
      if (params.signal?.aborted) throw error;
      recordUnavailable(params.trajectory, serviceName, errorMessage(error));
      continue;
    }

    for (const tool of discovered) {
      const mcpToolName = typeof tool.name === "string" ? tool.name.trim() : "";
      if (!mcpToolName) continue;
      const toolName = `mcp__${sanitizeToolNamePart(serviceName)}__${sanitizeToolNamePart(mcpToolName)}`;

      tools.push({
        name: toolName,
        description: tool.description || tool.title || mcpToolName,
        parameters: tool.inputSchema || { type: "object", properties: {} },
        async execute(_toolCallId, toolArguments, signal) {
          const executionSignal = signal || params.signal;
          executionSignal?.throwIfAborted();
          const activityId = params.trajectory.start("external_tool", {
            serviceName,
            toolName,
            toolArguments,
          });
          try {
            const result = await callMcpTool(
              service.url,
              mcpToolName,
              toolArguments,
              service.headers,
              signal || params.signal
            );
            const text = JSON.stringify(result) ?? String(result);
            if (result.isError === true) throw new Error(text);
            params.trajectory.settle(activityId, "completed");
            return { content: [{ type: "text", text }] } satisfies AgentToolResult;
          } catch (error) {
            const message = errorMessage(error);
            params.trajectory.settle(
              activityId,
              executionSignal?.aborted ? "cancelled" : "failed",
              { error: message }
            );
            throw error instanceof Error ? error : new Error(message);
          }
        },
      });
    }
  }

  return tools;
}
