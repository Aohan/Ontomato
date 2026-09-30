import { Agent } from "undici";
import { createLogger } from "../logging/logger";
import { getLocale, tApp } from "../i18n";

const logger = createLogger("backend-client");
// Disables the underlying headers/body timeouts; ordinary requests and SSE are each controlled by their own AbortSignal.
export const backendDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

export class AuthFailedError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail = "",
    readonly headers?: Headers
  ) {
    super(message);
    this.name = "AuthFailedError";
  }
}

export class BackendResponseError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly headers?: Headers
  ) {
    super(tApp("foundation.backend.httpError", { status, detail }));
    this.name = "BackendResponseError";
  }
}

interface CircuitState {
  consecutiveFailures: number;
  lastFailureTime: number;
  isOpen: boolean;
}

const circuits = new Map<string, CircuitState>();

const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_RESET_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

function getCircuit(endpoint: string): CircuitState {
  let c = circuits.get(endpoint);
  if (!c) {
    c = { consecutiveFailures: 0, lastFailureTime: 0, isOpen: false };
    circuits.set(endpoint, c);
  }
  return c;
}

function checkAndResetCircuit(endpoint: string): boolean {
  const circuit = getCircuit(endpoint);
  if (!circuit.isOpen) return true;

  if (Date.now() - circuit.lastFailureTime > CIRCUIT_RESET_MS) {
    circuit.isOpen = false;
    circuit.consecutiveFailures = 0;
    logger.info(tApp("foundation.circuit.reset", { endpoint }));
    return true;
  }

  return false;
}

function recordFailure(endpoint: string): void {
  const circuit = getCircuit(endpoint);
  circuit.consecutiveFailures++;
  circuit.lastFailureTime = Date.now();
  logger.warn(
    tApp("foundation.circuit.recorded", {
      endpoint,
      n: circuit.consecutiveFailures,
      threshold: CIRCUIT_THRESHOLD,
    })
  );
  if (circuit.consecutiveFailures >= CIRCUIT_THRESHOLD) {
    circuit.isOpen = true;
    logger.error(tApp("foundation.circuit.opened", { endpoint }));
  }
}

function resetCircuit(endpoint: string): void {
  const circuit = getCircuit(endpoint);
  circuit.consecutiveFailures = 0;
  if (circuit.isOpen) {
    circuit.isOpen = false;
    logger.info(tApp("foundation.circuit.closed", { endpoint }));
  }
}

function createAbortBridge(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();

  if (signal) {
    signal.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
}

function buildBackendHeaders(
  token?: string,
  userId?: string,
  locale?: string,
  apiKey?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { tk: token } : {}),
  };
  if (userId) {
    headers["uid"] = userId;
    headers["x-client-id"] = userId;
  }
  if (locale) {
    headers["Accept-Language"] = locale;
  } else {
    headers["Accept-Language"] = getLocale();
  }
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }
  return headers;
}

export interface BackendCallOptions {
  headers?: Record<string, string>;
  errorDetailLimit?: number;
  token?: string;
  apiKey?: string;
  userId?: string;
  locale?: string;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
}

type BufferedBackendResponse = Pick<Response, "headers" | "status" | "statusText"> & {
  text: string;
};

export async function checkBackendResponse(response: Response, detailLimit = 200): Promise<void> {
  if (response.ok) return;
  // The received HTTP status decides the classification; a body read failure only affects the error detail.
  const detail = String(await response.text().catch(() => "")).slice(0, detailLimit);
  if (response.status === 401 || response.status === 403) {
    throw new AuthFailedError(
      tApp("foundation.backend.tokenExpired", { status: response.status }),
      response.status,
      detail,
      response.headers
    );
  }
  throw new BackendResponseError(response.status, detail, response.headers);
}

export function backendGet(
  endpoint: string,
  url: string,
  options: BackendCallOptions & { stream: true }
): Promise<Response>;
// eslint-disable-next-line no-redeclare -- TypeScript overload; one runtime implementation.
export function backendGet(
  endpoint: string,
  url: string,
  options?: BackendCallOptions
): Promise<BufferedBackendResponse>;
// eslint-disable-next-line no-redeclare -- TypeScript overload; one runtime implementation.
export async function backendGet(
  endpoint: string,
  url: string,
  options: BackendCallOptions & { stream?: boolean } = {}
): Promise<BufferedBackendResponse | Response> {
  return backendRequest(endpoint, url, "GET", options);
}

export function backendPost(
  endpoint: string,
  url: string,
  body: unknown,
  options: BackendCallOptions = {}
): Promise<BufferedBackendResponse> {
  return backendRequest(endpoint, url, "POST", options, body) as Promise<BufferedBackendResponse>;
}

async function backendRequest(
  endpoint: string,
  url: string,
  method: "GET" | "POST",
  options: BackendCallOptions & { stream?: boolean },
  body?: unknown
): Promise<BufferedBackendResponse | Response> {
  const {
    token,
    userId,
    locale,
    timeoutMs = 600_000,
    retries = MAX_RETRIES,
    signal,
    apiKey,
  } = options;

  if (!checkAndResetCircuit(endpoint)) {
    throw new BackendUnavailableError(endpoint);
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    if (signal?.aborted) {
      throw new Error(tApp("foundation.backend.cancelled"));
    }

    const abortBridge = createAbortBridge(signal, timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: options.headers ?? buildBackendHeaders(token, userId, locale, apiKey),
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        signal: abortBridge.signal,
        dispatcher: backendDispatcher,
      } as NonNullable<Parameters<typeof fetch>[1]> & { dispatcher: Agent });

      await checkBackendResponse(response, options.errorDetailLimit);
      const result =
        method === "GET" && options.stream
          ? response
          : {
              text: await response.text(),
              headers: response.headers,
              status: response.status,
              statusText: response.statusText,
            };
      resetCircuit(endpoint);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    } finally {
      abortBridge.cleanup();
    }

    if (
      lastError instanceof AuthFailedError ||
      (lastError instanceof BackendResponseError &&
        (lastError.status < 500 || lastError.status >= 600))
    ) {
      throw lastError;
    }

    if (signal?.aborted) {
      throw lastError;
    }

    if (attempt < retries - 1) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      logger.warn(
        tApp("foundation.backend.retry", { attempt: attempt + 1, delay, endpoint }),
        {
          error: lastError.message,
        }
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  recordFailure(endpoint);

  if (lastError instanceof BackendResponseError) throw lastError;
  throw new BackendUnavailableError(endpoint, { cause: lastError });
}

export class BackendUnavailableError extends Error {
  constructor(endpoint: string, options?: ErrorOptions) {
    super(tApp("foundation.backend.unavailable", { endpoint }), options);
    this.name = "BackendUnavailableError";
  }
}

export function getCircuitStatus(endpoint: string): {
  consecutiveFailures: number;
  isOpen: boolean;
} {
  const c = getCircuit(endpoint);
  return { consecutiveFailures: c.consecutiveFailures, isOpen: c.isOpen };
}

export function allCircuitStatus(): Record<
  string,
  { consecutiveFailures: number; isOpen: boolean }
> {
  const result: Record<string, { consecutiveFailures: number; isOpen: boolean }> = {};
  for (const [key, val] of circuits.entries()) {
    result[key] = { consecutiveFailures: val.consecutiveFailures, isOpen: val.isOpen };
  }
  return result;
}
