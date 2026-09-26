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

        // 任务状态事件只在终态发出，收到即结束本次订阅。
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

/** 出口视图只省略主管/工人的内部思考；探测结果正文另按分析域策略替换。 */
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
 * 回合出口：消息转出口视图，工人审计与证据引用不进常规读取；
 * 活动问题按本回合自己的线程与受理序号补查询执行事实（与报告快照同一读取规则）。
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

/** 已落库的任务终态按统一形状表达；非终态任务不发任务状态事件。 */
function buildTerminalEventFromTask(task: AnalysisTask) {
  if (!isAnalysisTaskTerminalStatus(task.status)) return null;
  return buildAnalysisTaskTerminalEvent({
    taskId: task.id,
    status: task.status,
    resultSummary: task.resultSummary,
    resultReport: task.resultReport,
    finalAnswer: task.analysisPayload?.finalAnswer,
    // 终态属于最近一次受理的运行；带上它的受理序号，按回合订阅的页面才收得到。
    requestSeq: task.requestSeq,
  });
}

/**
 * 订阅回合的终态只按该回合自己的运行记录/回合事实表达：
 * 指定受理序号时绝不借用别的运行终态；缺省时按当前运行。
 * 已受理但未终态 → running（订阅等待）；没有任何该回合事实 → unknown（明确终止）。
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
 * 订阅建立与状态读取之间任务可能已经结束，回查一次补发终态。
 * 非终态状态不再发事件——历史上这里会发出前端无人处理的 `task_pending`。
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
 * 获取分析任务列表（分页摘要，不返回报告正文和溯源 payload）
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
 * 获取指定分析智能体的任务统计
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
 * 定时入口的对外形状不变：同一个 id 空间下既可能是报告任务行，也可能是定时规则。
 * 读取按任务形状统一表达，写入按 `rule` 分流到规则存储。
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
 * 获取单个任务详情
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
 * 下载该任务最新一次运行的报告 PDF。`/:id` 只匹配一段，不会匹配这条两段路径。
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
 * 常规会话的逐轮事实；消息按出口视图返回，工人审计与证据引用不进常规读取。
 */
router.get(
  "/:id/turns",
  asyncHandler(async (req: Request, res: Response) => {
    const owned = await getOwnedTask(req);
    const turns = await getAnalysisTaskService().listConversationTurns(owned.task.id);
    const visibleTurns = await Promise.all(
      turns.map((turn) =>
        // 每个回合按自己的受理序号读自己的查询事实，不用任务最新序号回填。
        toClientTurn(turn, { threadId: owned.task.threadId, requestSeq: turn.requestSeq })
      )
    );
    res.json({ success: true, data: { turns: visibleTurns } });
  })
);

/**
 * POST /api/analysis-tasks/:id/turns
 * 受理常规会话的新一轮；运行中的同一会话不能受理，返回 409。
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
 * 过去每次运行的状态与结果；当前报告仍唯一从分析产物读取。
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

    // 追问快照的 requestSeq 与深度分析运行共用线程序号。按相邻运行的序号区间
    // 归档，避免重跑后把上一次运行的追问挂到最新运行下面。
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
      // 老运行没有 requestSeq 时无法安全归属，宁可不展示，也不能串到最新 run。
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
 * 一个循环活动及其取证问题事实：常规会话读该轮，报告任务读当前分析产物。
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
 * 按派遣活动身份读取一个工人的完整子轨迹；列表与常规溯源不预加载内部审计。
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
 * 创建分析任务
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

    // 带定时的创建是在注册一条定时规则，不是在建一次报告运行。
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
      // 常规会话按回合受理；报告任务交给执行编排器。
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
 * 手动执行分析任务
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

    // 常规会话的下一次执行是一条新回合；受理序号是这一轮的稳定身份。
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
 * 取消正在运行的任务
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

    // 对正在运行的任务，先发送 abort 信号再更新状态；没有已受理的运行时不改运行历史
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
 * 更新分析任务；给报告任务加定时等于注册一条以它为模板的定时规则。
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
 * 删除分析任务
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
 * 获取任务的会话消息
 */
router.get(
  "/:id/messages",
  asyncHandler(async (req: Request, res: Response) => {
    const owned = await getOwnedTask(req);
    const { task } = owned;

    // 回看快照由唯一权威产物读时派生：与实时终态视图同一份字段，写侧不再另存一份。
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
        // 只恢复当前执行之后产生的追问。旧 run 的追问属于旧 run，
        // 不能因为它们共享同一个 threadId 就混入重跑后的最新会话。
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
 * SSE 流式连接，实时接收任务执行事件
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
      // 常规会话按受理序号订阅：同一会话的旧连接不接收新回合的事件。
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
       * 下发订阅回合自己的终态后收尾；该回合已受理但未终态时订阅等待它自己的终态；
       * 该回合没有任何事实时按既有 SSE 错误协议明确终止，不用无限等待也不会拿别的运行终态冒充。
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
        // 任务已是终态：按订阅回合自己的事实下发终态，绝不借用别的运行。
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
