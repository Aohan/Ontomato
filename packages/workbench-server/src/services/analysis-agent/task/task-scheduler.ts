import { createLogger } from "../../../logging/logger";
import { getAnalysisTaskService } from "./task-service";
import { getAnalysisScheduleRuleService } from "./schedule-rules";
import { getAnalysisAgentService } from "../runtime";
import { startAnalysisTaskRun } from "./task-runner";
import { parseScheduleToNextRun } from "./schedule-parser";
import { currentAnalysisRunId } from "./run-history";
import { config } from "../../../config/application";
import type { AnalysisScheduleRule } from "./schedule-rules";
import type { AnalysisTask } from "../task-types";
import type { AnalysisConversationTurnRecord } from "./conversation-types";
import { tApp } from "../../../i18n";


const logger = createLogger("task-scheduler");

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
const CHECK_INTERVAL_MS = 30000;

/**
 * 下一个触发槽位。解析不出或已经过期时退到 30 分钟后：认领即推进 next_run_at，
 * 槽位必须落在将来，否则调度器每 30s 轮询都会重新选中同一条规则。
 */
function nextRunSlot(rule: AnalysisScheduleRule, triggeredAt: number): number {
  const parsed = parseScheduleToNextRun(rule.scheduleExpression, triggeredAt);
  if (parsed && parsed > Date.now()) return parsed;
  logger.warn(tApp("analysis.task.task-scheduler.423"), {
    ruleId: rule.id,
    scheduleExpression: rule.scheduleExpression,
    triggeredAt,
    parsed,
  });
  return Date.now() + 30 * 60 * 1000;
}

/**
 * 定时规则到点时，等价于系统替用户重新发起一次深度分析：
 * 认领规则并推进下次触发时刻，实际报告写入新建的一次性任务。
 */
export async function triggerScheduleRule(
  ruleId: string,
  domainId: string
): Promise<AnalysisTask | null> {
  const ruleService = getAnalysisScheduleRuleService();
  const rule = await ruleService.get(ruleId, domainId);
  if (!rule || !rule.enabled) {
    logger.warn(tApp("analysis.task.task-scheduler.424"), { ruleId });
    return null;
  }

  const triggeredAt = Date.now();
  const claimed = await ruleService.claim(
    rule.id,
    rule.nextRunAt,
    nextRunSlot(rule, triggeredAt),
    triggeredAt
  );
  if (!claimed) return null;

  try {
    const reportTask = await getAnalysisTaskService().createTask({
      agentId: rule.agentId,
      userId: rule.userId,
      domainId: rule.domainId,
      name: rule.name,
      description: rule.description,
      question: rule.question || rule.name,
      notifyEmail: rule.notifyEmail,
      notifyOnComplete: rule.notifyOnComplete,
      triggerSource: "scheduled",
      token: rule.token,
    });

    logger.info(tApp("analysis.task.task-scheduler.425"), {
      ruleId: rule.id,
      reportTaskId: reportTask.id,
      nextRunAt: claimed.nextRunAt,
    });

    executeTask(reportTask.id, reportTask.domainId).catch((error) => {
      logger.error(tApp("analysis.task.task-scheduler.426", { id: reportTask.id }), { error });
    });

    return reportTask;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(tApp("analysis.task.task-scheduler.427"), { ruleId: rule.id, error: errorMessage });
    await ruleService
      .recordTriggerError(rule.id, tApp("analysis.task.task-scheduler.428", { errorMessage: errorMessage }))
      .catch((recordError) => {
        logger.error(tApp("analysis.task.task-scheduler.429"), {
          ruleId: rule.id,
          error: recordError instanceof Error ? recordError.message : String(recordError),
        });
      });
    return null;
  }
}

/**
 * 认领一个待执行的一次性任务并交给运行编排器。
 * 调度侧只负责 claim 与执行前置条件，运行本身（事件、终态、通知、取消）在编排器里。
 */
async function executeTask(taskId: string, domainId: string): Promise<void> {
  const taskService = getAnalysisTaskService();
  const agentService = await getAnalysisAgentService();

  // 常规会话任务不走这里：入口按回合受理，由 startConversationTurn 占用任务并分配受理序号。
  const task = await taskService.tryStartTask(taskId, domainId);
  if (!task) return;

  const agent = await agentService.getAgent(task.agentId, task.domainId);
  if (!agent) {
    logger.error(tApp("analysis.task.task-scheduler.430", { agentId: task.agentId }));
    await taskService.updateTaskStatus(taskId, "failed", {
      resultSummary: tApp("analysis.task.task-scheduler.431"),
      identity: { runId: currentAnalysisRunId(task.runHistory)! },
    });
    return;
  }

  const { completion } = await startAnalysisTaskRun({ task, agent });
  await completion;
}

/**
 * 受理一轮常规会话并异步执行。任务已占用或不是常规会话时返回 null，
 * 由入口回 409；回合受理序号即本轮在会话内的稳定身份。
 */
export async function startConversationTurn(
  taskId: string,
  domainId: string,
  message: string,
  credentials: { token?: string; apiKey?: string } = {}
): Promise<number | null> {
  const turn = await getAnalysisTaskService().claimConversationTurn(taskId, message);
  if (!turn) return null;
  void runConversationTurn(taskId, domainId, turn, credentials).catch((error) =>
    logger.error(tApp("analysis.task.task-scheduler.432", { taskId: taskId }), { error })
  );
  return turn.requestSeq;
}

/** 常规会话每轮都走循环：入口凭据优先，缺省回退任务行保存的 token。 */
async function runConversationTurn(
  taskId: string,
  domainId: string,
  turn: AnalysisConversationTurnRecord,
  credentials: { token?: string; apiKey?: string }
): Promise<void> {
  const taskService = getAnalysisTaskService();
  const agentService = await getAnalysisAgentService();
  const task = await taskService.getTask(taskId, domainId);
  if (!task) {
    logger.error(tApp("analysis.task.task-scheduler.433", { taskId: taskId }));
    return;
  }

  const agent = await agentService.getAgent(task.agentId, task.domainId);
  if (!agent) {
    logger.error(tApp("analysis.task.task-scheduler.430", { agentId: task.agentId }));
    await taskService.saveConversationTurn(taskId, {
      ...turn,
      status: "failed",
      error: tApp("analysis.task.task-scheduler.434"),
    });
    await taskService.updateTaskStatus(taskId, "failed", {
      resultSummary: tApp("analysis.task.task-scheduler.431"),
      identity: { runId: currentAnalysisRunId(task.runHistory)! },
    });
    return;
  }

  const { completion } = await startAnalysisTaskRun({
    task: { ...task, token: credentials.token ?? task.token, question: turn.userMessage },
    agent,
    apiKey: credentials.apiKey,
    conversationTurn: turn,
  });
  await completion;
}

async function checkScheduledTasks(): Promise<void> {
  try {
    const rules = await getAnalysisScheduleRuleService().listDue(Date.now());

    if (rules.length > 0) {
      logger.debug(tApp("analysis.task.task-scheduler.435", { length: rules.length }));
    }

    for (const rule of rules) {
      const scheduledAt = rule.nextRunAt ? new Date(rule.nextRunAt).toISOString() : "unknown";
      logger.debug(tApp("analysis.task.task-scheduler.436", { id: rule.id, name: rule.name, scheduledAt: scheduledAt }));
      triggerScheduleRule(rule.id, rule.domainId).catch((error) => {
        logger.error(tApp("analysis.task.task-scheduler.437", { id: rule.id }), { error });
      });
    }
  } catch (error: unknown) {
    logger.error(tApp("analysis.task.task-scheduler.438"), { error });
  }
}

async function recoverStaleRunningTasks(): Promise<void> {
  const taskService = getAnalysisTaskService();
  const running = await taskService.getRunningTasks();
  if (running.length === 0) return;

  const now = Date.now();
  const STALE_THRESHOLD_MS = 60 * 60 * 1000;

  for (const task of running) {
    // 常规会话的 running 回合只可能来自本进程已丢失的运行，直接收口为失败。
    if (task.reportDeliverableEnabled === false) {
      for (const turn of await taskService.listConversationTurns(task.id)) {
        if (turn.status !== "running") continue;
        await taskService.saveConversationTurn(task.id, {
          ...turn,
          status: "failed",
          error: tApp("analysis.task.task-scheduler.439"),
          activities: turn.activities.map((activity) =>
            activity.status === "running" ? { ...activity, status: "failed" as const } : activity
          ),
        });
      }
      await taskService.updateTaskStatus(task.id, "failed", {
        resultSummary: tApp("analysis.task.task-scheduler.440"),
        identity: { runId: currentAnalysisRunId(task.runHistory)! },
      });
      continue;
    }

    const startedAt = task.lastRunAt ?? task.updatedAt;
    if (now - startedAt > STALE_THRESHOLD_MS) {
      logger.warn(
        tApp("analysis.task.task-scheduler.441", { id: task.id, name: task.name, round: Math.round((now - startedAt) / 60000) })
      );
      await taskService.updateTaskStatus(task.id, "failed", {
        resultSummary: tApp("analysis.task.task-scheduler.440"),
        identity: { runId: currentAnalysisRunId(task.runHistory)! },
      });
    }
  }
}

export function startTaskScheduler(): void {
  if (schedulerInterval) {
    logger.warn(tApp("analysis.task.task-scheduler.442"));
    return;
  }

  logger.info(
    tApp("analysis.task.task-scheduler.443", { CHECK_INTERVAL_MS: CHECK_INTERVAL_MS, timezone: config.schedule.timezone })
  );
  schedulerInterval = setInterval(checkScheduledTasks, CHECK_INTERVAL_MS);

  recoverStaleRunningTasks().catch((error) => {
    logger.error(tApp("analysis.task.task-scheduler.444"), { error });
  });
  checkScheduledTasks().catch((error) => {
    logger.error(tApp("analysis.task.task-scheduler.445"), { error });
  });
}

export function stopTaskScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info(tApp("analysis.task.task-scheduler.446"));
  }
}

export { executeTask };
