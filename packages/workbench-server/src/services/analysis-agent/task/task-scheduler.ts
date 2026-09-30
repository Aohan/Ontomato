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
 * The next trigger slot. When unparseable or already past, fall back to 30 minutes later: claiming advances next_run_at,
 * and the slot must land in the future or the scheduler's 30s poll would re-select the same rule every time.
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
 * When a schedule rule fires it is equivalent to the system re-initiating one deep analysis on the user's behalf:
 * claim the rule and advance its next trigger time; the actual report is written into a newly created one-shot task.
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
 * Claims one pending one-shot task and hands it to the run orchestrator.
 * The scheduler side owns only claim and execution preconditions; the run itself (events, terminal states, notifications, cancellation) lives in the orchestrator.
 */
async function executeTask(taskId: string, domainId: string): Promise<void> {
  const taskService = getAnalysisTaskService();
  const agentService = await getAnalysisAgentService();

  // Regular-session tasks never come through here: entries accept per turn, with startConversationTurn occupying the task and assigning the acceptance sequence.
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
 * Accepts one regular-session turn and executes it asynchronously. Returns null when the task is already occupied or not a regular session,
 * and the entry answers 409; the turn's acceptance sequence is this turn's stable identity within the session.
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

/** Every regular-session turn goes through the loop: entry credentials win, falling back to the token saved on the task row. */
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
    // A running regular-session turn can only come from a run this process has lost; finalize it directly as failed.
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
