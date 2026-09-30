import { workbenchProduct } from "../../../product/installed";
import type { BackendNodeConfig, LogSourceConfig } from "@ontomato/contracts/observe";
import { environment } from "../../../config/environment";
import { runtimeDataDir } from "../../../content/layout";
import { resolveLogDir } from "../../../logging/log-file-transport";

export const observeConfig = {
  get dataDir() {
    return runtimeDataDir("observe");
  },
  get logDir() {
    return resolveLogDir();
  },
  get appLogFile() {
    return workbenchProduct().logFileName;
  },
  get llmLogFile() {
    return workbenchProduct().llmLogFileName;
  },
};

/* ------------------------------------------------------------------ */
/*  Runtime-mutable log source config                                 */
/* ------------------------------------------------------------------ */

let runtimeConfig: LogSourceConfig | null = null;

/** Read the effective log source configuration (runtime override > env). */
export function getLogSourceConfig(): LogSourceConfig {
  if (runtimeConfig) {
    return { ...runtimeConfig, backendNodes: [...runtimeConfig.backendNodes] };
  }

  return {
    backendNodes: parseBackendNodes(environment.observeNodes()),
  };
}

/** Save runtime override from the admin page. */
export function setLogSourceConfig(cfg: LogSourceConfig): void {
  runtimeConfig = { ...cfg, backendNodes: [...cfg.backendNodes] };
}

function parseBackendNodes(value?: string): BackendNodeConfig[] {
  const text = value?.trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const record = item as Record<string, unknown>;
          const nodeId = typeof record.nodeId === "string" ? record.nodeId.trim() : "";
          const baseUrl = typeof record.baseUrl === "string" ? record.baseUrl.trim() : "";
          return nodeId && baseUrl ? { nodeId, baseUrl } : null;
        })
        .filter((item): item is BackendNodeConfig => item !== null);
    }
  } catch {
    // Fall through to the compact env format below.
  }

  return text
    .split(",")
    .map((entry) => {
      const [nodeIdRaw, baseUrlRaw] = entry.split("=");
      const nodeId = nodeIdRaw?.trim();
      const baseUrl = baseUrlRaw?.trim();
      return nodeId && baseUrl ? { nodeId, baseUrl } : null;
    })
    .filter((item): item is BackendNodeConfig => item !== null);
}
