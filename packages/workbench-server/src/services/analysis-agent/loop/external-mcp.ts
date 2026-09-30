import { loadExternalMcpTools, type ExternalMcpToolParams } from "./external-mcp-tools";
import { tApp } from "../../../i18n";


function externalMcpCapabilityPrompt(): string {
  return tApp("analysis.loop.external-mcp.265");
}

/** Assembles the supervisor-only external MCP tool surface and prompt from the agent's selection; workers never get this capability. */
export async function assembleLoopExternalMcpCapability(params: ExternalMcpToolParams) {
  const enabled = params.selectedServiceNames.length > 0;
  return {
    prompt: enabled ? externalMcpCapabilityPrompt() : "",
    supervisorTools: enabled ? await loadExternalMcpTools(params) : [],
  };
}
