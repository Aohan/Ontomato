function runtimeConfig() {
  return typeof window !== "undefined" ? window.__APP_CONFIG__ : undefined;
}

export const ONTOLOGY_MANAGER_URL =
  runtimeConfig()?.ONTOLOGY_MANAGER_URL?.trim() ||
  import.meta.env.VITE_ONTOLOGY_MANAGER_URL?.trim() ||
  (import.meta.env.DEV ? "http://localhost:5174" : "");
