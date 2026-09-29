import type { RunNotFoundEvent } from "@ontomato/contracts/chat";
import type { AnalysisRunEvent, AnalysisFollowUpEvent } from "@ontomato/contracts/analysis-events";
import { Router, Request, Response } from "express";
import { getCheckpointer } from "../../infrastructure/connection";
import { getAnalysisAgentService } from "../../services/analysis-agent/runtime";
import { createLogger } from "../../logging/logger";
import { AuthFailedError } from "../../utils/backend-client";
import { createSseErrorEvent, initializeSse, writeSseError } from "../../utils/sse";
import { runStreamStore, requireRunAccess } from "../utils/run-stream";
import { taskEventBus } from "../../services/analysis-agent/task/task-event-bus";
import { requireDomainId, type AuthenticatedRequest } from "../../utils/request-identity";
import { generateTitleAsync } from "../utils/title";
import { setLocale, t, tApp, type Locale } from "../../i18n";
import { getAnalysisTaskService } from "../../services/analysis-agent/task/task-service";
import { startAnalysisTaskRun } from "../../services/analysis-agent/task/task-runner";
import { runAnalysisFollowUp } from "../../services/analysis-agent/follow-up";
import {
  ANALYSIS_AGENT_EXECUTION_MODES,
  ANALYSIS_REPORT_SUMMARY_POSITIONS,
  DEFAULT_ANALYSIS_AGENT_EXECUTION_MODE,
  isAnalysisAgentExecutionMode,
  isAnalysisReportSummaryPosition,
} from "../../services/analysis-agent/config/agent-types";
import { InvalidAgentSkillSelectionError } from "../../services/analysis-agent/config/agent-service";
import { getAnalysisDimensionService } from "../../services/analysis-agent/config/dimension-service";
import { listAgentHotReports } from "../../services/analysis-agent/hot-card/analysis-report-hot-cards";

import { asyncHandler } from "../utils/http";
import { HttpError } from "../../utils/errors";
import { runtimeDefaults } from "../../runtime/defaults";

const logger = createLogger("api:analysis-agents");
const router: ReturnType<typeof Router> = Router();

const INVALID_EXECUTION_MODE_ERROR = `executionMode must be one of: ${ANALYSIS_AGENT_EXECUTION_MODES.join(", ")}`;

function deepAnalysisRunKey(threadId: string): string {
  return `analysis-deep:${threadId}`;
}

function followUpRunKey(threadId: string): string {
  return `analysis-follow-up:${threadId}`;
}

function sendRunNotFound(res: Response) {
  initializeSse(res);
  res.write(
    `data: ${JSON.stringify({
      type: "run_not_found",
      timestamp: Date.now(),
    } satisfies RunNotFoundEvent)}\n\n`
  );
  res.end();
}

// ==================== Analysis Agent CRUD ====================

/**
 * GET /api/analysis-agents
 * Lists all analysis agents
 */
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const service = await getAnalysisAgentService();
    const agents = await service.listAgents((req as AuthenticatedRequest).domainId);
    res.json({ success: true, data: agents });
  })
);

/**
 * GET /api/analysis-agents/enabled
 * Lists enabled analysis agents
 */
router.get(
  "/enabled",
  asyncHandler(async (req: Request, res: Response) => {
    const service = await getAnalysisAgentService();
    const agents = await service.getEnabledAgents((req as AuthenticatedRequest).domainId);
    res.json({ success: true, data: agents });
  })
);

/**
 * GET /api/analysis-agents/:id
 * Gets one analysis agent's details
 */
router.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const service = await getAnalysisAgentService();
    const agent = await service.getAgent(req.params.id, (req as AuthenticatedRequest).domainId);

    if (!agent) {
      throw new HttpError(404, t("api.analysisAgentNotFound"));
    }

    res.json({ success: true, data: agent });
  })
);

/**
 * POST /api/analysis-agents
 * Creates an analysis agent
 */
router.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const domainId = (req as AuthenticatedRequest).domainId;
      if (!domainId) {
        throw new HttpError(400, "domainId is required");
      }
      const {
        name,
        description,
        icon,
        executionMode,
        loopPrompt,
        reportDeliverableEnabled,
        hotReportEnabled,
        summaryPosition,
        analysisDimensionPrompt,
        summarizerPrompt,
        conclusionMakerPrompt,
        enabledSkillIds,
        enabledVisualizationSkillIds,
        enabledMcpServiceNames,
        classNames,
        isEnabled,
        sortOrder,
      } = req.body;

      if (executionMode !== undefined && !isAnalysisAgentExecutionMode(executionMode)) {
        throw new HttpError(400, INVALID_EXECUTION_MODE_ERROR);
      }
      const resolvedExecutionMode = executionMode ?? DEFAULT_ANALYSIS_AGENT_EXECUTION_MODE;

      if (
        !name ||
        (resolvedExecutionMode === "dimension" && (!summarizerPrompt || !conclusionMakerPrompt))
      ) {
        throw new HttpError(
          400,
          t("api.missingRequiredFields", {
            fields:
              resolvedExecutionMode === "dimension"
                ? "name, summarizerPrompt, conclusionMakerPrompt"
                : "name",
          })
        );
      }

      if (reportDeliverableEnabled !== undefined && typeof reportDeliverableEnabled !== "boolean") {
        throw new HttpError(400, "reportDeliverableEnabled must be a boolean");
      }
      if (hotReportEnabled !== undefined && typeof hotReportEnabled !== "boolean") {
        throw new HttpError(400, "hotReportEnabled must be a boolean");
      }
      if (summaryPosition !== undefined && !isAnalysisReportSummaryPosition(summaryPosition)) {
        throw new HttpError(
          400,
          `summaryPosition must be one of: ${ANALYSIS_REPORT_SUMMARY_POSITIONS.join(", ")}`
        );
      }
      // With report delivery off only the loop form can be selected: regular sessions execute turn by turn in loop form.
      if (reportDeliverableEnabled === false && resolvedExecutionMode !== "loop") {
        throw new HttpError(400, "Normal Harness requires loop execution");
      }
      if (
        enabledMcpServiceNames !== undefined &&
        (!Array.isArray(enabledMcpServiceNames) ||
          enabledMcpServiceNames.some((name: unknown) => typeof name !== "string" || !name.trim()))
      ) {
        throw new HttpError(400, "enabledMcpServiceNames must be a string array");
      }

      const service = await getAnalysisAgentService();
      const agent = await service.createAgent(
        {
          name,
          description: description || "",
          icon,
          executionMode: resolvedExecutionMode,
          loopPrompt: loopPrompt || "",
          reportDeliverableEnabled: reportDeliverableEnabled ?? true,
          hotReportEnabled: hotReportEnabled ?? true,
          summaryPosition,
          analysisDimensionPrompt: analysisDimensionPrompt || "",
          summarizerPrompt,
          conclusionMakerPrompt,
          enabledSkillIds,
          enabledVisualizationSkillIds,
          enabledMcpServiceNames: enabledMcpServiceNames ?? [],
          classNames: Array.isArray(classNames) ? classNames : [],
          isEnabled: isEnabled !== false,
          sortOrder: sortOrder ?? 0,
        },
        domainId
      );

      logger.info(tApp("analysis.config.agent-service.3", { id: agent.id, name: agent.name }));
      res.status(201).json({ success: true, data: agent });
    } catch (error) {
      logger.error(tApp("analysis.log.agents.createFailed"), error);
      if (error instanceof InvalidAgentSkillSelectionError) {
        throw new HttpError(400, error.message, error.code);
      }
      throw error;
    }
  })
);

/**
 * PUT /api/analysis-agents/:id
 * Updates an analysis agent
 */
router.put(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { executionMode, reportDeliverableEnabled, hotReportEnabled, summaryPosition, enabledMcpServiceNames } =
        req.body ?? {};
      if (executionMode !== undefined && !isAnalysisAgentExecutionMode(executionMode)) {
        throw new HttpError(400, INVALID_EXECUTION_MODE_ERROR);
      }
      if (reportDeliverableEnabled !== undefined && typeof reportDeliverableEnabled !== "boolean") {
        throw new HttpError(400, "reportDeliverableEnabled must be a boolean");
      }
      if (hotReportEnabled !== undefined && typeof hotReportEnabled !== "boolean") {
        throw new HttpError(400, "hotReportEnabled must be a boolean");
      }
      if (summaryPosition !== undefined && !isAnalysisReportSummaryPosition(summaryPosition)) {
        throw new HttpError(
          400,
          `summaryPosition must be one of: ${ANALYSIS_REPORT_SUMMARY_POSITIONS.join(", ")}`
        );
      }
      if (
        enabledMcpServiceNames !== undefined &&
        (!Array.isArray(enabledMcpServiceNames) ||
          enabledMcpServiceNames.some((name: unknown) => typeof name !== "string" || !name.trim()))
      ) {
        throw new HttpError(400, "enabledMcpServiceNames must be a string array");
      }

      const service = await getAnalysisAgentService();
      const existing = await service.getAgent(
        req.params.id,
        (req as AuthenticatedRequest).domainId
      );
      if (!existing) {
        throw new HttpError(404, t("api.analysisAgentNotFound"));
      }
      // With report delivery off only the loop form can be selected: decided by the effective configuration after this update.
      if (
        (reportDeliverableEnabled ?? existing.reportDeliverableEnabled) === false &&
        (executionMode ?? existing.executionMode) !== "loop"
      ) {
        throw new HttpError(400, "Normal Harness requires loop execution");
      }
      const agent = await service.updateAgent(
        req.params.id,
        req.body,
        (req as AuthenticatedRequest).domainId
      );

      if (!agent) {
        throw new HttpError(404, t("api.analysisAgentNotFound"));
      }

      res.json({ success: true, data: agent });
    } catch (error) {
      logger.error(tApp("analysis.log.agents.updateFailed"), error);
      if (error instanceof InvalidAgentSkillSelectionError) {
        throw new HttpError(400, error.message, error.code);
      }
      throw error;
    }
  })
);

/**
 * DELETE /api/analysis-agents/:id
 * Deletes an analysis agent
 */
router.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const service = await getAnalysisAgentService();
    const deleted = await service.deleteAgent(
      req.params.id,
      (req as AuthenticatedRequest).domainId
    );

    if (!deleted) {
      throw new HttpError(404, t("api.analysisAgentNotFound"));
    }

    res.json({ success: true });
  })
);

// ==================== Dimension CRUD ====================

/**
 * GET /api/analysis-agents/:agentId/hot-reports
 * Lists the agent's hot report cards (published and disabled) so the agent edit dialog can enable/disable them
 */
router.get(
  "/:agentId/hot-reports",
  asyncHandler(async (req: Request, res: Response) => {
    const service = await getAnalysisAgentService();
    const domainId = (req as AuthenticatedRequest).domainId;
    if (!(await service.getAgent(req.params.agentId, domainId))) {
      throw new HttpError(404, t("api.analysisAgentNotFound"));
    }
    const cards = await listAgentHotReports({ agentId: req.params.agentId, domainId });
    res.json({ success: true, data: cards });
  })
);

/**
 * GET /api/analysis-agents/:agentId/dimensions
 * Lists an analysis agent's dimensions
 */
router.get(
  "/:agentId/dimensions",
  asyncHandler(async (req: Request, res: Response) => {
    const service = await getAnalysisAgentService();
    const domainId = (req as AuthenticatedRequest).domainId;
    if (!(await service.getAgent(req.params.agentId, domainId))) {
      throw new HttpError(404, t("api.analysisAgentNotFound"));
    }
    const dimensions = await getAnalysisDimensionService().listDimensions(
      req.params.agentId,
      domainId
    );
    res.json({ success: true, data: dimensions });
  })
);

/**
 * GET /api/analysis-agents/:agentId/dimensions/enabled
 * Lists enabled dimensions
 */
router.get(
  "/:agentId/dimensions/enabled",
  asyncHandler(async (req: Request, res: Response) => {
    const service = await getAnalysisAgentService();
    const domainId = (req as AuthenticatedRequest).domainId;
    if (!(await service.getAgent(req.params.agentId, domainId))) {
      throw new HttpError(404, t("api.analysisAgentNotFound"));
    }
    const dimensions = await getAnalysisDimensionService().getEnabledDimensions(
      req.params.agentId,
      domainId
    );
    res.json({ success: true, data: dimensions });
  })
);

/**
 * POST /api/analysis-agents/:agentId/dimensions
 * Creates a dimension
 */
router.post(
  "/:agentId/dimensions",
  asyncHandler(async (req: Request, res: Response) => {
    const domainId = (req as AuthenticatedRequest).domainId;
    if (!domainId) {
      throw new HttpError(400, "domainId is required");
    }
    const {
      name,
      dimensionType,
      values,
      valueSource,
      datasetField,
      subQuestionTemplate,
      order,
      isEnabled,
    } = req.body;

    if (!name || !dimensionType || !subQuestionTemplate) {
      throw new HttpError(
        400,
        t("api.missingRequiredFields", {
          fields: "name, dimensionType, subQuestionTemplate",
        })
      );
    }

    // Validate the dimension configuration
    const validation = getAnalysisDimensionService().validateDimension({
      id: "temp",
      agentId: req.params.agentId,
      name,
      dimensionType,
      values,
      valueSource: valueSource || "static",
      datasetField,
      subQuestionTemplate,
      order,
      isEnabled: isEnabled !== false,
      createdAt: 0,
      updatedAt: 0,
    });

    if (!validation.valid) {
      throw new HttpError(400, validation.errors.join(", "));
    }

    const service = await getAnalysisAgentService();
    if (!(await service.getAgent(req.params.agentId, domainId))) {
      throw new HttpError(404, t("api.analysisAgentNotFound"));
    }
    const dimension = await getAnalysisDimensionService().createDimension(
      {
        agentId: req.params.agentId,
        name,
        dimensionType,
        values,
        valueSource: valueSource || "static",
        datasetField,
        subQuestionTemplate,
        order: order || 0,
        isEnabled: isEnabled !== false,
      },
      domainId
    );

    logger.info(
      tApp("analysis.config.dimension-service.12", {
        id: dimension.id,
        name: dimension.name,
        agentId: req.params.agentId,
      })
    );
    res.status(201).json({ success: true, data: dimension });
  })
);

/**
 * PUT /api/dimensions/:id
 * Updates a dimension
 */
router.put(
  "/dimensions/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const dimension = await getAnalysisDimensionService().updateDimension(
      req.params.id,
      req.body,
      (req as AuthenticatedRequest).domainId
    );

    if (!dimension) {
      throw new HttpError(404, t("api.dimensionNotFound"));
    }

    res.json({ success: true, data: dimension });
  })
);

/**
 * DELETE /api/dimensions/:id
 * Deletes a dimension
 */
router.delete(
  "/dimensions/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const deleted = await getAnalysisDimensionService().deleteDimension(
      req.params.id,
      (req as AuthenticatedRequest).domainId
    );

    if (!deleted) {
      throw new HttpError(404, t("api.dimensionNotFound"));
    }

    res.json({ success: true });
  })
);

// ==================== Deep Analysis Execution ====================

router.post(
  "/chat/deep-analysis/:threadId/cancel",
  asyncHandler(async (req: Request, res: Response) => {
    const threadId = String(req.params.threadId || "").trim();
    const runId = String(req.query.runId || req.body?.runId || "").trim();
    const run = runId
      ? runStreamStore.getRun(runId)
      : runStreamStore.getActiveRunByKey(deepAnalysisRunKey(threadId));
    if (run) requireRunAccess(run, req as AuthenticatedRequest, deepAnalysisRunKey(threadId));
    res.json({
      success: true,
      cancelled: run ? runStreamStore.cancelByRunId(run.id) : false,
    });
  })
);

router.post(
  "/chat/follow-up/:threadId/cancel",
  asyncHandler(async (req: Request, res: Response) => {
    const threadId = String(req.params.threadId || "").trim();
    const runId = String(req.query.runId || req.body?.runId || "").trim();
    const run = runId
      ? runStreamStore.getRun(runId)
      : runStreamStore.getActiveRunByKey(followUpRunKey(threadId));
    if (run) requireRunAccess(run, req as AuthenticatedRequest, followUpRunKey(threadId));
    res.json({
      success: true,
      cancelled: run ? runStreamStore.cancelByRunId(run.id) : false,
    });
  })
);

router.get(
  "/chat/deep-analysis/:threadId/stream",
  asyncHandler(async (req: Request, res: Response) => {
    const threadId = String(req.params.threadId || "").trim();
    const run =
      runStreamStore.getActiveRunByKey(deepAnalysisRunKey(threadId)) ||
      runStreamStore.getRetainedRunByKey(deepAnalysisRunKey(threadId));
    if (!run) {
      sendRunNotFound(res);
      return;
    }
    runStreamStore.subscribe(req, res, run);
  })
);

router.get(
  "/chat/follow-up/:threadId/stream",
  asyncHandler(async (req: Request, res: Response) => {
    const threadId = String(req.params.threadId || "").trim();
    const run =
      runStreamStore.getActiveRunByKey(followUpRunKey(threadId)) ||
      runStreamStore.getRetainedRunByKey(followUpRunKey(threadId));
    if (!run) {
      sendRunNotFound(res);
      return;
    }
    runStreamStore.subscribe(req, res, run);
  })
);

/**
 * GET /api/chat/deep-analysis
 * SSE streaming deep-analysis endpoint
 */
router.get(
  "/chat/deep-analysis",
  asyncHandler(async (req: Request, res: Response) => {
    const message = String(req.query.message || "").trim();
    const threadId = String(req.query.threadId || `thread-${Date.now()}`);
    const agentId = String(req.query.agentId || "").trim();
    const authReq = req as AuthenticatedRequest;
    const domainId = requireDomainId(authReq);
    const userId = authReq.userId;
    const token = authReq.token;
    const locale = String(req.query.locale || runtimeDefaults().requestLocaleFallback) as Locale;
    const runId = String(req.query.runId || `analysis-deep-${threadId}-${Date.now()}`);
    setLocale(locale);

    if (!message) {
      throw new HttpError(400, "message is required");
    }

    if (!agentId) {
      throw new HttpError(400, "agentId is required");
    }

    if (!domainId) {
      throw new HttpError(400, "domainId is required");
    }

    const agentService = await getAnalysisAgentService();
    const agent = await agentService.getAgent(agentId, domainId);
    if (!agent) {
      throw new HttpError(404, t("api.analysisAgentNotFound"));
    }

    logger.info(tApp("analysis.log.agents.deepParams"), {
      threadId,
      userId,
      agentId,
      messageLength: message.length,
      hasToken: !!token,
    });

    // A run matching the same runId (running, or completed and retained), or the thread's current active run → replay instead of re-running
    const existingRun =
      runStreamStore.getRun(runId) ||
      runStreamStore.getActiveRunByKey(deepAnalysisRunKey(threadId));
    if (existingRun) {
      requireRunAccess(existingRun, req as AuthenticatedRequest, deepAnalysisRunKey(threadId));
      runStreamStore.subscribe(req, res, existingRun);
      return;
    }

    const taskService = getAnalysisTaskService();
    let task;
    try {
      task = await taskService.createTask({
        reportDeliverableEnabled: agent.reportDeliverableEnabled,
        agentId,
        userId,
        domainId,
        name: message.slice(0, 50) || tApp("analysis.task.deepName"),
        question: message,
        threadId,
        triggerSource: "manual",
        token,
      });
    } catch (error) {
      logger.error(tApp("analysis.task.deepCreateFailed"), {
        threadId,
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof HttpError) throw error;
      throw new HttpError(500, tApp("analysis.task.deepCreateFailed"));
    }
    // An agent with report delivery off accepts this turn like a regular session; a report task is accepted as one run.
    // Both acceptances complete before startup, and a running task can never be accepted concurrently.
    const claimedTurn =
      agent.reportDeliverableEnabled === false
        ? await taskService.claimConversationTurn(task.id, message)
        : undefined;
    if (agent.reportDeliverableEnabled === false && !claimedTurn) {
      throw new HttpError(409, t("api.taskIsRunning"));
    }
    const conversationTurn = claimedTurn ?? undefined;
    const runTask =
      agent.reportDeliverableEnabled === false
        ? task
        : await taskService.tryStartTask(task.id, domainId);
    if (!runTask) {
      throw new HttpError(409, t("api.taskIsRunning"));
    }
    const run = runStreamStore.startRun({
      runId,
      key: deepAnalysisRunKey(threadId),
      userId,
      domainId,
    });
    runStreamStore.subscribe(req, res, run);

    runStreamStore.appendJson(run.id, {
      type: "run_started",
      runId: run.id,
      taskId: task.id,
      threadId,
      timestamp: Date.now(),
    } satisfies AnalysisRunEvent);

    // Execution events all travel over the task channel; the page stream subscribes to the channel and merges into this run, while run protocol events are still emitted by this route.
    const stopSubscription = taskEventBus.subscribe(task.id, (event) => {
      const { _seq, ...payload } = event;
      void _seq;
      runStreamStore.appendJson(run.id, payload, payload.type === "task_cancelled");
    });
    try {
      const { completion } = await startAnalysisTaskRun({
        task: runTask,
        agent,
        verifiedIdentity: authReq,
        cancelSignal: run.controller.signal,
        conversationTurn,
      });

      generateTitleAsync(message, threadId, userId, domainId).then((title) => {
        if (title) {
          runStreamStore.appendJson(run.id, { type: "title", title } satisfies AnalysisRunEvent);
        }
      });

      const outcome = await completion;

      if (outcome.status === "cancelled") {
        logger.info(tApp("analysis.log.agents.deepCancelled"), { threadId, agentId });
        runStreamStore.finishRun(run.id, "cancelled");
        return;
      }

      if (outcome.status === "failed") {
        const failureEvent: AnalysisRunEvent =
          outcome.error instanceof AuthFailedError
            ? { type: "auth_failed", content: outcome.error.message, timestamp: Date.now() }
            : createSseErrorEvent(outcome.error);
        runStreamStore.appendJson(run.id, failureEvent, true);
        runStreamStore.finishRun(run.id, "failed");
        return;
      }

      runStreamStore.appendJson(
        run.id,
        {
          type: "workflow_complete",
          timestamp: Date.now(),
        } satisfies AnalysisRunEvent,
        true
      );
      runStreamStore.finishRun(run.id, "completed");

      logger.info(tApp("analysis.log.agents.deepCompleted"), {
        threadId,
        agentId,
        taskId: task.id,
      });
    } catch (error) {
      logger.error(tApp("analysis.log.agents.deepStartFailed"), {
        threadId,
        agentId,
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.writableEnded) {
        writeSseError(res, error);
        res.end();
      }
      runStreamStore.finishRun(run.id, "failed");
    } finally {
      stopSubscription();
    }
  })
);

/**
 * GET /api/chat/follow-up
 * SSE streaming follow-up endpoint: reuses existing analysis results as context instead of re-running the full analysis flow
 */
router.get(
  "/chat/follow-up",
  asyncHandler(async (req: Request, res: Response) => {
    const message = String(req.query.message || "").trim();
    const threadId = String(req.query.threadId || `thread-${Date.now()}`);
    const agentId = String(req.query.agentId || "").trim();
    const userId = (req as AuthenticatedRequest).userId;
    const domainId = requireDomainId(req as AuthenticatedRequest);
    const locale = String(req.query.locale || runtimeDefaults().requestLocaleFallback) as Locale;
    const runId = String(req.query.runId || `analysis-follow-up-${threadId}-${Date.now()}`);
    setLocale(locale);

    if (!message) {
      throw new HttpError(400, "message is required");
    }

    if (!threadId) {
      throw new HttpError(400, "threadId is required");
    }
    const checkpointer = getCheckpointer();
    if (!checkpointer) throw new HttpError(500, t("api.checkpointerNotInitialized"));
    await checkpointer.verifyThreadAccess(threadId, userId, domainId);

    logger.info(tApp("analysis.log.agents.followupParams"), {
      threadId,
      userId,
      agentId,
      messageLength: message.length,
    });

    // A run matching the same runId (running, or completed and retained), or the thread's current active run → replay instead of re-running
    const existingRun =
      runStreamStore.getRun(runId) || runStreamStore.getActiveRunByKey(followUpRunKey(threadId));
    if (existingRun) {
      requireRunAccess(existingRun, req as AuthenticatedRequest, followUpRunKey(threadId));
      runStreamStore.subscribe(req, res, existingRun);
      return;
    }

    const run = runStreamStore.startRun({
      runId,
      key: followUpRunKey(threadId),
      userId,
      domainId,
    });
    runStreamStore.subscribe(req, res, run);

    runStreamStore.appendJson(run.id, {
      type: "run_started",
      runId: run.id,
      threadId,
      timestamp: Date.now(),
    } satisfies AnalysisFollowUpEvent);

    await runAnalysisFollowUp(message, threadId, agentId, run, runStreamStore);
  })
);

export default router;
