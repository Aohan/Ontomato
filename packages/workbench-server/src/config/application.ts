import { environment } from "./environment";

/**
 * 归一化 API base 前缀：补前导 `/`、去尾 `/`；留空则回退 `/api`。
 * 同域名多实例部署时设如 `/api-itsm`，由 nginx 重写回后端的 `/api/`。
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
