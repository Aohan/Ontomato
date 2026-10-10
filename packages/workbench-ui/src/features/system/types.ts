import type {
  BackendAgentConfig,
  BackendModelConfig,
  ModelRole,
} from "@ontomato/contracts/model-settings";
import type { DataAdapterField, DataAdapterTestResult } from "@ontomato/contracts/data-adapters";

/**
 * A model entry edited on the model configuration page: based on the entry read by getModelSettings, with fields that
 * have no controls (organizationId etc.) round-tripped as-is in the snapshot. Unset optional fields may be null when
 * read; new or cleared maxTokens / contextWindow are submitted as null and Java's read normalization fills the defaults.
 */
export type ModelEntry = Omit<
  BackendModelConfig,
  "maxTokens" | "contextWindow" | "timeout" | "maxRetries" | "temperature" | "topP"
> & {
  maxTokens: number | null;
  contextWindow: number | null;
  timeout?: string | null;
  maxRetries?: number | null;
  temperature?: number | null;
  topP?: number | null;
  maxCompletionTokens?: number | null;
};

/** A save the page hands to a card's dialog: resolves to whether the value was saved; the dialog closes only on success. */
export type SaveAction<T> = (value: T) => Promise<boolean>;

/** Draft model references of the five roles: a config ID or not configured (null); same shape as agents in the saveModelSettings request. */
export type RoleModels = Record<ModelRole, string | null>;

export interface EmbeddingModelConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  timeout: string;
  /** Vector dimensions of this domain: sent with every embedding request, a positive integer. */
  dimensions: number;
  customHeaders?: Record<string, string> | null;
}

/** GET /businessConfig/vectorRebuildStatus: whether this domain's vectors need rebuilding and the current or last rebuild. */
export interface VectorRebuildStatus {
  needed: boolean;
  running: boolean;
  total: number;
  done: number;
  /** Reason of the last failed rebuild; null after a success or when none has run. */
  error: string | null;
}

/** The saved connection of one adapter (a value of the business config dataAdapterConnections). */
export type DataAdapterConnection = Partial<Record<DataAdapterField, string>>;

/** Outcome of the last connection test of the data adapter form: the driver's report, or the backend message verbatim. */
export type DataAdapterTestOutcome =
  { ok: true; result: DataAdapterTestResult } | { ok: false; message: string };

/** General parameters, language and data adapter edited on the system config page. */
export interface SystemSettings {
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

/** The parts of GET /businessConfig/getConfig the two pages read: the system config page reads general settings and the skill directory, the model configuration page reads Embedding. */
export interface BusinessConfig extends SystemSettings {
  agents: Record<ModelRole, BackendAgentConfig>;
  embeddingModelProperties: EmbeddingModelConfig | null;
}

export type GeneralConfigKey =
  | "knowledgeMaxResult"
  | "toolAndPythonRetry"
  | "dslCookerTries"
  | "dslCookerTimeout"
  | "questionSpliterTries"
  | "questionSpliterTimeout"
  | "lang";

// Model identity: name is the fixed config ID and displayName may be duplicated;
// append the ID when they differ, show it once when they match.
export function modelLabel(model: { name: string; displayName: string }): string {
  return model.displayName === model.name ? model.name : `${model.displayName} (${model.name})`;
}

export function formatTimeout(seconds: number): string {
  return `PT${seconds}S`;
}
