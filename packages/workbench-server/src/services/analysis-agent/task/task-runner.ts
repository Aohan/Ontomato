import { t } from "../../../i18n";
import { createDeepAnalysisArtifactStore } from "./artifacts";
import type { AnalysisAgent } from "@ontomato/contracts/analysis-agent";
import type { RequestIdentity } from "@ontomato/contracts/identity";
/**
 * Analysis task run orchestrator: the only implementation of one deep-analysis run.
 *
 * The three entry points — page conversation stream, scheduled dispatch, and MCP — own only their trigger surfaces (HTTP/SSE shells, polling and claim,
 * timeout firing). The orchestration between running and the terminal state — execution, event publishing, result assembly, terminal-state writing,
 * email notification, and cancellation semantics — lives here, so entry points stop re-implementing it.
 *
 * Two invariants:
 * - Execution events are published only through `TaskEventBus` (by taskId), the single channel for task execution events;
 * - Execution failure returns as `AnalysisTaskRunOutcome`; terminal-state persistence failures keep throwing and are never disguised as completion.
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
 * Tasks currently running in this process; each entry also carries the run identity captured at acceptance.
 * Registering a new run supersedes the old entry; the old run detects it has been superseded and stops emitting terminal events or cleaning channels.
 */
interface ActiveAnalysisRun {
  controller: AbortController;
  identity?: AnalysisRunIdentity;
}

const activeRuns = new Map<string, ActiveAnalysisRun>();

export interface AnalysisTaskRunRequest {
  /** The task row already created or claimed, advanced to running and the terminal state by the orchestrator */
  task: AnalysisTask;
  /** The analysis agent already resolved by the entry point */
  agent: AnalysisAgent;
  /** Identity already verified by an online entry; an offline task only holds the saved tk and must verify inside the run. */
  verifiedIdentity?: Pick<RequestIdentity, "userId" | "domainId">;
  /** The user API key for the MCP entry; page and scheduler use the token on the task row */
  apiKey?: string;
  /** External cancellation trigger provided by the entry; the AbortController stays with the orchestrator */
  cancelSignal?: AbortSignal;
  /** Abort timeout in milliseconds; on expiry treated as cancellation, with the reason written into the terminal state */
  timeoutMs?: number;
  /** The current turn of a regular session; when provided the run executes as a conversation turn and the terminal state also finalizes that turn. */
  conversationTurn?: AnalysisConversationTurnRecord;
}

export type AnalysisTaskRunOutcome =
  | { status: "completed" }
  | { status: "cancelled" }
  | { status: "failed"; error: unknown };

export interface AnalysisTaskRunHandle {
  /** The task row already set to running */
  task: AnalysisTask;
  /** This run's terminal state; terminal-state persistence failures reject */
  completion: Promise<AnalysisTaskRunOutcome>;
}

/** Aborts the run of the given task; returns false when the task is not running in this process. */
export function cancelAnalysisTaskRun(taskId: string): boolean {
  const entry = activeRuns.get(taskId);
  if (!entry || entry.controller.signal.aborted) return false;
  entry.controller.abort();
  logger.info(tApp("analysis.task.task-runner.413", { taskId: taskId }));
  return true;
}

/** Whether this run is still the run registered for the task; once superseded by a new run it stops producing terminal states or cleanup actions. */
function isActiveRun(taskId: string, entry: ActiveAnalysisRun): boolean {
  return activeRuns.get(taskId) === entry;
}

/** Events reach the task channel only while this run is still the registered run; a superseded old run must never pollute the new run's stream. */
function emitRunEvent(taskId: string, entry: ActiveAnalysisRun, event: AnalysisStreamEvent): void {
  if (isActiveRun(taskId, entry)) taskEventBus.emit(taskId, event);
}

/**
 * Starts one task run: advances the task to running and returns the running task row first, while execution itself continues on `completion`.
 * Entry points use the returned row when they must answer immediately (MCP submission, page run_started) and await `completion` when they need the result.
 */
export function startAnalysisTaskRun(
  request: AnalysisTaskRunRequest
): Promise<AnalysisTaskRunHandle> {
  return runWithLogContext(
    {
      taskId: request.task.id,
      domainId: request.task.domainId,
      token: request.task.token || undefined,
      apiKey: request.apiKey || undefined,
    },
    async () => {
      const { task } = request;
      const entry: ActiveAnalysisRun = {
        controller: new AbortController(),
        identity: currentAnalysisRunIdentity(task.runHistory, request.conversationTurn?.requestSeq),
      };
      activeRuns.set(task.id, entry);
      // A new run starts from a clean channel: the old run's event buffers and cleanup timers do not belong to it.
      taskEventBus.beginRun(task.id);

      const threadId = task.threadId || `task-${task.id}`;
      if (!task.threadId) {
        try {
          await getAnalysisTaskService().updateTaskThread(task.id, threadId);
        } catch (error) {
          logger.error(tApp("analysis.task.task-runner.414"), { taskId: task.id, error: describeError(error) });
        }
      }

      // Acceptance (tryStartTask / claimConversationTurn) already set running atomically and appended the run record,
      // so no extra identity-less running write happens here: that would flip a terminal state back to running between cancellation and a new run.
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

  /** A timeout is one kind of cancellation reason; after cancellation the unified terminal-state path persists it, never a second terminal-state writer. */
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

  // An old run superseded by a new run no longer publishes terminal states to the task channel, avoiding ending the new run's subscriptions.
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

/** When the workflow has not persisted a terminal state (including initialization failure), server-side finalization still completes through the same artifact mechanism. */
async function persistTermination(
  request: AnalysisTaskRunRequest,
  status: "failed" | "cancelled",
  error: string | undefined,
  entry: ActiveAnalysisRun
): Promise<void> {
  const identity = entry.identity;
  const task = await getAnalysisTaskService().getTask(request.task.id, request.task.domainId);
  // Only while the current task row still belongs to this run does it hold this run's written body and acceptance sequence;
  // once superseded, the run neither borrows the new run's body/sequence nor rewrites the terminal state the new run has already settled.
  const belongsToRun = task
    ? isCurrentAnalysisRun(readAnalysisRunHistory(task.runHistory), identity ?? {})
    : false;
  const currentPayload = task?.analysisPayload;
  if (request.conversationTurn) {
    // When a run fails or is cancelled before the workflow persists a terminal state, the turn must not stay running.
    // This precedes the "artifacts already terminal" early exit and finalizes only the turn still running; real persistence errors still throw.
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
    // Superseded by a new run: only this run's own terminal status is backfilled — artifacts are not rebuilt, and the new run's body and sequence are never borrowed.
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
