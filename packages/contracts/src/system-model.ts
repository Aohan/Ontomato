export type AbcQuestionMode = "no_tool_fixed" | "tool_fixed" | "harness";

export interface SystemModelConfig {
  abcQuestionMode: AbcQuestionMode;
  queryTimeoutSeconds: number;
}

export interface SystemModelConfigResponse extends SystemModelConfig {
  hasCustomConfig: boolean;
}

