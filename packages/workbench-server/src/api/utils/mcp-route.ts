import { Request, Response, Router } from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpToolDesc } from "@ontomato/contracts/mcp";
import { workbenchIdentity } from "../../identity/installed";
import { runWithLogContext } from "../../logging/log-context";
import type { createLogger } from "../../logging/logger";
import { asyncHandler } from "./http";

export interface McpIdentity {
  userId: string;
  domainId: string;
  token?: string;
  apiKey?: string;
}

export function textJson(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

export interface WithMcpIdentityOptions {
  toolApiKey?: string;
  authorize?: (identity: McpIdentity) => Promise<void>;
}

export async function withMcpIdentity(
  req: Request,
  action: (identity: McpIdentity) => Promise<ReturnType<typeof textJson>>,
  options?: WithMcpIdentityOptions
): Promise<ReturnType<typeof textJson>> {
  let identity: McpIdentity;
  try {
    identity = await workbenchIdentity().resolveMcpCaller(req, options?.toolApiKey);
    if (options?.authorize) {
      await options.authorize(identity);
    }
  } catch (error) {
    return textJson({
      success: false,
      error: error instanceof Error ? error.message : "Authentication failed",
    });
  }
  return runWithLogContext(
    { domainId: identity.domainId, token: identity.token, apiKey: identity.apiKey },
    () => action(identity)
  );
}

export function catalogRequest(): Request {
  return { header: () => "", query: {} } as unknown as Request;
}

export async function listMcpServerTools(
  server: McpServer,
  clientName = "mcp-catalog"
): Promise<McpToolDesc[]> {
  const client = new Client({ name: clientName, version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const { tools } = await client.listTools();
    return tools;
  } finally {
    await client.close();
    await server.close();
  }
}

export function createStreamableMcpRouter(
  createServer: (req: Request) => McpServer,
  logger: ReturnType<typeof createLogger>
): ReturnType<typeof Router> {
  const router: ReturnType<typeof Router> = Router();

  router.post(
    "/",
    asyncHandler(async (req: Request, res: Response) => {
      const server = createServer(req);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        res.on("close", () => {
          transport.close().catch(() => undefined);
          server.close().catch(() => undefined);
        });
      } catch (error) {
        logger.error("MCP request failed", error);
        await transport.close().catch(() => undefined);
        await server.close().catch(() => undefined);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    })
  );

  router.get(
    "/",
    asyncHandler(async (_req: Request, res: Response) => {
      res.status(405).set("Allow", "POST").send("Method Not Allowed");
    })
  );

  router.delete(
    "/",
    asyncHandler(async (_req: Request, res: Response) => {
      res.status(405).set("Allow", "POST").send("Method Not Allowed");
    })
  );

  return router;
}
