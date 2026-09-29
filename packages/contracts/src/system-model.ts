import type { SseErrorEvent } from "./errors";

export type SystemModelTestEvent =
  | SseErrorEvent
  | { type?: never; content: string; done?: never; model?: never }
  | { type?: never; content: ""; done: true; model: string };

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export type JsonObject = { [key: string]: JsonValue };

export interface SystemModelEntry {
  /** Domain-unique config ID: fixed after creation; system model references and runtime resolution only accept it. */
  name: string;
  /** Editable display name that may repeat; never used for references. */
  displayName: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  customRequestParameters: JsonObject;
  timeoutSeconds: number;
  maxRetries: number;
  /** Model total context window (tokens, positive integer); the harness uses it to decide when compaction triggers. */
  contextWindow: number;
}

/** App model roles: system model and diagnosis model, each referencing one config ID from the model library; they may be the same. */
export type SystemModelRole = "default" | "diagnosis";

export interface SystemModelConfig {
  models: SystemModelEntry[];
  agents: Record<SystemModelRole, { model: string }>;
  abcQuestionMode: AbcQuestionMode;
  queryTimeoutSeconds: number;
}

export type AbcQuestionMode = "no_tool_fixed" | "tool_fixed" | "harness";

export interface SystemModelConfigResponse extends SystemModelConfig {
  hasCustomConfig: boolean;
}
