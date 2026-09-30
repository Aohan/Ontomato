export interface McpToolDesc {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

export interface SystemMcpTool extends McpToolDesc {
  title: string;
  description: string;
}
export interface SystemMcpService {
  name: string;
  title: string;
  mcpUrl: string;
  tools: SystemMcpTool[];
}
export interface SystemMcpToolsResponse {
  success: true;
  mcpUrl: string;
  tools: SystemMcpTool[];
  services: SystemMcpService[];
}
export interface McpToolsResponse {
  tools: Omit<SystemMcpTool, "inputSchema">[];
}
