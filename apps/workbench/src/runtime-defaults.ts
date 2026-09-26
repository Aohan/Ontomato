import type { RuntimeDefaults } from "@ontomato/workbench-server";

/** 开源版历史本地默认值。未设置 DATABASE_URL 时使用；系统 MCP 没有内置地址。 */
export const ossRuntimeDefaults: RuntimeDefaults = {
  postgresFallback: "postgresql://ontomato:ontomato@localhost:5432/ontomato",
  systemMcpUrlFallback: "",
  /** 开源版同时接受 OPENAI_* / MODEL_NAME 与 LLM_* 两组变量，前者优先。 */
  defaultModelConnection: () => ({
    baseUrl: process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || "",
    apiKey: process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || "",
    modelName: process.env.MODEL_NAME || process.env.LLM_MODEL || "",
  }),
  defaultDataAdapter: "sql",
  /** OSS 历史缺省请求语言。 */
  requestLocaleFallback: "en",
};
