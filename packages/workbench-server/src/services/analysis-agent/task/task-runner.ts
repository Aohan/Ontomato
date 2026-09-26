import { t } from "../../../i18n";
import { createDeepAnalysisArtifactStore } from "./artifacts";
import type { AnalysisAgent } from "@ontomato/contracts/analysis-agent";
import type { RequestIdentity } from "@ontomato/contracts/identity";
/**
 * 分析任务运行编排器：一次深度分析运行的唯一实现。
 *
 * 页面对话流、定时调度和 MCP 三个入口只负责各自的触发面（HTTP/SSE 壳、轮询与 claim、
 * 超时触发），任务从 running 到终态之间的编排——执行、事件发布、结果组装、终态写入、
 * 邮件通知和取消语义——都在这里，入口不再各写一份。
 *
 * 两条不变量：
 * - 执行事件只经 `TaskEventBus`（按 taskId）发布，这是任务执行事件的唯一通道；
 * - 执行失败以 `AnalysisTaskRunOutcome` 返回；终态持久化故障继续抛出，不伪装完成。
 */

import { createLogger } from "../../../logging/logger";
import { runWithLogContext } from "../../../logging/log-context";
import { buildAnalysisTaskTerminalEvent } from "./events";
import { getEmailNotifyService } from "../report/email-notify";
import { runDeepAnalysis } from "../runtime";
import { taskEventBus } from "./task-event-bus";
import { buildDeepAnalysisTaskResult } from "./task-result";
import { getAnalysisTaskService } from "./task-service";
import { createThreadPlaceholder } from "../../chat/thread-store";
import { workbenchIdentity } from "../../../identity/installed";
import { currentAnalysisRunIdentity, type AnalysisRunIdentity } from "./run-history";
import { isCurrentAnalysisRun, readAnalysisRunHistory } from "./run-history";

import type { AnalysisStreamEvent } from "@ontomato/contracts/analysis-events";
import type { AnalysisTask } from "../task-types";
import type { AnalysisConversationTurnRecord } from "./conversation-types";
import { tApp } from "../../../i18n";


const logger = createLogger("analysis-task-runner");

/**
 * 本进程内正在运行的任务；条目同时承载本次运行受理时捕获的身份。
 * 新运行登记会取代旧条目，旧运行据此判定自己已被取代，不再发终态事件或清理通道。
 */
interface ActiveAnalysisRun {
  controller: AbortController;
  identity?: AnalysisRunIdentity;
}

const activeRuns = new Map<string, ActiveAnalysisRun>();

export interface AnalysisTaskRunRequest {
  /** 已创建或已 claim 的任务行，由编排器推进到 running 与终态 */
  task: AnalysisTask;
  /** 入口已解析好的分析智能体 */
  agent: AnalysisAgent;
  /** 在线入口已验证的身份；离线任务仅持有保存的 tk，须在运行内验证。 */
  verifiedIdentity?: Pick<RequestIdentity, "userId" | "domainId">;
  /** MCP 入口的用户 API key；页面与调度用任务行上的 token */
  apiKey?: string;
  /** 入口提供的外部取消触发；AbortController 仍由编排器持有 */
  cancelSignal?: AbortSignal;
  /** 超时中止毫秒数；到点按取消处理，取消原因写入终态 */
  timeoutMs?: number;
  /** 常规会话的当前轮；提供时按会话回合运行，终态同时收口该轮。 */
  conversationTurn?: AnalysisConversationTurnRecord;
}

export type AnalysisTaskRunOutcome =
  | { status: "completed" }
  | { status: "cancelled" }
  | { status: "failed"; error: unknown };

export interface AnalysisTaskRunHandle {
  /** 已置为 running 的任务行 */
  task: AnalysisTask;
  /** 本次运行的终态；终态持久化故障会 reject */
  completion: Promise<AnalysisTaskRunOutcome>;
}

/** 中止指定任务的运行；任务不在本进程运行时返回 false。 */
export function cancelAnalysisTaskRun(taskId: string): boolean {
  const entry = activeRuns.get(taskId);
  if (!entry || entry.controller.signal.aborted) return false;
  entry.controller.abort();
  logger.info(tApp("analysis.task.task-runner.413", { taskId: taskId }));
  return true;
}

/** 本次运行是否仍是该任务登记的运行；被新运行取代后不再对外产生终态或清理动作。 */
function isActiveRun(taskId: string, entry: ActiveAnalysisRun): boolean {
  return activeRuns.get(taskId) === entry;
}

/** 只有仍是该任务登记的运行时才向任务通道发事件；被取代的旧运行不得污染新运行的流。 */
function emitRunEvent(taskId: string, entry: ActiveAnalysisRun, event: AnalysisStreamEvent): void {
  if (isActiveRun(taskId, entry)) taskEventBus.emit(taskId, event);
}

/**
 * 启动一次任务运行：先把任务推进到 running 并返回运行中的任务行，
 * 执行本身在 `completion` 上继续。入口需要立即回应（MCP 提交、页面 run_started）
 * 时用返回的任务行，需要等待结果时 await `completion`。
 */
export function startAnalysisTaskRun(
  request: AnalysisTaskRunRequest
): Promise<AnalysisTaskRunHandle> {
  return runWithLogContext(
    { taskId: request.task.id, domainId: request.task.domainId },
    async () => {
      const { task } = request;
      const entry: ActiveAnalysisRun = {
        controller: new AbortController(),
        identity: currentAnalysisRunIdentity(task.runHistory, request.conversationTurn?.requestSeq),
      };
      activeRuns.set(task.id, entry);
      // 新运行从干净的通道开始：旧运行的事件缓冲与清理计时不属于它。
      taskEventBus.beginRun(task.id);

      const threadId = task.threadId || `task-${task.id}`;
      if (!task.threadId) {
        try {
          await getAnalysisTaskService().updateTaskThread(task.id, threadId);
        } catch (error) {
          logger.error(tApp("analysis.task.task-runner.414"), { taskId: task.id, error: describeError(error) });
        }
      }

      // 受理（tryStartTask / claimConversationTurn）已原子置为 running 并追加运行记录，
      // 这里不再补一次没有身份的 running 写：那会在取消与新运行之间把终态改回运行中。
      return { task, completion: executeRun(request, entry, threadId) };
    }
  );
}

async function executeRun(
  request: AnalysisTaskRunRequest,
  entry: ActiveAnalysisRun,
  threadId: string
): Promise<AnalysisTaskRunOutcome> {
  const { task, agent } = request;
  const { controller, identity: runIdentity } = entry;
  const question = request.conversationTurn?.userMessage || task.question || task.name;

  /** 超时是一种取消原因，取消后由统一终态路径落库，不另写一份终态。 */
  let cancelReason: string | undefined;
  const timeout = request.timeoutMs
    ? setTimeout(() => {
        cancelReason = tApp("analysis.task.task-runner.415", { timeoutMs: request.timeoutMs });
        controller.abort();
      }, request.timeoutMs)
    : undefined;

  const onExternalCancel = () => controller.abort();
  request.cancelSignal?.addEventListener("abort", onExternalCancel);
  if (request.cancelSignal?.aborted) controller.abort();

  logger.info(tApp("analysis.task.task-runner.416", { id: task.id, name: task.name }));

  try {
    await workbenchIdentity().confirmTaskOwner(task, request.verifiedIdentity);
    await createThreadPlaceholder(
      threadId,
      question.slice(0, 20),
      task.userId,
      task.domainId,
      "deep_analysis"
    );
    const artifacts = await runDeepAnalysis({
      message: question,
      userId: task.userId,
      domainId: task.domainId,
      threadId,
      taskId: task.id,
      identity: runIdentity,
      agentId: task.agentId,
      token: task.token || "",
      apiKey: request.apiKey,
      onEvent: (event) => emitRunEvent(task.id, entry, event),
      signal: controller.signal,
      conversationTurn: request.conversationTurn,
      agentConfig: {
        executionMode: agent.executionMode,
        summarizerPrompt: agent.summarizerPrompt,
        conclusionMakerPrompt: agent.conclusionMakerPrompt,
        analysisDimensionPrompt: agent.analysisDimensionPrompt,
        enabledSkillIds: agent.enabledSkillIds,
        enabledVisualizationSkillIds: agent.enabledVisualizationSkillIds,
        reportDeliverableEnabled: agent.reportDeliverableEnabled,
      },
    });

    if (controller.signal.aborted && artifacts?.runState.status !== "completed")
      return await finishCancelled(request, cancelReason, entry);
    return await finishCompleted(request, question, artifacts, entry);
  } catch (error) {
    if (controller.signal.aborted) return await finishCancelled(request, cancelReason, entry);
    return await finishFailed(request, question, error, entry);
  } finally {
    if (timeout) clearTimeout(timeout);
    request.cancelSignal?.removeEventListener("abort", onExternalCancel);
    if (isActiveRun(task.id, entry)) {
      activeRuns.delete(task.id);
      taskEventBus.clearTask(task.id);
    }
  }
}

async function finishCompleted(
  request: AnalysisTaskRunRequest,
  question: string,
  artifacts: Awaited<ReturnType<typeof runDeepAnalysis>>,
  entry: ActiveAnalysisRun
): Promise<AnalysisTaskRunOutcome> {
  const { task, agent } = request;
  if (!artifacts) throw new Error(t("analysis.missingArtifacts"));
  const { resultSummary, resultReport, chartHtmls } = buildDeepAnalysisTaskResult(artifacts);

  // 已被新运行取代的旧运行不再向任务通道发终态，避免结束新运行的订阅。
  emitRunEvent(
    task.id,
    entry,
    buildAnalysisTaskTerminalEvent({
      taskId: task.id,
      status: "completed",
      resultSummary,
      resultReport,
      finalAnswer: artifacts.finalAnswer,
      requestSeq: entry.identity?.requestSeq,
    })
  );
  logger.info(tApp("analysis.task.task-runner.417", { id: task.id }));

  if (task.notifyOnComplete && task.notifyEmail) {
    try {
      await getEmailNotifyService().sendTaskCompleteNotification({
        to: task.notifyEmail,
        taskName: task.name,
        agentName: agent.name,
        question,
        report: resultReport,
        chartHtmls,
      });
    } catch (error) {
      logger.error(tApp("analysis.task.task-runner.418"), { taskId: task.id, error: describeError(error) });
    }
  }

  return { status: "completed" };
}

async function finishFailed(
  request: AnalysisTaskRunRequest,
  question: string,
  error: unknown,
  entry: ActiveAnalysisRun
): Promise<AnalysisTaskRunOutcome> {
  const { task, agent } = request;
  const errorMessage = describeError(error);
  logger.error(tApp("analysis.task.task-runner.419", { id: task.id }), { error: errorMessage });

  const resultSummary = tApp("analysis.task.task-runner.420", { errorMessage: errorMessage });
  await persistTermination(request, "failed", errorMessage, entry);
  emitRunEvent(
    task.id,
    entry,
    buildAnalysisTaskTerminalEvent({
      taskId: task.id,
      status: "failed",
      resultSummary,
      error: errorMessage,
      requestSeq: entry.identity?.requestSeq,
    })
  );

  if (task.notifyOnComplete && task.notifyEmail) {
    try {
      await getEmailNotifyService().sendTaskFailedNotification({
        to: task.notifyEmail,
        taskName: task.name,
        agentName: agent.name,
        question,
        errorMessage,
      });
    } catch (notifyError) {
      logger.error(tApp("analysis.task.task-runner.421"), {
        taskId: task.id,
        error: describeError(notifyError),
      });
    }
  }

  return { status: "failed", error };
}

async function finishCancelled(
  request: AnalysisTaskRunRequest,
  cancelReason: string | undefined,
  entry: ActiveAnalysisRun
): Promise<AnalysisTaskRunOutcome> {
  const taskId = request.task.id;
  await persistTermination(request, "cancelled", cancelReason, entry);
  emitRunEvent(
    taskId,
    entry,
    buildAnalysisTaskTerminalEvent({
      taskId,
      status: "cancelled",
      resultSummary: cancelReason,
      requestSeq: entry.identity?.requestSeq,
    })
  );
  logger.info(tApp("analysis.task.task-runner.422", { taskId: taskId }), cancelReason ? { reason: cancelReason } : undefined);
  return { status: "cancelled" };
}

/** 工作流尚未落终态（含初始化失败）时，仍经同一产物机制完成服务端收口。 */
async function persistTermination(
  request: AnalysisTaskRunRequest,
  status: "failed" | "cancelled",
  error: string | undefined,
  entry: ActiveAnalysisRun
): Promise<void> {
  const identity = entry.identity;
  const task = await getAnalysisTaskService().getTask(request.task.id, request.task.domainId);
  // 只有当前任务行仍属于本次运行时，它才是本运行的已写正文与受理序号；
  // 被新运行取代时不借用新运行的正文/序号，也不重复写新运行已经落定的终态。
  const belongsToRun = task
    ? isCurrentAnalysisRun(readAnalysisRunHistory(task.runHistory), identity ?? {})
    : false;
  const currentPayload = task?.analysisPayload;
  if (request.conversationTurn) {
    // 运行在工作流落终态之前失败/取消时，回合不能留在 running。
    // 先于“产物已终态”的早退收口，且只收口仍为 running 的该轮；真实落库错误照常抛出。
    const turns = await getAnalysisTaskService().listConversationTurns(request.task.id);
    const pendingTurn = turns.find(
      (turn) => turn.requestSeq === request.conversationTurn!.requestSeq
    );
    if (pendingTurn?.status === "running") {
      await getAnalysisTaskService().saveConversationTurn(request.task.id, {
        ...request.conversationTurn,
        status,
        error: error || request.conversationTurn.error,
      });
    }
  }
  if (belongsToRun && task?.status === status && currentPayload?.runState.status === status) return;
  if (!belongsToRun) {
    // 已被新运行取代：只补本运行自己的终态状态，不重造产物、不借用新运行的正文与序号。
    if (identity) {
      await getAnalysisTaskService().updateTaskStatus(request.task.id, status, {
        identity,
        ...(error ? { resultSummary: error } : {}),
      });
    }
    return;
  }
  const store = createDeepAnalysisArtifactStore({
    taskId: request.task.id,
    identity,
    requestSeq: task?.requestSeq,
    executionMode: request.agent.executionMode,
    initialPayload: currentPayload,
    emit: (event) => emitRunEvent(request.task.id, entry, event),
  });
  await store.finish(status, error);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
