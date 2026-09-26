import { startConversationTurn } from "../../services/analysis-agent/task/task-scheduler";
import { randomUUID } from "node:crypto";
import { Request, Response, Router } from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getAnalysisAgentMcpTaskTimeoutMs } from "../../config/mcp";
import { getAnalysisAgentService } from "../../services/analysis-agent/runtime";
import { analysisReportPdfSource } from "../../services/analysis-agent/delivery/report-pdf";
import { getAnalysisTaskService } from "../../services/analysis-agent/task/task-service";
import { startAnalysisTaskRun } from "../../services/analysis-agent/task/task-runner";
import type { AnalysisTask } from "../../services/analysis-agent/task-types";
import {
  analysisAgentPublicServiceRoot,
  analysisReportPdfDownloadUrl,
} from "../../services/mcp/catalog";
import { resolveLocale, setLocale } from "../../i18n";
import { workbenchIdentity } from "../../identity/installed";
import { workbenchProduct } from "../../product/installed";
import { requireOwner } from "../../utils/owner-guard";
import { createLogger } from "../../logging/logger";
import { runWithLogContext } from "../../logging/log-context";
import { asyncHandler } from "../utils/http";

const router: ReturnType<typeof Router> = Router();
const logger = createLogger("api:analysis-agent-mcp");

interface McpIdentity {
  userId: string;
  domainId: string;
  token?: string;
  apiKey?: string;
}

function textJson(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

async function withMcpIdentity(
  req: Request,
  action: (identity: McpIdentity) => Promise<ReturnType<typeof textJson>>,
  toolApiKey?: string
): Promise<ReturnType<typeof textJson>> {
  let identity: McpIdentity;
  try {
    identity = await workbenchIdentity().resolveMcpCaller(req, toolApiKey);
  } catch (error) {
    return textJson({
      success: false,
      error: error instanceof Error ? error.message : "Authentication failed",
    });
  }
  return runWithLogContext({ domainId: identity.domainId }, () => action(identity));
}

function taskToMcpResult(task: AnalysisTask) {
  return {
    id: task.id,
    agentId: task.agentId,
    userId: task.userId,
    name: task.name,
    status: task.status,
    threadId: task.threadId,
    question: task.question,
    resultSummary: task.resultSummary,
    resultReport: task.resultReport,
    reportDeliverableEnabled: task.reportDeliverableEnabled,
    finalAnswer: task.analysisPayload?.finalAnswer,
    triggerSource: task.triggerSource,
    lastRunAt: task.lastRunAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function catalogRequest(): Request {
  return { header: () => "", query: {} } as unknown as Request;
}

function createAnalysisAgentMcpServer(req: Request) {
  const product = workbenchProduct();
  const server = new McpServer({ name: product.analysisMcpServerName, version: "1.0.0" });

  server.registerTool(
    "list_analysis_agents",
    {
      title: "List Agents",
      description: `List enabled agents in ${product.serviceDisplayName} that can analyze business questions.`,
      inputSchema: {},
    },
    async () =>
      withMcpIdentity(req, async (identity) => {
        const service = await getAnalysisAgentService();
        const agents = await service.getEnabledAgents(identity.domainId);
        return textJson({
          agents: agents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            description: agent.description,
            icon: agent.icon,
            enabledSkillIds: agent.enabledSkillIds || [],
            enabledVisualizationSkillIds: agent.enabledVisualizationSkillIds || [],
          })),
        });
      })
  );

  server.registerTool(
    "get_analysis_task",
    {
      title: "Get Analysis Task",
      description: "Get a previously created analysis task and its result by task ID.",
      inputSchema: {
        taskId: z.string().min(1).describe("Analysis task ID returned by run_analysis."),
      },
    },
    async ({ taskId }) =>
      withMcpIdentity(req, async (identity) => {
        const task = await getAnalysisTaskService().getTask(taskId, identity.domainId);
        if (
          !task ||
          !requireOwner(task.userId, identity.userId) ||
          task.domainId !== identity.domainId
        ) {
          return textJson({ success: false, error: `Analysis task not found: ${taskId}` });
        }

        return textJson({ success: true, task: taskToMcpResult(task) });
      })
  );

  server.registerTool(
    "get_analysis_report_pdf",
    {
      title: "Get Analysis Report PDF",
      description:
        "Return a download URL for the PDF of this task's latest run report. For authenticated MCP connections, send the same x-api-key or tk header when downloading; anonymous connections do not require credentials. Only report tasks that already have report body text can be downloaded.",
      inputSchema: {
        taskId: z.string().min(1).describe("Analysis task ID returned by run_analysis."),
      },
    },
    async ({ taskId }) =>
      withMcpIdentity(req, async (identity) => {
        const task = await getAnalysisTaskService().getTask(taskId, identity.domainId);
        if (
          !task ||
          !requireOwner(task.userId, identity.userId) ||
          task.domainId !== identity.domainId
        ) {
          return textJson({ success: false, error: `Analysis task not found: ${taskId}` });
        }
        const source = analysisReportPdfSource({ task });
        if (!source) {
          return textJson({ success: false, error: "No analysis report to export" });
        }
        return textJson({
          success: true,
          downloadUrl: analysisReportPdfDownloadUrl(analysisAgentPublicServiceRoot(req), task.id),
        });
      })
  );

  server.registerTool(
    "run_analysis",
    {
      title: "Run Analysis",
      description:
        `Submit a ${product.serviceDisplayName} deep analysis task with a selected agent. Use get_analysis_task to poll results.`,
      inputSchema: {
        agentId: z.string().min(1).describe("Analysis agent ID from list_analysis_agents."),
        question: z.string().min(1).describe("Business question to analyze."),
        threadId: z
          .string()
          .optional()
          .describe("Optional thread ID for conversation persistence."),
        apiKey: z
          .string()
          .min(1)
          .optional()
          .describe(
            "User API key. May instead be supplied through the x-api-key header, the apiKey query, or a tk login token header."
          ),
        locale: z.string().optional().describe("Optional locale, for example zh-CN or en-US."),
      },
    },
    async ({ agentId, question, threadId, apiKey, locale }) => {
      const normalizedQuestion = question.trim();
      const normalizedAgentId = agentId.trim();
      const resolvedThreadId = threadId?.trim() || `mcp-analysis-${Date.now()}-${randomUUID()}`;
      setLocale(resolveLocale(locale?.trim()));

      return withMcpIdentity(req, async (identity) => {
        const agentService = await getAnalysisAgentService();
        const agent = await agentService.getAgent(normalizedAgentId, identity.domainId);
        if (!agent || !agent.isEnabled) {
          return textJson({
            success: false,
            error: `Enabled agent not found: ${normalizedAgentId}`,
          });
        }

        const taskService = getAnalysisTaskService();
        const task = await taskService.createTask({
          reportDeliverableEnabled: agent.reportDeliverableEnabled,
          agentId: normalizedAgentId,
          userId: identity.userId,
          domainId: identity.domainId,
          name: normalizedQuestion.slice(0, 50) || "MCP Analysis",
          question: normalizedQuestion,
          threadId: resolvedThreadId,
          triggerSource: "manual",
          token: identity.token,
        });

        // 关闭报告交付的智能体按常规会话受理首轮；其余提交即返回，运行与终态由编排器负责。
        if (agent.reportDeliverableEnabled === false) {
          const requestSeq = await startConversationTurn(
            task.id,
            identity.domainId,
            normalizedQuestion,
            { token: identity.token, apiKey: identity.apiKey }
          );
          if (requestSeq === null) {
            return textJson({ success: false, error: "Analysis session is already running" });
          }
          return textJson({
            success: true,
            task: { ...taskToMcpResult(task), status: "running", requestSeq },
          });
        }

        // 报告任务按一次运行受理；受理失败说明同一任务已在运行。
        const runTask = await taskService.tryStartTask(task.id, identity.domainId);
        if (!runTask) {
          return textJson({ success: false, error: "Analysis task is already running" });
        }

        const { task: runningTask } = await startAnalysisTaskRun({
          task: runTask,
          agent,
          verifiedIdentity: identity,
          apiKey: identity.apiKey,
          timeoutMs: getAnalysisAgentMcpTaskTimeoutMs(),
        });

        return textJson({
          success: true,
          message: "Analysis task submitted. Use get_analysis_task to poll status and results.",
          task: taskToMcpResult(runningTask),
        });
      }, apiKey?.trim());
    }
  );

  return server;
}

/** 管理页目录直接投影实际 MCP 注册使用的 Zod 定义，不再维护 JSON Schema 手抄本。 */
export async function getAnalysisAgentMcpToolCatalog() {
  const server = createAnalysisAgentMcpServer(catalogRequest());
  const client = new Client({ name: "analysis-agent-catalog", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const { tools } = await client.listTools();
    return tools.sort(
      (left, right) =>
        Number(left.name === "get_analysis_task") - Number(right.name === "get_analysis_task")
    );
  } finally {
    await client.close();
    await server.close();
  }
}

router.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const server = createAnalysisAgentMcpServer(req);
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

export default router;
