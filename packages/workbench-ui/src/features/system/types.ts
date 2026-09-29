import type { JsonObject } from "@ontomato/contracts/system-model";

export interface BackendModelConfig {
  name: string;
  displayName: string;
  baseUrl: string;
  apiKeys: string[];
  organizationId?: string | null;
  projectId?: string | null;
  modelName: string;
  timeout: string;
  maxRetries: number;
  temperature: number | null;
  topP: number | null;
  stop?: string[] | null;
  maxTokens: number | null;
  maxCompletionTokens: number | null;
  presencePenalty?: number | null;
  frequencyPenalty?: number | null;
  logitBias?: Record<string, number> | null;
  responseFormat?: string | null;
  strictJsonSchema?: boolean | null;
  seed?: number | null;
  user?: string | null;
  strictTools?: boolean | null;
  parallelToolCalls?: boolean | null;
  store?: boolean | null;
  metadata?: Record<string, string> | null;
  serviceTier?: string | null;
  reasoningEffort?: string | null;
  logRequests?: boolean | null;
  logResponses?: boolean | null;
  customRequestParameters: JsonObject;
  customHeaders?: Record<string, string> | null;
  supportedCapabilities?: string[] | null;
}

export interface BackendAgentConfig {
  model: string;
  actorCopies: number;
  skilldir?: string;
}

export interface EmbeddingModelConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  timeout: string;
  customHeaders?: Record<string, string> | null;
}

/** Fields a data adapter connection can have; which ones each adapter needs comes from fields in the backend list. */
export type DataAdapterField = "url" | "user" | "password";

/** The saved connection of one adapter (a value of the business config dataAdapterConnections). */
export type DataAdapterConnection = Partial<Record<DataAdapterField, string>>;

/** A data adapter installed in this edition (one item of GET /businessConfig/dataAdapters). */
export interface DataAdapterInfo {
  type: string;
  label: string;
  sql: boolean;
  fields: DataAdapterField[];
  /** Input examples (only for fields that have one), declared by the adapter module. */
  examples: Partial<Record<DataAdapterField, string>>;
}

export interface BusinessConfig {
  models: BackendModelConfig[];
  agents: Record<AgentKey, BackendAgentConfig>;
  embeddingModelProperties: EmbeddingModelConfig | null;
  knowledgeMaxResult: number;
  toolAndPythonRetry: number;
  dslCookerTries: number;
  dslCookerTimeout: number;
  questionSpliterTries: number;
  questionSpliterTimeout: number;
  lang: string;
  dataAdapter: string;
  dataAdapterConnections: Record<string, DataAdapterConnection>;
}

export const agentKeys = [
  "normalChat",
  "questionSpliter",
  "cleverNormalChat",
  "pythonChat",
  "toolChat",
] as const;

export type AgentKey = (typeof agentKeys)[number];

export type GeneralConfigKey =
  | "knowledgeMaxResult"
  | "toolAndPythonRetry"
  | "dslCookerTries"
  | "dslCookerTimeout"
  | "questionSpliterTries"
  | "questionSpliterTimeout"
  | "lang";

// Shared identity for application and query engine models: name is the fixed config ID and
// displayName may be duplicated; append the ID when they differ, show it once when they match.
export function modelLabel(model: { name: string; displayName: string }): string {
  return model.displayName === model.name ? model.name : `${model.displayName} (${model.name})`;
}

export function parseTimeoutSeconds(timeout: string): number {
  const match = timeout?.match(/^PT(\d+)S$/);
  return match ? parseInt(match[1], 10) : 300;
}

export function formatTimeout(seconds: number): string {
  return `PT${seconds}S`;
}
