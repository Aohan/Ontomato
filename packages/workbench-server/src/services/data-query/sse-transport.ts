import {
  AuthFailedError,
  BackendResponseError,
  BackendUnavailableError,
  backendDispatcher,
  checkBackendResponse,
} from "../../utils/backend-client";

type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

export interface BackendLocation {
  sessionId?: string;
  backendNodeId?: string;
}

/**
 * The only interpreter of the first frame `{sessionId, nodeId}` of the backend's new-session stream
 * (backend session locating and cancellation · responsibility). Only the two fields the backend
 * actually sends, `sessionId` and `nodeId`, are recognized; when neither exists it returns undefined (not a first frame).
 */
export function extractBackendLocation(event: unknown): BackendLocation | undefined {
  if (!event || typeof event !== "object" || Array.isArray(event)) return undefined;
  const record = event as Record<string, unknown>;
  const sessionId =
    typeof record.sessionId === "string" && record.sessionId ? record.sessionId : undefined;
  const nodeId = typeof record.nodeId === "string" ? record.nodeId.trim() : "";
  const backendNodeId = nodeId ? nodeId : undefined;
  if (!sessionId && !backendNodeId) return undefined;
  return { sessionId, backendNodeId };
}

export async function* streamBackendSSE(
  endpoint: string,
  url: string,
  init: FetchInit,
  onOpen?: () => void
): AsyncGenerator<unknown> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) onAbort();
  init.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      dispatcher: backendDispatcher,
    } as FetchInit & { dispatcher: typeof backendDispatcher });
    await checkBackendResponse(response);
    if (!response.body) throw new Error("Response body is not readable");
    onOpen?.();
    yield* readSSEStream(response);
  } catch (error) {
    if (
      init.signal?.aborted ||
      error instanceof AuthFailedError ||
      error instanceof BackendResponseError
    ) {
      throw error;
    }
    throw new BackendUnavailableError(endpoint, {
      cause: error instanceof Error ? error : new Error(String(error)),
    });
  } finally {
    init.signal?.removeEventListener("abort", onAbort);
    controller.abort();
  }
}

function parseSSEFrame(frame: string): unknown | null {
  const dataLines: string[] = [];

  for (const rawLine of frame.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const separator = rawLine.indexOf(":");
    const field = separator >= 0 ? rawLine.slice(0, separator) : rawLine;
    if (field !== "data") continue;

    let value = separator >= 0 ? rawLine.slice(separator + 1) : "";
    if (value.startsWith(" ")) value = value.slice(1);
    dataLines.push(value);
  }

  if (dataLines.length === 0) return null;

  const payload = dataLines.join("\n").trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

async function* readSSEStream(response: Response): AsyncGenerator<unknown> {
  const reader = response.body!.getReader();

  const decoder = new TextDecoder();
  let buffer = "";

  const drainFrames = function* (final = false) {
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = final ? "" : frames.pop() || "";

    for (const frame of frames) {
      if (!frame.trim()) continue;
      const parsed = parseSSEFrame(frame);
      if (parsed !== null) yield parsed;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      for (const parsed of drainFrames()) {
        yield parsed;
      }
    }

    if (buffer.trim()) {
      for (const parsed of drainFrames(true)) {
        yield parsed;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
