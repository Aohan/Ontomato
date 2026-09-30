import { workbenchProduct } from "../../product/installed";
import type { McpToolDesc } from "@ontomato/contracts/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { createLogger } from "../../logging/logger";

const logger = createLogger("mcp-client");

function asArray<T = unknown>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  return v == null ? [] : [v as T];
}

function createTransport(
  url: URL,
  headers: Record<string, string>,
  signal?: AbortSignal,
  legacy = false
) {
  const fetchWithHeaders: typeof fetch = (u, init) => {
    const mergedHeaders = new Headers(init?.headers ?? {});
    for (const [k, v] of Object.entries(headers ?? {})) {
      mergedHeaders.set(k, v);
    }
    return fetch(u, {
      ...init,
      headers: mergedHeaders,
      signal: signal
        ? init?.signal
          ? AbortSignal.any([signal, init.signal])
          : signal
        : init?.signal,
    });
  };
  return legacy
    ? new SSEClientTransport(url, { fetch: fetchWithHeaders })
    : new StreamableHTTPClientTransport(url, { fetch: fetchWithHeaders });
}

async function connectClient(
  client: Client,
  url: URL,
  headers: Record<string, string>,
  signal?: AbortSignal
) {
  try {
    await client.connect(createTransport(url, headers, signal));
  } catch (error) {
    if (
      signal?.aborted ||
      !(error instanceof StreamableHTTPError) ||
      ![400, 404, 405].some((status) => status === error.code)
    )
      throw error;
    // MCP transport negotiation is confined to initialization, before any tool action.
    await client.close();
    signal?.throwIfAborted();
    await client.connect(createTransport(url, headers, signal, true));
  }
}

function connectionError(error: unknown, url: URL, headers: Record<string, string>): Error {
  let message = error instanceof Error ? error.message : String(error);
  const secrets = [
    ...Object.values(headers),
    url.username,
    url.password,
    ...url.searchParams.values(),
  ];
  for (const value of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    message = message.split(value).join("[redacted]");
  }
  return new Error(message);
}

export async function listMcpTools(
  urlLike: string,
  headers: Record<string, string> = {},
  signal?: AbortSignal
): Promise<McpToolDesc[]> {
  signal?.throwIfAborted();
  const url = new URL(urlLike);
  const client = new Client({ name: workbenchProduct().mcpClientName, version: "1.0.0" });
  try {
    await connectClient(client, url, headers, signal);
    signal?.throwIfAborted();
    const listed = await client.listTools(undefined, signal ? { signal } : undefined);
    const tools = asArray<McpToolDesc>((listed as any)?.tools);
    logger.info("listTools ok", {
      count: tools.length,
      names: tools.map((t) => t.name),
    });
    return tools;
  } catch (error) {
    throw connectionError(error, url, headers);
  } finally {
    await client.close().catch(() => {
      /* ignore */
    });
  }
}

export async function callMcpTool(
  urlLike: string,
  toolName: string,
  args: Record<string, unknown>,
  headers: Record<string, string> = {},
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const url = new URL(urlLike);
  const client = new Client({ name: workbenchProduct().mcpClientName, version: "1.0.0" });
  try {
    await connectClient(client, url, headers, signal);
    signal?.throwIfAborted();
    const result = await client.callTool(
      { name: toolName, arguments: args },
      undefined,
      signal ? { signal } : undefined
    );
    logger.info("callTool ok", { toolName, isError: result.isError === true });
    return result;
  } catch (error) {
    throw connectionError(error, url, headers);
  } finally {
    await client.close().catch(() => {
      /* ignore */
    });
  }
}
