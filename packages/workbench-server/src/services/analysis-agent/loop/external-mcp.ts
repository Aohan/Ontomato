import { loadExternalMcpTools, type ExternalMcpToolParams } from "./external-mcp-tools";
import { tApp } from "../../../i18n";


function externalMcpCapabilityPrompt(): string {
  return tApp("analysis.loop.external-mcp.265");
}

/** 按智能体选择装配主管专属的外部 MCP 工具面与提示词；工人不获得此能力。 */
export async function assembleLoopExternalMcpCapability(params: ExternalMcpToolParams) {
  const enabled = params.selectedServiceNames.length > 0;
  return {
    prompt: enabled ? externalMcpCapabilityPrompt() : "",
    supervisorTools: enabled ? await loadExternalMcpTools(params) : [],
  };
}
