import { getApiConfig, buildUrl } from "../../../config/data-query-api";
import { environment } from "../../../config/environment";
import { backendGet } from "../../../utils/backend-client";
import { createLogger } from "../../../logging/logger";
import { runtimeDefaults } from "../../../runtime/defaults";
import { tApp } from "../../../i18n";


const logger = createLogger("observe:backend-config");

export interface BackendInfraConfig {
  dataAdapter: string;
}

let cached: BackendInfraConfig | null = null;

const ENDPOINT = "/businessConfig/getConfigAndDesc";

export async function fetchBackendConfig(token?: string): Promise<BackendInfraConfig | null> {
  const apiConfig = getApiConfig();
  if (!apiConfig.baseUrl) return null;

  const tk = token || environment.queryKey();
  if (!tk) {
    logger.warn(tApp("diag.observe.backend-config-fetcher.0"));
    return null;
  }

  try {
    const url = buildUrl(apiConfig, ENDPOINT);
    const resp = await backendGet(ENDPOINT, url, { token: tk, timeoutMs: 10_000, retries: 1 });
    const json = JSON.parse(resp.text) as Record<string, unknown>;

    if (!json.success) {
      logger.warn(tApp("diag.observe.backend-config-fetcher.1"), { response: JSON.stringify(json).slice(0, 200) });
      return null;
    }

    const data = json.data as Record<string, unknown> | undefined;
    const config = data?.config as Record<string, unknown> | undefined;
    const ontomato = config?.ontomato as Record<string, unknown> | undefined;
    const dataEngine = ontomato?.["data-engine"] as Record<string, unknown> | undefined;

    if (!dataEngine) {
      logger.warn(tApp("diag.observe.backend-config-fetcher.2"));
      return null;
    }

    const result: BackendInfraConfig = {
      // When the backend config gives no adapter, interpret it with each edition's
      // own historical default (enterprise m3, OSS sql).
      dataAdapter: String(dataEngine.dataAdapter || runtimeDefaults().defaultDataAdapter),
    };

    cached = result;
    logger.info(tApp("diag.observe.backend-config-fetcher.3"), {
      dataAdapter: result.dataAdapter,
    });
    return result;
  } catch (err) {
    logger.warn(tApp("diag.observe.backend-config-fetcher.4"), {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export function getBackendConfig(): BackendInfraConfig | null {
  return cached;
}

export function clearBackendConfigCache(): void {
  cached = null;
}
