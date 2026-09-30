/// <reference types="vite/client" />

declare global {
  interface Window {
    /** Provided by config.js, which index.html loads first (public/config.js in development, generated from environment variables at deployment); missing if not provided or failed to load. */
    __ONTOLOGY_MANAGER_CONFIG__?: { API_BASE?: string; INITIAL_ROUTE?: string };
  }
}

/** Runtime config resolved in the original order: config.js → build-time VITE_ONTOLOGY_* → built-in defaults. */
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
