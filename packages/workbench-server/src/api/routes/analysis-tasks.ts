import type { SseHeartbeatData } from "@ontomato/contracts/sse";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { createLogger } from "../../logging/logger";
import { getAnalysisTaskService } from "../../services/analysis-agent/task/task-service";
import {
  getAnalysisScheduleRuleService,
  toScheduleRuleTask,
  type AnalysisScheduleRule,
} from "../../services/analysis-agent/task/schedule-rules";
import { buildDeepAnalysisTaskSnapshot } from "../../services/analysis-agent/task/task-result";
import {
  executeTask,
  startConversationTurn,
  triggerScheduleRule,
} from "../../services/analysis-agent/task/task-scheduler";
import { cancelAnalysisTaskRun } from "../../services/analysis-agent/task/task-runner";
import { currentAnalysisRunId } from "../../services/analysis-agent/task/run-history";
import { getAnalysisAgentService } from "../../services/analysis-agent/runtime";
import { taskEventBus } from "../../services/analysis-agent/task/task-event-bus";
import { initializeSse, writeSseError } from "../../utils/sse";
import { t, tApp } from "../../i18n";
import { requireOwner } from "../../utils/owner-guard";
import { validateBody } from "../middleware";
import { requireDomainId, type AuthenticatedRequest } from "../../utils/request-identity";
import { type AnalysisTask } from "../../services/analysis-agent/task-types";
import type { EgressMessage } from "@ontomato/contracts/agent-egress";
import type { AnalysisConversationTurnRecord } from "../../services/analysis-agent/task/conversation-types";
import { toEgressMessages } from "../../core/agent-loop/index";
import {
  buildAnalysisTaskTerminalEvent,
  isAnalysisTaskLifecycleEvent,
  isAnalysisTaskTerminalStatus,
} from "../../services/analysis-agent/task/events";
import { listChatRenderSnapshots } from "../../services/chat/chat-snapshot-store";
import {
  attachQuestionExecution,
  buildTaskProvenance,
  toClientTask,
  toSubagentAuditEgress,
} from "../../services/analysis-agent/task/task-read-model";
import {
  analysisReportPdfSource,
  exportAnalysisReportPdf,
} from "../../services/analysis-agent/delivery/report-pdf";
import { asyncHandler, buildAttachmentContentDisposition } from "../utils/http";
import { HttpError } from "../../utils/errors";

const logger = createLogger("api:analysis-tasks");
const router: ReturnType<typeof Router> = Router();

function subscribeToTaskStream(
  taskId: string,
  res: Response,
  heartbeatInterval: ReturnType<typeof setInterval>,
  since = 0,
  requestSeq?: number
): () => void {
  return taskEventBus.subscribe(
    taskId,
    (event) => {
      try {
        const seq = Number(event?._seq);
        const payload = { ...event };
        delete payload._seq;
        if (Number.isFinite(seq)) {
          res.write(`id: ${seq}\n`);
        }
        res.write(`data: ${JSON.stringify(payload)}\n\n`);

        // Task status events are emitted only for terminal states; receiving one ends this subscription.
        if (isAnalysisTaskLifecycleEvent(event)) {
          clearInterval(heartbeatInterval);
          res.end();
        }
      } catch {
        clearInterval(heartbeatInterval);
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
    },
    { since, requestSeq }
  );
}

/** The exit view omits only supervisor/worker internal thinking; probing result bodies are replaced separately under the analysis domain's policy. */
function toVisibleMessages(messages: Parameters<typeof toEgressMessages>[0]): EgressMessage[] {
  return toEgressMessages(messages, { thinking: "omit", toolResultContent: "full" }).map(
    (message) =>
      message.role === "toolResult" &&
      (message.toolName === "probe_classes" || message.toolName === "probe_class_data")
        ? { ...message, content: [{ type: "text" as const, text: tApp("analysis.task.probeOmission") }] }
        : message
  );
}

/**
 * Turn exit: messages become the exit view, while worker audit and evidence references stay out of ordinary reads;
 * activity questions get query execution facts filled in by this turn's own thread and acceptance sequence (the same read rule as report snapshots).
 */
async function toClientTurn(
  turn: AnalysisConversationTurnRecord,
  scope: { threadId?: string; requestSeq?: number }
) {
  const { messages, evidenceRefs: _evidenceRefs, harnessTurnId: _harnessTurnId, ...visible } = turn;
  return {
    ...visible,
    activities: await attachQuestionExecution(turn.activities, scope),
    messages: toVisibleMessages(messages),
  };
}

/** Persisted task terminal states are expressed in one uniform shape; non-terminal tasks never emit task status events. */
function buildTerminalEventFromTask(task: AnalysisTask) {
  if (!isAnalysisTaskTerminalStatus(task.status)) return null;
  return buildAnalysisTaskTerminalEvent({
    taskId: task.id,
    status: task.status,
    resultSummary: task.resultSummary,
    resultReport: task.resultReport,
    finalAnswer: task.analysisPayload?.finalAnswer,
    // The terminal state belongs to the most recently accepted run; only with its acceptance sequence can turn-subscribed pages receive it.
    requestSeq: task.requestSeq,
  });
}

/**
 * A subscribed turn's terminal state is expressed only through that turn's own run record/turn facts:
 * with an acceptance sequence given, another run's terminal state is never borrowed; without one, the current run applies.
 * Accepted but not terminal → running (the subscription waits); no facts for that turn → unknown (an explicit termination).
 */
async function resolveSubscribedTurnTerminal(
  task: AnalysisTask,
  requestSeq: number | undefined
): Promise<
  | { kind: "terminal"; event: NonNullable<ReturnType<typeof buildTerminalEventFromTask>> }
  | { kind: "running" }
  | { kind: "unknown" }
> {
  if (requestSeq === undefined) {
    const event = buildTerminalEventFromTask(task);
    return event ? { kind: "terminal", event } : { kind: "running" };
  }
  const record = (task.runHistory || []).find((run) => run.requestSeq === requestSeq);
  if (record) {
    if (!isAnalysisTaskTerminalStatus(record.status)) return { kind: "running" };
    return {
      kind: "terminal",
      event: buildAnalysisTaskTerminalEvent({
        taskId: task.id,
        status: record.status,
        resultSummary: record.resultSummary,
        resultReport: record.resultReport,
        requestSeq,
      }),
    };
  }
  const turn = (await getAnalysisTaskService().listConversationTurns(task.id)).find(
    (item) => item.requestSeq === requestSeq
  );
  if (!turn) return { kind: "unknown" };
  if (!isAnalysisTaskTerminalStatus(turn.status)) return { kind: "running" };
  return {
    kind: "terminal",
    event: buildAnalysisTaskTerminalEvent({
      taskId: task.id,
      status: turn.status,
      resultSummary: turn.error,
      resultReport: turn.finalAnswer,
      requestSeq,
    }),
  };
}

/**
 * The task may finish between subscription setup and the status read; re-check once and re-emit the terminal state.
 * Non-terminal states no longer emit events — historically this emitted `task_pending` that no frontend consumer handled.
 */
async function emitTerminalIfAlreadyFinished(taskId: string, domainId: string): Promise<void> {
  const task = await getAnalysisTaskService().getTask(taskId, domainId);
  const terminalEvent = task && buildTerminalEventFromTask(task);
  if (terminalEvent) taskEventBus.emit(taskId, terminalEvent);
}

function parseLastTaskEventSeq(req: Request): number {
  const since = Number(req.query.since);
  if (Number.isFinite(since)) return since;
  const lastEventId = Number(req.header("last-event-id"));
  return Number.isFinite(lastEventId) ? lastEventId : 0;
}

function parsePagination(req: Request): { limit: number; offset: number } {
  const rawLimit = Number(req.query.limit);
  const rawOffset = Number(req.query.offset);
  return {
    limit: Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 100),
    offset: Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0),
  };
}

/**
 * GET /api/analysis-tasks
 * Lists analysis tasks (paginated summaries; no report body or provenance payload)
 */
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const taskService = getAnalysisTaskService();
    const agentId = String(req.query.agentId || "").trim();
    const userId = (req as AuthenticatedRequest).userId;
    const domainId = requireDomainId(req as AuthenticatedRequest);
    const reportMode = req.query.reportDeliverableEnabled;
    if (reportMode !== undefined && reportMode !== "true" && reportMode !== "false") {
      throw new HttpError(400, "reportDeliverableEnabled must be true or false");
    }
    const { limit, offset } = parsePagination(req);
    const page = await taskService.listTaskSummaries({
      agentId: agentId || undefined,
      userId,
      domainId,
      reportDeliverableEnabled: reportMode === undefined ? undefined : reportMode === "true",
      limit,
      offset,
    });

    res.json({
      success: true,
      data: {
        ...page,
        tasks: page.tasks.map(toClientTask),
      },
    });
  })
);

/**
 * GET /api/analysis-tasks/agent/:agentId/counts
 * Gets task statistics for one analysis agent
 */
router.get(
  "/agent/:agentId/counts",
  asyncHandler(async (req: Request, res: Response) => {
    const taskService = getAnalysisTaskService();
    const counts = await taskService.getTaskCountsByAgent(
      req.params.agentId,
      (req as AuthenticatedRequest).userId,
      requireDomainId(req as AuthenticatedRequest)
    );
    res.json({ success: true, data: counts });
  })
);

/**
 * The schedule entry's external shape is unchanged: one id space may hold either a report task row or a schedule rule.
 * Reads are expressed uniformly in task shape; writes are routed by `rule` into the rule store.
 */
interface OwnedTaskEntity {
  task: AnalysisTask;
  rule?: AnalysisScheduleRule;
}

async function getOwnedTask(req: Request): Promise<OwnedTaskEntity> {
  const task = await getAnalysisTaskService().getTask(
    req.params.id,
    requireDomainId(req as AuthenticatedRequest)
  );
  const rule = task
    ? undefined
    : await getAnalysisScheduleRuleService().get(
        req.params.id,
        requireDomainId(req as AuthenticatedRequest)
      );
  const owned = task ? { task } : rule ? { task: toScheduleRuleTask(rule), rule } : null;
  if (!owned) {
    throw new HttpError(404, t("api.analysisTaskNotFound"));
  }
  const userId = (req as AuthenticatedRequest).userId;
  const domainId = requireDomainId(req as AuthenticatedRequest);
  if (!requireOwner(owned.task.userId, userId) || owned.task.domainId !== domainId) {
    throw new HttpError(403, t("api.noAccessToTask"));
  }
  return owned;
}

/**
 * GET /api/analysis-tasks/:id
 * Gets one task's details
 */
router.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const owned = await getOwnedTask(req);

    const finalAnswer = owned.task.analysisPayload?.finalAnswer;
    res.json({
      success: true,
      data: {
        ...toClientTask(owned.task),
        ...(typeof finalAnswer === "string" ? { finalAnswer } : {}),
      },
    });
  })
);

/**
 * GET /api/analysis-tasks/:id/report.pdf
 * Downloads the report PDF of the task's latest run. `/:id` matches a single segment and never this two-segment path.
 */
router.get(
  "/:id/report.pdf",
  asyncHandler(async (req: Request, res: Response) => {
    const owned = await getOwnedTask(req);
    const source = analysisReportPdfSource(owned);
    if (!source) throw new HttpError(404, t("api.noReportToExport"));
    const { bytes, fileName } = await exportAnalysisReportPdf(source, new Date());
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", buildAttachmentContentDisposition(fileName));
    res.send(bytes);
  })
);

/**
 * GET /api/analysis-tasks/:id/turns
 * Per-turn facts of a regular session; messages return in the exit view, while worker audit and evidence references stay out of ordinary reads.
 */
router.get(
  "/:id/turns",
  asyncHandler(async (req: Request, res: Response) => {
    const owned = await getOwnedTask(req);
    const turns = await getAnalysisTaskService().listConversationTurns(owned.task.id);
    const visibleTurns = await Promise.all(
      turns.map((turn) =>
        // Each turn reads its own query facts by its own acceptance sequence, never backfilled with the task's latest sequence.
        toClientTurn(turn, { threadId: owned.task.threadId, requestSeq: turn.requestSeq })
      )
    );
    res.json({ success: true, data: { turns: visibleTurns } });
  })
);

/**
 * POST /api/analysis-tasks/:id/turns
 * Accepts a new turn of a regular session; the same session while running cannot be accepted and answers 409.
 */
router.post(
  "/:id/turns",
  validateBody(z.object({ message: z.string().trim().min(1) })),
  asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const owned = await getOwnedTask(req);
    const { task } = owned;
    if (task.reportDeliverableEnabled !== false) {
      throw new HttpError(400, "Only normal Harness sessions accept new turns");
    }
    const agent = await (await getAnalysisAgentService()).getAgent(task.agentId, task.domainId);
    if (!agent || !agent.isEnabled) {
      throw new HttpError(400, "Session agent is unavailable for loop execution");
    }
    const requestSeq = await startConversationTurn(task.id, task.domainId, req.body.message, {
      token: authReq.token,
      apiKey: authReq.apiKey,
    });
    if (requestSeq === null) {
      throw new HttpError(409, t("api.taskIsRunning"));
    }
    res
      .status(202)
      .json({ success: true, data: { taskId: task.id, requestSeq, status: "running" } });
  })
);

/**
 * GET /api/analysis-tasks/:id/runs
 * Status and result of each past run; the current report is still read only from analysis artifacts.
 */
router.get(
  "/:id/runs",
  asyncHandler(async (req: Request, res: Response) => {
    const owned = await getOwnedTask(req);
    const runs = owned.task.runHistory || [];
    if (!owned.task.threadId || runs.length === 0) {
      res.json({ success: true, data: runs });
      return;
    }

    // Follow-up snapshots share the thread sequence with deep-analysis runs. They are archived by the sequence intervals between adjacent runs
    // so that after a re-run the previous run's follow-ups are not attached beneath the latest run.
    const snapshots = await listChatRenderSnapshots(owned.task.threadId);
    const followUps = snapshots.filter(
      (item) => item.snapshot?.mode === "follow-up" && Number.isInteger(item.requestSeq)
    );
    const enriched = runs.map((run) => ({
      ...run,
      ...(run.followUpMessages ? { followUpMessages: [...run.followUpMessages] } : {}),
    }));

    for (const item of followUps) {
      let targetIndex = -1;
      for (let index = enriched.length - 1; index >= 0; index--) {
        const runSeq = enriched[index].requestSeq;
        if (typeof runSeq === "number" && runSeq <= item.requestSeq) {
          targetIndex = index;
          break;
        }
      }
      // Old runs without requestSeq cannot be attributed safely; showing nothing beats leaking them into the latest run.
      if (targetIndex < 0) continue;

      const run = enriched[targetIndex];
      const messages = run.followUpMessages || (run.followUpMessages = []);
      const snapshot = item.snapshot || {};
      if (snapshot.followUpUserMessage) {
        messages.push({
          role: "user",
          content: snapshot.followUpUserMessage,
          requestSeq: item.requestSeq,
        });
      }
      if (snapshot.primaryText) {
        messages.push({
          role: "assistant",
          content: snapshot.primaryText,
          requestSeq: item.requestSeq,
          snapshot: {
            mode: "standard",
            status: snapshot.status || "completed",
            source: "history",
            primaryText: snapshot.primaryText,
          },
        });
      }
    }

    res.json({ success: true, data: enriched });
  })
);

/**
 * GET /api/analysis-tasks/:id/trajectory/:activityId
 * One loop activity with its evidence question facts: regular sessions read the turn; report tasks read the current analysis artifacts.
 */
router.get(
  "/:id/trajectory/:activityId",
  asyncHandler(async (req: Request, res: Response) => {
    const owned = await getOwnedTask(req);
    const { task } = owned;
    const activityId = req.params.activityId;
    const turns = await getAnalysisTaskService().listConversationTurns(task.id);
    const turn = turns.find((item) =>
      item.activities.some((activity) => activity.activityId === activityId)
    );
    const activity =
      turn?.activities.find((item) => item.activityId === activityId) ??
      task.analysisPayload?.activities.find((item) => item.activityId === activityId);
    if (!activity) {
      throw new HttpError(404, "Activity not found");
    }
    res.json({ success: true, data: activity });
  })
);

/**
 * GET /api/analysis-tasks/:id/trajectory/:activityId/subagent
 * Reads one worker's complete sub-trajectory by dispatch activity identity; lists and ordinary provenance never preload internal audit.
 */
router.get(
  "/:id/trajectory/:activityId/subagent",
  asyncHandler(async (req: Request, res: Response) => {
    const owned = await getOwnedTask(req);

    const audit = await getAnalysisTaskService().getSubagentAudit(
      owned.task.id,
      req.params.activityId
    );
    if (!audit) {
      throw new HttpError(404, "Subagent trajectory not found");
    }

    res.json({ success: true, data: toSubagentAuditEgress(audit) });
  })
);

const CreateTaskSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1).optional(),
  question: z.string().min(1),
  description: z.string().optional().default(""),
  scheduleExpression: z.string().optional(),
  scheduleEnabled: z.boolean().optional().default(false),
  notifyEmail: z.string().optional(),
  notifyOnComplete: z.boolean().optional().default(false),
  executeImmediately: z.boolean().optional().default(false),
});

/**
 * POST /api/analysis-tasks
 * Creates an analysis task
 */
router.post(
  "/",
  validateBody(CreateTaskSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const body = req.body as z.infer<typeof CreateTaskSchema>;
    const domainId = authReq.domainId;
    if (!domainId) {
      throw new HttpError(400, "domainId is required");
    }

    const agentService = await getAnalysisAgentService();
    const agent = await agentService.getAgent(body.agentId, domainId);
    if (!agent) {
      throw new HttpError(404, t("api.analysisAgentNotFound"));
    }

    const reportDeliverableEnabled = agent.reportDeliverableEnabled !== false;
    if (reportDeliverableEnabled && !body.name) {
      throw new HttpError(400, "name is required for analysis tasks");
    }

    // Creating with a schedule registers a schedule rule; it does not build one report run.
    if (body.scheduleEnabled) {
      const rule = await getAnalysisScheduleRuleService().register({
        agentId: body.agentId,
        userId: authReq.userId,
        domainId,
        name: body.name || body.question.slice(0, 40),
        description: body.description,
        question: body.question,
        scheduleExpression: body.scheduleExpression || "",
        notifyEmail: body.notifyEmail || undefined,
        notifyOnComplete: body.notifyOnComplete || false,
        token: authReq.token || undefined,
      });
      const triggered = body.executeImmediately
        ? await triggerScheduleRule(rule.id, rule.domainId)
        : null;
      res
        .status(201)
        .json({ success: true, data: toClientTask(triggered || toScheduleRuleTask(rule)) });
      return;
    }

    const task = await getAnalysisTaskService().createTask({
      reportDeliverableEnabled: agent.reportDeliverableEnabled,
      agentId: body.agentId,
      userId: authReq.userId,
      domainId,
      name: body.name || body.question.slice(0, 40),
      description: body.description,
      question: body.question,
      notifyEmail: body.notifyEmail || undefined,
      notifyOnComplete: body.notifyOnComplete || false,
      token: authReq.token || undefined,
    });

    logger.info(
      tApp("analysis.log.tasks.created", {
        id: task.id,
        name: task.name,
        userId: authReq.userId,
      })
    );

    if (body.executeImmediately) {
      // Regular sessions are accepted per turn; report tasks go to the execution orchestrator.
      if (task.reportDeliverableEnabled === false) {
        await startConversationTurn(task.id, task.domainId, body.question, {
          token: authReq.token,
          apiKey: authReq.apiKey,
        });
      } else {
        executeTask(task.id, task.domainId).catch((error) => {
          logger.error(tApp("analysis.log.tasks.runNowFailed", { id: task.id }), { error });
        });
      }
    }

    res.status(201).json({ success: true, data: toClientTask(task) });
  })
);

/**
 * POST /api/analysis-tasks/:id/execute
 * Runs an analysis task manually
 */
router.post(
  "/:id/execute",
  asyncHandler(async (req: Request, res: Response) => {
    const taskService = getAnalysisTaskService();
    const owned = await getOwnedTask(req);
    const { task, rule } = owned;

    if (task.status === "running") {
      throw new HttpError(400, t("api.taskIsRunning"));
    }

    const requestToken = (req as AuthenticatedRequest).token;
    if (requestToken && requestToken !== task.token) {
      if (rule)
        await getAnalysisScheduleRuleService().update(rule.id, rule.domainId, {
          token: requestToken,
        });
      else
        await taskService.updateTask(req.params.id, task.domainId, { token: requestToken } as any);
    }

    if (rule) {
      const reportTask = await triggerScheduleRule(rule.id, rule.domainId);
      if (!reportTask) {
        throw new HttpError(409, t("api.taskIsRunning"));
      }
      res.json({
        success: true,
        data: { taskId: reportTask.id, scheduleTaskId: rule.id, status: "executing" },
      });
      return;
    }

    // A regular session's next execution is a new turn; the acceptance sequence is that turn's stable identity.
    if (task.reportDeliverableEnabled === false) {
      const requestSeq = await startConversationTurn(
        task.id,
        task.domainId,
        task.question || task.name,
        { token: requestToken || task.token }
      );
      if (requestSeq === null) {
        throw new HttpError(409, t("api.taskIsRunning"));
      }
      res.json({ success: true, data: { taskId: task.id, requestSeq, status: "running" } });
      return;
    }

    executeTask(task.id, task.domainId).catch((error) => {
      logger.error(tApp("analysis.log.tasks.runManualFailed", { id: task.id }), { error });
    });

    res.json({ success: true, data: { taskId: task.id, status: "executing" } });
  })
);

/**
 * POST /api/analysis-tasks/:id/cancel
 * Cancels a running task
 */
router.post(
  "/:id/cancel",
  asyncHandler(async (req: Request, res: Response) => {
    const taskService = getAnalysisTaskService();
    const owned = await getOwnedTask(req);
    const { task } = owned;

    if (task.status === "cancelled") {
      throw new HttpError(400, t("api.taskAlreadyCancelled"));
    }

    // For a running task, send the abort signal before updating status; with no accepted run, the run history is never touched
    const openRunId = task.status === "running" ? currentAnalysisRunId(task.runHistory) : undefined;
    if (task.status === "running") {
      cancelAnalysisTaskRun(task.id);
    }

    await taskService.updateTaskStatus(
      task.id,
      "cancelled",
      openRunId ? { identity: { runId: openRunId } } : undefined
    );

    res.json({ success: true, data: { taskId: task.id, status: "cancelled" } });
  })
);

/**
 * PUT /api/analysis-tasks/:id
 * Updates an analysis task; adding a schedule to a report task equals registering a schedule rule templated on it.
 */
router.put(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const owned = await getOwnedTask(req);

    const ruleService = getAnalysisScheduleRuleService();
    const updates = { ...req.body, token: undefined } as Partial<AnalysisTask>;

    if (owned.rule) {
      const rule = await ruleService.update(owned.rule.id, owned.rule.domainId, {
        ...updates,
        enabled: updates.scheduleEnabled,
      });
      if (!rule) {
        throw new HttpError(404, t("api.analysisTaskNotFound"));
      }
      res.json({ success: true, data: toClientTask(toScheduleRuleTask(rule)) });
      return;
    }

    if (updates.scheduleEnabled) {
      const rule = await ruleService.register({
        agentId: owned.task.agentId,
        userId: owned.task.userId,
        domainId: owned.task.domainId,
        name: updates.name || owned.task.name,
        description: updates.description ?? owned.task.description,
        question: updates.question || owned.task.question || owned.task.name,
        scheduleExpression: updates.scheduleExpression || "",
        notifyEmail: updates.notifyEmail ?? owned.task.notifyEmail,
        notifyOnComplete: updates.notifyOnComplete ?? owned.task.notifyOnComplete,
        token: (req as AuthenticatedRequest).token || owned.task.token,
      });
      res.json({ success: true, data: toClientTask(toScheduleRuleTask(rule)) });
      return;
    }

    const task = await getAnalysisTaskService().updateTask(
      req.params.id,
      owned.task.domainId,
      updates
    );

    if (!task) {
      throw new HttpError(404, t("api.analysisTaskNotFound"));
    }

    res.json({ success: true, data: toClientTask(task) });
  })
);

/**
 * DELETE /api/analysis-tasks/:id
 * Deletes an analysis task
 */
router.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const owned = await getOwnedTask(req);

    if (owned.rule) {
      await getAnalysisScheduleRuleService().remove(owned.rule.id, owned.rule.domainId);
      res.json({ success: true });
      return;
    }

    if (owned.task.status === "running") {
      cancelAnalysisTaskRun(owned.task.id);
    }

    await getAnalysisTaskService().deleteTask(req.params.id, owned.task.domainId);

    res.json({ success: true });
  })
);

/**
 * GET /api/analysis-tasks/:id/messages
 * Gets a task's conversation messages
 */
router.get(
  "/:id/messages",
  asyncHandler(async (req: Request, res: Response) => {
    const owned = await getOwnedTask(req);
    const { task } = owned;

    // The review snapshot is derived at read time from the single authoritative artifact: the same fields as the live terminal-state view, with no second copy on the write side.
    const payload = task.analysisPayload;
    const provenance = payload ? await buildTaskProvenance(task) : null;
    const taskSnapshot = payload
      ? buildDeepAnalysisTaskSnapshot({
          taskId: task.id,
          threadId: task.threadId,
          status: task.status,
          requestSeq: task.requestSeq,
          payload: { ...payload, activities: provenance!.activities },
          fallbackText: task.resultSummary,
        })
      : null;

    const messages: any[] = [];
    if (task.question) {
      messages.push({ role: "user", content: task.question });
    }
    if (taskSnapshot) {
      const snapshot = taskSnapshot;
      messages.push({
        role: "assistant",
        content: snapshot.primaryText || "",
        requestSeq: taskSnapshot.requestSeq,
        chain: [],
        snapshot: {
          ...snapshot,
          source: "history",
        },
        datasets: [],
      });
    }
    if (task.threadId) {
      const snapshots = await listChatRenderSnapshots(task.threadId);
      const latestRun = task.runHistory?.[task.runHistory.length - 1];
      const currentExecutionSeq = latestRun?.requestSeq ?? task.requestSeq;
      for (const snapshotRowItem of snapshots) {
        if (taskSnapshot?.requestSeq === snapshotRowItem.requestSeq) continue;
        const snapshot = snapshotRowItem.snapshot || {};
        if (snapshot.mode !== "follow-up") continue;
        // Restore only follow-ups produced after the current execution. An old run's follow-ups belong to that old run,
        // and sharing the same threadId never mixes them into the latest session after a re-run.
        if (
          latestRun &&
          (currentExecutionSeq === undefined || snapshotRowItem.requestSeq <= currentExecutionSeq)
        )
          continue;
        if (snapshot.followUpUserMessage) {
          messages.push({ role: "user", content: snapshot.followUpUserMessage });
        }
        const content = snapshot.primaryText || "";
        if (content) {
          messages.push({
            role: "assistant",
            content,
            requestSeq: snapshotRowItem.requestSeq,
            chain: [],
            snapshot: {
              mode: "standard",
              status: snapshot.status || "completed",
              source: "history",
              primaryText: content,
            },
            datasets: [],
          });
        }
      }
    }
    res.json({ success: true, data: { messages } });
  })
);

/**
 * GET /api/analysis-tasks/:id/stream
 * SSE streaming connection receiving task execution events in real time
 */
router.get(
  "/:id/stream",
  asyncHandler(async (req: Request, res: Response) => {
    const taskService = getAnalysisTaskService();
    const owned = await getOwnedTask(req);
    const { task } = owned;

    try {
      initializeSse(res);

      let unsubscribe = () => {};
      const since = parseLastTaskEventSeq(req);
      // Regular sessions subscribe by acceptance sequence: old connections of the same session never receive new turns' events.
      const requestSeq =
        req.query.requestSeq === undefined ? undefined : Number(req.query.requestSeq);

      const heartbeatInterval = setInterval(() => {
        try {
          res.write("event: heartbeat\n");
          res.write(`data: ${JSON.stringify({ ts: Date.now() } satisfies SseHeartbeatData)}\n\n`);
        } catch {
          // connection closed
        }
      }, 15000);

      req.on("close", () => {
        clearInterval(heartbeatInterval);
        unsubscribe();
      });

      /**
       * Finish after emitting the subscribed turn's own terminal state; when the turn is accepted but not terminal the subscription waits for its own terminal state;
       * when the turn has no facts at all, terminate explicitly per the existing SSE error protocol instead of waiting forever or passing off another run's terminal state.
       */
      const deliverSubscribedTerminalOrWait = async (subject: AnalysisTask): Promise<void> => {
        const resolved = await resolveSubscribedTurnTerminal(subject, requestSeq);
        if (resolved.kind === "terminal") {
          clearInterval(heartbeatInterval);
          res.write(`data: ${JSON.stringify(resolved.event)}\n\n`);
          res.end();
          return;
        }
        if (resolved.kind === "unknown") {
          clearInterval(heartbeatInterval);
          writeSseError(res, "Analysis turn not found");
          res.end();
          return;
        }
        unsubscribe = subscribeToTaskStream(
          req.params.id,
          res,
          heartbeatInterval,
          since,
          requestSeq
        );
      };

      if (task.status === "running") {
        const resolved = await resolveSubscribedTurnTerminal(task, requestSeq);
        if (resolved.kind === "unknown") {
          clearInterval(heartbeatInterval);
          writeSseError(res, "Analysis turn not found");
          res.end();
          return;
        }
        unsubscribe = subscribeToTaskStream(
          req.params.id,
          res,
          heartbeatInterval,
          since,
          requestSeq
        );
        if (resolved.kind === "terminal") {
          clearInterval(heartbeatInterval);
          res.write(`data: ${JSON.stringify(resolved.event)}\n\n`);
          res.end();
        } else {
          await emitTerminalIfAlreadyFinished(req.params.id, task.domainId);
        }
      } else if (task.status === "pending") {
        const startedAt = Date.now();
        const pollInterval = setInterval(async () => {
          try {
            if (Date.now() - startedAt > 30000) {
              clearInterval(pollInterval);
              clearInterval(heartbeatInterval);
              res.end();
              return;
            }
            const updated = await taskService.getTask(req.params.id, task.domainId);
            if (!updated) {
              clearInterval(pollInterval);
              clearInterval(heartbeatInterval);
              if (!res.writableEnded) {
                writeSseError(res, t("api.analysisTaskNotFound"));
                res.end();
              }
              return;
            }
            if (updated.status === "running") {
              clearInterval(pollInterval);
              const resolved = await resolveSubscribedTurnTerminal(updated, requestSeq);
              if (resolved.kind === "unknown") {
                clearInterval(heartbeatInterval);
                writeSseError(res, "Analysis turn not found");
                res.end();
                return;
              }
              unsubscribe = subscribeToTaskStream(
                req.params.id,
                res,
                heartbeatInterval,
                since,
                requestSeq
              );
              if (resolved.kind === "terminal") {
                clearInterval(heartbeatInterval);
                res.write(`data: ${JSON.stringify(resolved.event)}\n\n`);
                res.end();
              } else {
                await emitTerminalIfAlreadyFinished(req.params.id, task.domainId);
              }
            } else {
              clearInterval(pollInterval);
              await deliverSubscribedTerminalOrWait(updated);
            }
          } catch (error) {
            clearInterval(pollInterval);
            clearInterval(heartbeatInterval);
            if (!res.writableEnded) {
              writeSseError(res, error);
              res.end();
            }
          }
        }, 500);
      } else {
        // The task is already terminal: emit the terminal state from the subscribed turn's own facts, never borrowed from another run.
        await deliverSubscribedTerminalOrWait(task);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(tApp("analysis.log.tasks.sseFailed"), errorMessage);
      if (!res.writableEnded) {
        writeSseError(res, error);
        res.end();
      }
    }
  })
);

export default router;
