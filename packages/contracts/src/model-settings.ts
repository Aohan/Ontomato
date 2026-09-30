export const MODEL_ROLES = [
  "query",
  "coding",
  "general",
  "diagnosis",
  "knowledgeGovernance",
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

/** Model entry: displayName, maxTokens, and contextWindow are guaranteed after Java getModelSettings read normalization (defaults are maintained only in Java). */
export interface BackendModelConfig {
  name: string;
  displayName: string;
  baseUrl: string;
  apiKeys: string[];
  modelName: string;
  contextWindow: number;
  maxTokens: number;
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

/**
 * Parses an ISO-8601 duration string (time part, e.g. PT5M, PT300S, PT1H30M, PT0.5S) into seconds.
 * Throws an error for invalid format.
 */
export function parseIsoDurationSeconds(isoDuration: string): number {
  if (typeof isoDuration !== "string" || !isoDuration.trim()) {
    throw new Error(`Invalid ISO-8601 duration: "${isoDuration}"`);
  }
  const trimmed = isoDuration.trim();
  const match = trimmed.match(
    /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/
  );
  if (
    !match ||
    (match[1] === undefined && match[2] === undefined && match[3] === undefined)
  ) {
    throw new Error(`Invalid ISO-8601 duration: "${isoDuration}"`);
  }
  const hours = match[1] ? parseFloat(match[1]) : 0;
  const minutes = match[2] ? parseFloat(match[2]) : 0;
  const seconds = match[3] ? parseFloat(match[3]) : 0;

  return hours * 3600 + minutes * 60 + seconds;
}

