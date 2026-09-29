export const MODEL_ROLES = [
  "query",
  "coding",
  "general",
  "diagnosis",
  "knowledgeGovernance",
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

export interface BackendModelConfig {
  name: string;
  displayName?: string;
  baseUrl: string;
  apiKeys: string[];
  modelName: string;
  contextWindow?: number;
  maxTokens?: number;
  timeout?: string;
  maxRetries?: number;
  temperature?: number;
  topP?: number;
  customRequestParameters?: Record<string, unknown>;
  organizationId?: string;
  projectId?: string;
}

export interface BackendAgentConfig {
  model: string | null;
  skilldir?: string;
}

export interface ModelSettingsData {
  models: BackendModelConfig[];
  agents: Record<ModelRole, BackendAgentConfig>;
}
