import { startConversationTurn } from "../../services/analysis-agent/task/task-scheduler";
import { randomUUID } from "node:crypto";
import { Request } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
import { workbenchProduct } from "../../product/installed";
import { requireOwner } from "../../utils/owner-guard";
import { createLogger } from "../../logging/logger";
import {
  catalogRequest,
  createStreamableMcpRouter,
  listMcpServerTools,
  textJson,
  withMcpIdentity,
} from "../utils/mcp-route";

const logger = createLogger("api:analysis-agent-mcp");

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

        // An agent with report delivery off accepts its first turn like a regular session; other submissions return immediately, with the run and terminal state owned by the orchestrator.
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

        // A report task is accepted as one run; an acceptance failure means the same task is already running.
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
      }, { toolApiKey: apiKey?.trim() });
    }
  );

  return server;
}

/** The admin page catalog projects the Zod definitions actually used for MCP registration; no hand-copied JSON Schema is maintained anymore. */
export async function getAnalysisAgentMcpToolCatalog() {
  const tools = await listMcpServerTools(
    createAnalysisAgentMcpServer(catalogRequest()),
    "analysis-agent-catalog"
  );
  return tools.sort(
    (left, right) =>
      Number(left.name === "get_analysis_task") - Number(right.name === "get_analysis_task")
  );
}

export default createStreamableMcpRouter(createAnalysisAgentMcpServer, logger);

