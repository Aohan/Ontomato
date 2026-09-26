/// <reference types="vite/client" />

declare global {
  interface Window {
    /** 由 index.html 先加载的 config.js 提供（开发用 public/config.js，部署时按环境变量生成）；未提供或加载失败时缺失。 */
    __ONTOLOGY_MANAGER_CONFIG__?: { API_BASE?: string; INITIAL_ROUTE?: string };
  }
}

/** 运行配置按原顺序取值：config.js → 构建期 VITE_ONTOLOGY_* → 内置默认。 */
export function readRuntimeConfig() {
  const runtime = window.__ONTOLOGY_MANAGER_CONFIG__;
  return {
    apiBase: (runtime?.API_BASE || import.meta.env.VITE_ONTOLOGY_API_BASE || "/api").replace(
      /\/+$/,
      ""
    ),
    initialRoute: runtime?.INITIAL_ROUTE || import.meta.env.VITE_ONTOLOGY_INITIAL_ROUTE || "",
  };
}
