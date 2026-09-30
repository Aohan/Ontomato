import type { BackendNodeConfig, LogSourceConfig } from "@ontomato/contracts/observe";
import { getApiConfig } from "../../../../config/data-query-api";
import { environment } from "../../../../config/environment";
import { backendGet } from "../../../../utils/backend-client";
import { tApp } from "../../../../i18n";


// datarag keeps the HTTP path for compatibility; data-agent treats it as backend info logs.
const BACKEND_INFO_LOG_ENDPOINT = "/observe/logs/app";
const AGENT_LLM_ENDPOINT = "/observe/logs/agent-llm";
const DIAGNOSTIC_EVENTS_ENDPOINT = "/observe/logs/diagnostic-events";
const TAIL_ENDPOINT = "/observe/logs/tail";
const DEFAULT_BACKEND_NODE_TIMEOUT_MS = 60_000;

export interface BackendNodeRequestOptions {
  token?: string;
  apiKey?: string;
  userId?: string;
  locale?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface BackendNodeLogLine {
  nodeId?: string;
  line: string;
}

export interface BackendTailStream {
  close: () => void;
}

export function resolveBackendNodeBaseUrl(
  cfg: LogSourceConfig,
  backendNodeId?: string
): string | null {
  const configured = backendNodeId ? findBackendNode(cfg.backendNodes, backendNodeId) : undefined;
  const baseUrl = configured?.baseUrl || getApiConfig().baseUrl || "";
  return baseUrl || null;
}

export function listBackendTailNodes(cfg: LogSourceConfig): BackendNodeConfig[] {
  if (cfg.backendNodes.length > 0) {
    return cfg.backendNodes;
  }

  const baseUrl = getApiConfig().baseUrl;
  return baseUrl ? [{ nodeId: "default", baseUrl }] : [];
}

export async function fetchBackendInfoLogSlice(input: {
  baseUrl: string;
  minTs: number;
  maxTs: number;
  options?: BackendNodeRequestOptions;
}): Promise<string[]> {
  const url = buildUrl(input.baseUrl, BACKEND_INFO_LOG_ENDPOINT, {
    minTs: String(Math.trunc(input.minTs)),
    maxTs: String(Math.trunc(input.maxTs)),
  });
  const text = await getText(BACKEND_INFO_LOG_ENDPOINT, url, input.options);
  return parseTextLines(text);
}

export async function fetchBackendAgentLlmLines(input: {
  baseUrl: string;
  sessionId: string;
  minTs?: number;
  maxTs?: number;
  options?: BackendNodeRequestOptions;
}): Promise<string[]> {
  const query: Record<string, string> = { sessionId: input.sessionId };
  if (Number.isFinite(input.minTs)) query.minTs = String(Math.trunc(input.minTs!));
  if (Number.isFinite(input.maxTs)) query.maxTs = String(Math.trunc(input.maxTs!));
  const url = buildUrl(input.baseUrl, AGENT_LLM_ENDPOINT, query);
  const text = await getText(AGENT_LLM_ENDPOINT, url, input.options);
  return parseTextLines(text);
}

export async function fetchBackendDiagnosticEventLines(input: {
  baseUrl: string;
  sessionId: string;
  minTs?: number;
  maxTs?: number;
  options?: BackendNodeRequestOptions;
}): Promise<string[]> {
  const query: Record<string, string> = { sessionId: input.sessionId };
  if (Number.isFinite(input.minTs)) query.minTs = String(Math.trunc(input.minTs!));
  if (Number.isFinite(input.maxTs)) query.maxTs = String(Math.trunc(input.maxTs!));
  const url = buildUrl(input.baseUrl, DIAGNOSTIC_EVENTS_ENDPOINT, query);
  const text = await getText(DIAGNOSTIC_EVENTS_ENDPOINT, url, input.options);
  return parseTextLines(text);
}

export async function probeBackendTailStream(input: {
  node: BackendNodeConfig;
  options?: BackendNodeRequestOptions;
}): Promise<void> {
  const url = buildUrl(input.node.baseUrl, TAIL_ENDPOINT);
  const response = await backendGet(TAIL_ENDPOINT, url, {
    stream: true,
    token: input.options?.token || environment.queryKey(),
    userId: input.options?.userId,
    locale: input.options?.locale,
    timeoutMs: input.options?.timeoutMs ?? DEFAULT_BACKEND_NODE_TIMEOUT_MS,
    retries: 1,
    signal: input.options?.signal,
  });
  await response.body?.cancel().catch(() => undefined);
}

export function streamBackendTailLines(input: {
  node: BackendNodeConfig;
  options?: BackendNodeRequestOptions;
  onLine: (line: BackendNodeLogLine) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}): BackendTailStream {
  const url = buildUrl(input.node.baseUrl, TAIL_ENDPOINT);
  const controller = new AbortController();
  let closed = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const close = () => {
    if (closed) return;
    closed = true;
    controller.abort();
    void reader?.cancel().catch(() => undefined);
  };
  const onAbort = () => close();
  input.options?.signal?.addEventListener("abort", onAbort, { once: true });

  void (async () => {
    try {
      const response = await backendGet(TAIL_ENDPOINT, url, {
        stream: true,
        token: input.options?.token || environment.queryKey(),
        userId: input.options?.userId,
        locale: input.options?.locale,
        timeoutMs: input.options?.timeoutMs ?? DEFAULT_BACKEND_NODE_TIMEOUT_MS,
        retries: 1,
        signal: controller.signal,
      });
      reader = response.body?.getReader() ?? null;
      if (!reader) throw new Error(tApp("diag.observe.log-sources.backend-node-client.0"));

      await readSseStream(reader, (line) => {
        input.onLine({ nodeId: input.node.nodeId, line });
      });
      if (!closed) input.onClose?.();
    } catch (error) {
      if (!closed) {
        input.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      input.options?.signal?.removeEventListener("abort", onAbort);
    }
  })();

  return { close };
}

function findBackendNode(
  nodes: BackendNodeConfig[],
  backendNodeId: string
): BackendNodeConfig | undefined {
  return nodes.find((node) => node.nodeId === backendNodeId);
}

function buildUrl(baseUrl: string, endpoint: string, query: Record<string, string> = {}): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const params = new URLSearchParams(query);
  const queryString = params.toString();
  return queryString ? `${base}${path}?${queryString}` : `${base}${path}`;
}

async function getText(
  endpoint: string,
  url: string,
  options: BackendNodeRequestOptions = {}
): Promise<string> {
  const response = await backendGet(endpoint, url, {
    // Without any caller credential the configured query key is sent as before.
    token: options.token || (options.apiKey ? undefined : environment.queryKey()),
    apiKey: options.apiKey,
    userId: options.userId,
    locale: options.locale,
    timeoutMs: options.timeoutMs ?? DEFAULT_BACKEND_NODE_TIMEOUT_MS,
    retries: 1,
    signal: options.signal,
  });
  return response.text;
}

function parseTextLines(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const lines = extractJsonLines(parsed);
    if (lines) return lines;
  } catch {
    // Plain text / NDJSON is the expected response form.
  }

  return text.split(/\r?\n/).filter((line) => line.trim());
}

async function readSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onData: (data: string) => void
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = findSseBoundary(buffer);
    while (boundary) {
      const block = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      const data = parseSseData(block);
      if (data !== null) onData(data);
      boundary = findSseBoundary(buffer);
    }
  }

  buffer += decoder.decode();
  const data = parseSseData(buffer);
  if (data !== null) onData(data);
}

function findSseBoundary(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf < 0 && crlf < 0) return null;
  if (lf >= 0 && (crlf < 0 || lf < crlf)) return { index: lf, length: 2 };
  return { index: crlf, length: 4 };
}

function parseSseData(block: string): string | null {
  const lines = block.split(/\r?\n/);
  let eventName = "message";
  const dataLines: string[] = [];

  for (const rawLine of lines) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const colon = rawLine.indexOf(":");
    const field = colon >= 0 ? rawLine.slice(0, colon) : rawLine;
    let value = colon >= 0 ? rawLine.slice(colon + 1) : "";
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") {
      eventName = value;
    } else if (field === "data") {
      dataLines.push(value);
    }
  }

  if (eventName === "heartbeat" || dataLines.length === 0) return null;
  return dataLines.join("\n");
}

function extractJsonLines(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
  }
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const candidates = [record.lines, record.data, record.logs];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
    }
  }
  return null;
}
