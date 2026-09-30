import { Request } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { workbenchIdentity } from "../../identity/installed";
import { workbenchProduct } from "../../product/installed";
import { createLogger } from "../../logging/logger";
import { tApp } from "../../i18n";
import { diagnosisManager } from "../../platform/diagnosis/observe/agent/pi-agent";
import type { SessionResponseStream } from "../../platform/diagnosis/observe/agent/session-stream";
import {
  catalogRequest,
  createStreamableMcpRouter,
  listMcpServerTools,
  textJson,
  withMcpIdentity,
} from "../utils/mcp-route";

export const OPS_AGENT_MCP_TIMEOUT_MS = 50_000;
const logger = createLogger("api:ops-agent-mcp");

async function waitForTurnResult(
  sessionId: string,
  stream: SessionResponseStream,
  timeoutMs: number
) {
  const terminal = await waitForStreamTerminal(stream, timeoutMs);
  if (!terminal.finished) {
    return { status: "running" as const, sessionId };
  }
  if (terminal.error || stream.status === "failed" || stream.status === "cancelled") {
    return {
      status: "failed" as const,
      sessionId,
      error:
        terminal.error ||
        (stream.status === "cancelled" ? "Response cancelled" : "Model response failed"),
    };
  }
  const history = await diagnosisManager.getSessionHistory(sessionId);
  const answer = history?.messages.filter((m) => m.role === "assistant").pop()?.content ?? "";
  return { status: "completed" as const, sessionId, answer };
}

function waitForStreamTerminal(
  stream: SessionResponseStream,
  timeoutMs: number
): Promise<{ finished: boolean; error?: string }> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let unsubscribe: (() => void) | null = null;

    const onFinish = (result: { finished: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (unsubscribe) unsubscribe();
      resolve(result);
    };

    timer = setTimeout(() => {
      onFinish({ finished: false });
    }, timeoutMs);

    unsubscribe = stream.subscribe(0, (buffered) => {
      if (buffered.terminal) {
        const error = buffered.event.type === "error" ? buffered.event.error : undefined;
        onFinish({ finished: true, error });
        return false;
      }
    });
  });
}

export function createOpsAgentMcpServer(
  req: Request,
  timeoutMs: number = OPS_AGENT_MCP_TIMEOUT_MS
) {
  const product = workbenchProduct();
  const server = new McpServer({ name: product.opsMcpServerName, version: "1.0.0" });

  server.registerTool(
    "send",
    {
      title: tApp("diag.observe.agent.mcp.send.title"),
      description: tApp("diag.observe.agent.mcp.send.description"),
      inputSchema: {
        message: z.string().optional().describe(tApp("diag.observe.agent.mcp.send.message")),
        sessionId: z.string().optional().describe(tApp("diag.observe.agent.mcp.send.sessionId")),
      },
    },
    async ({ message, sessionId }) =>
      withMcpIdentity(
        req,
        async (identity) => {
          const trimmedSessionId = sessionId?.trim();
          const trimmedMessage = message?.trim();

          if (!trimmedSessionId) {
            if (!trimmedMessage) {
              return textJson({
                success: false,
                code: "INVALID_CHAT_INPUT",
                error: tApp("diag.observe.agent.mcp.error.messageRequired"),
              });
            }
            const session = await diagnosisManager.createSession({});
            const started = await diagnosisManager.startChat(
              session.id,
              trimmedMessage,
              identity.token,
              identity.domainId
            );
            if (!started.ok) {
              return textJson({
                success: false,
                code: started.code,
                error: started.error,
              });
            }
            return textJson(await waitForTurnResult(session.id, started.stream, timeoutMs));
          }

          if (trimmedMessage) {
            const started = await diagnosisManager.startChat(
              trimmedSessionId,
              trimmedMessage,
              identity.token,
              identity.domainId
            );
            if (!started.ok) {
              return textJson({
                success: false,
                code: started.code,
                error: started.error,
              });
            }
            return textJson(await waitForTurnResult(trimmedSessionId, started.stream, timeoutMs));
          }

          if (!(await diagnosisManager.hasSession(trimmedSessionId))) {
            return textJson({
              success: false,
              code: "SESSION_NOT_FOUND",
              error: tApp("diag.observe.agent.mcp.error.sessionNotFound", { p0: trimmedSessionId }),
            });
          }

          const stream = diagnosisManager.getResponseStream(trimmedSessionId);
          if (stream) {
            return textJson(await waitForTurnResult(trimmedSessionId, stream, timeoutMs));
          }

          const history = await diagnosisManager.getSessionHistory(trimmedSessionId);
          if (history?.responseStatus === "failed") {
            return textJson({
              status: "failed",
              sessionId: trimmedSessionId,
              error: "Model response failed",
            });
          }
          if (history?.responseStatus === "running") {
            return textJson({ status: "running", sessionId: trimmedSessionId });
          }
          const answer =
            history?.messages.filter((m) => m.role === "assistant").pop()?.content ?? "";
          return textJson({ status: "completed", sessionId: trimmedSessionId, answer });
        },
        {
          validateIdentity: (caller) => workbenchIdentity().assertObserveAccess(caller),
        }
      )
  );

  return server;
}

export async function getOpsAgentMcpToolCatalog() {
  return listMcpServerTools(createOpsAgentMcpServer(catalogRequest()), "ops-agent-catalog");
}

export function createOpsAgentMcpRouter(options?: { timeoutMs?: number }) {
  return createStreamableMcpRouter(
    (req) => createOpsAgentMcpServer(req, options?.timeoutMs),
    logger
  );
}

export default createOpsAgentMcpRouter();
