import type { RuntimeDefaults } from "@ontomato/workbench-server";

/** The OSS edition's historical local defaults. Used when DATABASE_URL is unset; the system MCP has no built-in address. */
export const ossRuntimeDefaults: RuntimeDefaults = {
  postgresFallback: "postgresql://ontomato:ontomato@localhost:5432/ontomato",
  systemMcpUrlFallback: "",
  /** The OSS edition accepts both the OPENAI_* / MODEL_NAME and LLM_* variable groups, the former taking priority. */
  defaultModelConnection: () => ({
    baseUrl: process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || "",
    apiKey: process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || "",
    modelName: process.env.MODEL_NAME || process.env.LLM_MODEL || "",
  }),
  defaultDataAdapter: "sql",
  /** The OSS edition's historical default request locale. */
  requestLocaleFallback: "en",
};
