import { modelAgentCatalog } from "../../../../logging/model-agents";

/**
 * Display-name lookup for prompt artifacts.
 *
 * Extraction is source-driven: frontend LLM JSONL and backend agent-llm JSONL
 * decide what exists. The installed catalog only supplies stable human-facing
 * names and numbering; unknown agents must fall back to their raw agentName.
 */

export function getDisplayNameForBackendAgent(agentName: string): string {
  return modelAgentCatalog().backendDisplayNames[agentName] ?? agentName;
}

export function getDisplayNameForDataAgent(agentName: string): string {
  const { roles, otherDisplayNames } = modelAgentCatalog();
  const role = Object.values(roles).find((entry) => entry.agentName === agentName);
  return role?.displayName ?? otherDisplayNames[agentName] ?? agentName;
}
