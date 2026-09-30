import { config } from "../../config/application";
import { t, tApp } from "../../i18n";
import { backendPost, BackendUnavailableError } from "../../utils/backend-client";
import { createLogger } from "../../logging/logger";

const logger = createLogger("data-query:dsl-executor");

type ExecuteV1Result =
  | { ok: true; executeUrl: string; payload: any }
  | { ok: false; executeUrl: string; status: number; detail: string };

function buildExecuteV1Url(backendUrl: string) {
  return `${backendUrl.replace(/\/$/, "")}/dsl/executeV1`;
}

const DSL_EXECUTE_ENDPOINT = "dsl/executeV1";

export async function executeDslViaBackend(
  dsl: Record<string, unknown>,
  tk: string,
  timeoutMs = 30000,
  signal?: AbortSignal
): Promise<ExecuteV1Result> {
  const backendUrl = config.dataQuery.baseUrl;
  if (!backendUrl) {
    return {
      ok: false,
      executeUrl: "",
      status: 500,
      detail: t("api.backendNotConfigured"),
    };
  }

  const executeUrl = buildExecuteV1Url(backendUrl);

  try {
    const response = await backendPost(DSL_EXECUTE_ENDPOINT, executeUrl, dsl, {
      token: tk,
      timeoutMs,
      signal,
    });

    const contentType = response.headers.get("content-type") || "";
    const rawText = response.text;
    const payload = contentType.includes("application/json")
      ? (() => {
          try {
            return JSON.parse(rawText);
          } catch {
            return rawText;
          }
        })()
      : rawText;

    return { ok: true, executeUrl, payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof BackendUnavailableError) {
      return {
        ok: false,
        executeUrl,
        status: 503,
        detail: t("api.backendRequestFailed", { message: tApp("queryFixed.242", { v0: (message) }) }),
      };
    }

    logger.error(tApp("queryFixed.243"), { url: executeUrl, error: message });

    return {
      ok: false,
      executeUrl,
      status: 502,
      detail: t("api.dslExecutionFailed", { status: message }),
    };
  }
}
