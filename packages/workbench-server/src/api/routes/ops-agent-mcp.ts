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
        (stream.status === "cancelled"
          ? tApp("diag.observe.agent.mcp.error.cancelled")
          : tApp("diag.observe.agent.mcp.error.failed")),
    };
  }
  const history = await diagnosisManager.getSessionHistory(sessionId);
  // Session exists because startChat/subscribe succeeded.
  // Assistant message may be absent if the model turn completed without emitting text.
  const lastAssistant = history ? history.messages.filter((m) => m.role === "assistant").pop() : undefined;
  const answer = lastAssistant ? lastAssistant.content : "";
  return { status: "completed" as const, sessionId, answer };
}

function waitForStreamTerminal(
  stream: SessionResponseStream,
  timeoutMs: number
): Promise<{ finished: boolean; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;

    const onFinish = (result: { finished: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (unsubscribe) unsubscribe();
      resolve(result);
    };

    const timer = setTimeout(() => {
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

          if (trimmedMessage) {
            let targetSessionId = trimmedSessionId;
            if (!targetSessionId) {
              const session = await diagnosisManager.createSession({});
              targetSessionId = session.id;
            }
            const started = await diagnosisManager.startChat(
              targetSessionId,
              trimmedMessage,
              {
                domainId: identity.domainId,
                token: identity.token,
                apiKey: identity.apiKey,
              }
            );
            if (!started.ok) {
              return textJson({
                success: false,
                code: started.code,
                error: started.error,
              });
            }
            return textJson(await waitForTurnResult(targetSessionId, started.stream, timeoutMs));
          }

          if (!trimmedSessionId) {
            return textJson({
              success: false,
              code: "INVALID_CHAT_INPUT",
              error: tApp("diag.observe.agent.mcp.error.messageRequired"),
            });
          }

          const stream = diagnosisManager.getResponseStream(trimmedSessionId);
          if (stream) {
            return textJson(await waitForTurnResult(trimmedSessionId, stream, timeoutMs));
          }

          const history = await diagnosisManager.getSessionHistory(trimmedSessionId);
          if (!history) {
            return textJson({
              success: false,
              code: "SESSION_NOT_FOUND",
              error: tApp("diag.observe.agent.mcp.error.sessionNotFound", { p0: trimmedSessionId }),
            });
          }

          if (history.responseStatus === "failed") {
            return textJson({
              status: "failed",
              sessionId: trimmedSessionId,
              error: tApp("diag.observe.agent.mcp.error.failed"),
            });
          }
          if (history.responseStatus === "running") {
            return textJson({ status: "running", sessionId: trimmedSessionId });
          }
          // Assistant message may be absent if the completed turn produced no assistant message.
          const lastAssistant = history.messages.filter((m) => m.role === "assistant").pop();
          const answer = lastAssistant ? lastAssistant.content : "";
          return textJson({ status: "completed", sessionId: trimmedSessionId, answer });
        },
        {
          authorize: (caller) => workbenchIdentity().assertObserveAccess(caller),
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
