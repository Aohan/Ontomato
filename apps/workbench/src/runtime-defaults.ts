import type { RuntimeDefaults } from "@ontomato/workbench-server";

/** 开源版历史本地默认值。未设置 DATABASE_URL 时使用；系统 MCP 没有内置地址。 */
export const ossRuntimeDefaults: RuntimeDefaults = {
  postgresFallback: "postgresql://ontomato:ontomato@localhost:5432/ontomato",
  systemMcpUrlFallback: "",
  defaultDataAdapter: "sql",
  /** OSS 历史缺省请求语言。 */
  requestLocaleFallback: "en",
};

