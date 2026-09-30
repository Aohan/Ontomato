import { environment } from "./environment";

/**
 * Normalized API base prefix: adds the leading `/`, strips the trailing `/`; empty falls back to `/api`.
 * For same-domain multi-instance deployments set e.g. `/api-itsm`, rewritten back to the backend's `/api/` by nginx.
 */
function normalizeApiBase(raw?: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "/api";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.replace(/\/+$/, "") || "/api";
}

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: environment.node() || "development",
  logLevel: environment.level() || "info",
  apiBase: normalizeApiBase(process.env.API_BASE),
  ontologyManagerUrl: process.env.ONTOLOGY_MANAGER_URL || "",
  postgres: {
    get connectionString() {
      return environment.pgConnection();
    },
    schema: environment.pgSchema(),
  },
  dataQuery: {
    baseUrl: environment.queryBase() || "",
    timeout: environment.queryTimeout(),
  },
  schedule: {
    timezone: process.env.SCHEDULE_TIMEZONE || process.env.TZ || "Asia/Shanghai",
  },
};
