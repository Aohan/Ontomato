import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  startChat: vi.fn(),
  hasSession: vi.fn(),
  getResponseStream: vi.fn(),
  getSessionHistory: vi.fn(),
}));

vi.mock("../../../platform/diagnosis/observe/agent/pi-agent", () => ({
  diagnosisManager: {
    createSession: mocks.createSession,
    startChat: mocks.startChat,
    hasSession: mocks.hasSession,
    getResponseStream: mocks.getResponseStream,
    getSessionHistory: mocks.getSessionHistory,
  },
}));

import { installWorkbenchIdentity } from "../../../identity/installed";
import { installWorkbenchProduct } from "../../../product/installed";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { SessionResponseStream } from "../../../platform/diagnosis/observe/agent/session-stream";
import { createOpsAgentMcpRouter, getOpsAgentMcpToolCatalog } from "../ops-agent-mcp";
import os from "node:os";
import { installContentLayout } from "../../../content/layout";
import { installRuntimeDefaults } from "../../../runtime/defaults";
import type { WorkbenchIdentity } from "../../../identity/types";
import type { WorkbenchProduct } from "../../../product/types";

configureI18n({
  defaultLocale: "en",
  languageSwitchEnabled: false,
  appTextLocale: "en",
  packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
});

installContentLayout({
  runtimeRoot: os.tmpdir(),
  prompts: [],
  skillTemplate: [],
  runtimeResources: [],
});

installRuntimeDefaults({
  postgresFallback: "postgresql://localhost/dummy",
  systemMcpUrlFallback: "",
  defaultDataAdapter: "sql",
  requestLocaleFallback: "en",
});

let servers: http.Server[] = [];
let clients: Client[] = [];

beforeEach(() => {
  mocks.createSession.mockReset();
  mocks.startChat.mockReset();
  mocks.hasSession.mockReset();
  mocks.getResponseStream.mockReset();
  mocks.getSessionHistory.mockReset();

  installWorkbenchProduct({
    analysisMcpServerName: "ontomato-analysis-agents",
    opsMcpServerName: "ontomato-ops-agent",
    serviceDisplayName: "Ontomato",
  } as unknown as WorkbenchProduct);

  installWorkbenchIdentity({
    resolveMcpCaller: async () => ({ userId: "system", domainId: "default" }),
    assertObserveAccess: async () => {},
  } as unknown as WorkbenchIdentity);
});

afterEach(async () => {
  const activeClients = clients;
  clients = [];
  await Promise.all(activeClients.map((client) => client.close().catch(() => undefined)));

  const activeServers = servers;
  servers = [];
  await Promise.all(
    activeServers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
  vi.restoreAllMocks();
});

async function startClient(router: express.Router): Promise<Client> {
  const app = express();
  app.use(express.json());
  app.use("/mcp", router);
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  servers.push(server);
  const address = server.address() as AddressInfo;
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${address.port}/mcp`)
  );
  const client = new Client({ name: "ops-mcp-test", version: "1.0.0" });
  await client.connect(transport);
  clients.push(client);
  return client;
}

function readToolPayload(result: unknown): any {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content || [];
  const text = content.find((item) => item.type === "text");
  return typeof text?.text === "string" ? JSON.parse(text.text) : result;
}

describe("ops agent MCP router", () => {
  it("starts a new session and returns completed status with answer", async () => {
    mocks.createSession.mockResolvedValue({ id: "sess-1" });
    const stream = new SessionResponseStream();
    mocks.startChat.mockImplementation(async () => {
      stream.append({ type: "response_end", status: "completed" });
      return { ok: true, stream };
    });
    mocks.getSessionHistory.mockResolvedValue({
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "diagnosed output" },
      ],
    });

    const client = await startClient(createOpsAgentMcpRouter({ timeoutMs: 1000 }));
    const result = readToolPayload(
      await client.callTool({ name: "send", arguments: { message: "hello" } })
    );

    expect(mocks.createSession).toHaveBeenCalled();
    expect(mocks.startChat).toHaveBeenCalledWith("sess-1", "hello", {
      domainId: "default",
      token: undefined,
      apiKey: undefined,
    });
    expect(result).toEqual({
      status: "completed",
      sessionId: "sess-1",
      answer: "diagnosed output",
    });
  });

  it("returns parameter error when message is omitted without sessionId", async () => {
    const client = await startClient(createOpsAgentMcpRouter({ timeoutMs: 1000 }));
    const result = readToolPayload(
      await client.callTool({ name: "send", arguments: {} })
    );

    expect(result).toEqual({
      success: false,
      code: "INVALID_CHAT_INPUT",
      error: expect.any(String),
    });
  });

  it("continues conversation with existing sessionId and message", async () => {
    const stream = new SessionResponseStream();
    mocks.startChat.mockImplementation(async () => {
      stream.append({ type: "response_end", status: "completed" });
      return { ok: true, stream };
    });
    mocks.getSessionHistory.mockResolvedValue({
      messages: [
        { role: "user", content: "more context" },
        { role: "assistant", content: "continued diagnosis" },
      ],
    });

    const client = await startClient(createOpsAgentMcpRouter({ timeoutMs: 1000 }));
    const result = readToolPayload(
      await client.callTool({
        name: "send",
        arguments: { sessionId: "sess-existing", message: "more context" },
      })
    );

    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.startChat).toHaveBeenCalledWith(
      "sess-existing",
      "more context",
      {
        domainId: "default",
        token: undefined,
        apiKey: undefined,
      }
    );
    expect(result).toEqual({
      status: "completed",
      sessionId: "sess-existing",
      answer: "continued diagnosis",
    });
  });

  it("returns running when execution exceeds timeout and fetches result later without message", async () => {
    const stream = new SessionResponseStream();
    mocks.startChat.mockImplementation(async () => {
      return { ok: true, stream };
    });

    const client = await startClient(createOpsAgentMcpRouter({ timeoutMs: 20 }));
    const runningResult = readToolPayload(
      await client.callTool({
        name: "send",
        arguments: { sessionId: "sess-long", message: "long running" },
      })
    );

    expect(runningResult).toEqual({
      status: "running",
      sessionId: "sess-long",
    });

    stream.append({ type: "response_end", status: "completed" });
    mocks.hasSession.mockResolvedValue(true);
    mocks.getResponseStream.mockReturnValue(stream);
    mocks.getSessionHistory.mockResolvedValue({
      messages: [{ role: "assistant", content: "eventual answer" }],
    });

    const pollResult = readToolPayload(
      await client.callTool({
        name: "send",
        arguments: { sessionId: "sess-long" },
      })
    );

    expect(pollResult).toEqual({
      status: "completed",
      sessionId: "sess-long",
      answer: "eventual answer",
    });
  });

  it("returns busy error when session is already running", async () => {
    mocks.startChat.mockResolvedValue({
      ok: false,
      status: 409,
      code: "RESPONSE_BUSY",
      error: "Session response already running",
    });

    const client = await startClient(createOpsAgentMcpRouter({ timeoutMs: 1000 }));
    const result = readToolPayload(
      await client.callTool({
        name: "send",
        arguments: { sessionId: "sess-busy", message: "new turn while busy" },
      })
    );

    expect(result).toEqual({
      success: false,
      code: "RESPONSE_BUSY",
      error: "Session response already running",
    });
  });

  it("returns failed when execution fails", async () => {
    const stream = new SessionResponseStream();
    mocks.startChat.mockImplementation(async () => {
      stream.append({
        type: "error",
        error: "Diagnosis agent internal failure",
        timestamp: Date.now(),
      });
      return { ok: true, stream };
    });

    const client = await startClient(createOpsAgentMcpRouter({ timeoutMs: 1000 }));
    const result = readToolPayload(
      await client.callTool({
        name: "send",
        arguments: { sessionId: "sess-failed", message: "trigger failure" },
      })
    );

    expect(result).toEqual({
      status: "failed",
      sessionId: "sess-failed",
      error: "Diagnosis agent internal failure",
    });
  });

  it("returns session not found error when non-existent session is polled without message", async () => {
    mocks.getSessionHistory.mockResolvedValue(undefined);

    const client = await startClient(createOpsAgentMcpRouter({ timeoutMs: 1000 }));
    const result = readToolPayload(
      await client.callTool({
        name: "send",
        arguments: { sessionId: "sess-missing" },
      })
    );

    expect(result).toEqual({
      success: false,
      code: "SESSION_NOT_FOUND",
      error: expect.any(String),
    });
  });

  it("lists the send tool in ops agent tool catalog", async () => {
    const tools = await getOpsAgentMcpToolCatalog();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("send");
  });

  it("includes ops agent service with send tool in /api/mcp/system/tools response", async () => {
    const { default: mcpRouter } = await import("../mcp");
    const app = express();
    app.use("/api/mcp", mcpRouter);
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    servers.push(server);
    const address = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${address.port}/api/mcp/system/tools`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      services: Array<{ mcpUrl: string; tools: Array<{ name: string }> }>;
    };
    const opsService = data.services.find((s) => s.mcpUrl.endsWith("/mcp/ops-agent"));
    expect(opsService).toBeDefined();
    expect(opsService?.tools).toHaveLength(1);
    expect(opsService?.tools[0].name).toBe("send");
  });
});
