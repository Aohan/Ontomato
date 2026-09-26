import type { SseErrorEvent } from "./errors";

export type SystemModelTestEvent =
  | SseErrorEvent
  | { type?: never; content: string; done?: never; model?: never }
  | { type?: never; content: ""; done: true; model: string };

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export type JsonObject = { [key: string]: JsonValue };

export interface SystemModelEntry {
  /** 域内唯一配置 ID：创建后固定，系统模型引用与运行解析只认它。 */
  name: string;
  /** 可修改、可重名的显示名；不参与引用。 */
  displayName: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  customRequestParameters: JsonObject;
  timeoutSeconds: number;
  maxRetries: number;
  /** 模型总上下文窗口（token，正整数），Harness 按它判断压缩触发。 */
  contextWindow: number;
}

/** 应用模型角色：系统模型与诊断模型，各自引用模型库中的一条配置 ID，可相同。 */
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
