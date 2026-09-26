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

export interface MysqlAdapterConfig {
  mysqlUrl: string;
  mysqlUser: string;
  mysqlPassword: string;
}

export interface PgsqlAdapterConfig {
  pgsqlUrl: string;
  pgsqlUser: string;
  pgsqlPassword: string;
}

export interface OracleAdapterConfig {
  oracleUrl: string;
  oracleUser: string;
  oraclePassword: string;
}

export interface SqlServerAdapterConfig {
  sqlServerUrl: string;
  sqlServerUser: string;
  sqlServerPassword: string;
}

export interface Db2AdapterConfig {
  db2Url: string;
  db2User: string;
  db2Password: string;
}

export interface DmAdapterConfig {
  dmUrl: string;
  dmUser: string;
  dmPassword: string;
}

export interface GaussDBAdapterConfig {
  gaussDBUrl: string;
  gaussDBUser: string;
  gaussDBPassword: string;
}

export interface DuckDBAdapterConfig {
  duckdbUrl: string;
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
  mysqlDataAdapterProperties: MysqlAdapterConfig | null;
  pgsqlDataAdapterProperties: PgsqlAdapterConfig | null;
  oracleDataAdapterProperties: OracleAdapterConfig | null;
  sqlServerDataAdapterProperties: SqlServerAdapterConfig | null;
  db2DataAdapterProperties: Db2AdapterConfig | null;
  dmDataAdapterProperties: DmAdapterConfig | null;
  gaussDBDataAdapterProperties: GaussDBAdapterConfig | null;
  duckDBDataAdapterProperties: DuckDBAdapterConfig | null;
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
