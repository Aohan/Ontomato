import type { RuntimeDefaults } from "@ontomato/workbench-server";

/** The OSS edition's historical local defaults. Used when DATABASE_URL is unset; the system MCP has no built-in address. */
export const ossRuntimeDefaults: RuntimeDefaults = {
  postgresFallback: "postgresql://ontomato:ontomato@localhost:5432/ontomato",
  systemMcpUrlFallback: "",

  defaultDataAdapter: "sql",
  /** The OSS edition's historical default request locale. */
  requestLocaleFallback: "en",
};

