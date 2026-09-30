import type {
  AnalysisTaskDetail as AnalysisTask,
  AnalysisTaskRun,
  AnalysisConversationTurn,
} from "@ontomato/contracts/analysis-task";
import type { AnalysisAgent } from "@ontomato/contracts/analysis-agent";
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  analysisAgentApi,
  analysisReportApi,
  analysisTaskApi,
  cancelFollowUpRun,
  streamFollowUp,
  streamFollowUpRun,
  streamTaskExecution,
} from "../api";
import type { Message, ResponseSnapshot } from "../../../types/chat";
import type { DeepAnalysisTaskPayload } from "@ontomato/contracts/analysis-presentation";
import { buildAssistantMessage } from "../../../utils/snapshot-helpers";
import { reduceDeepAnalysisEvent } from "../utils/deep-analysis-event-reducer";
import { authHost } from "../../../utils/auth";
import { t } from "../../../i18n";
import {
  buildReportSectionsFromDeepAnalysis,
  isDeepAnalysisReportStreaming,
  joinReportSections,
  orderReportSections,
  type ReportSection,
} from "../../../utils/analysis-report";
import { buildTaskProgressMap } from "../utils/taskProgress";
import { downloadPptx } from "../utils/ppt";
import { workbenchContent } from "../../../content";

const TASK_PAGE_SIZE = 50;

export interface TaskSession {
  taskId: string;
  agentId: string;
  threadId: string;
  taskName: string;
  messages: Message[];
  input: string;
  isLoading: boolean;
  streamingSnapshot: ResponseSnapshot | null;
  stopRequested: boolean;
  lastTaskEventSeq?: number;
  lastFollowUpEventSeq?: number;
  _followUpRunId?: string;
  _closeStream?: () => void;
  _closeTaskStream?: () => void;
  _onComplete?: (success: boolean) => void;
  _onCompleteCalled?: boolean;
}

function createRunId(prefix: string, id: string) {
  return `${prefix}-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useAnalysisStore = defineStore("analysis", () => {
  const agents = ref<AnalysisAgent[]>([]);
  const selectedAgentId = ref("");
  const tasks = ref<AnalysisTask[]>([]);
  const taskTotal = ref(0);
  const loadingTasks = ref(false);
  const currentTaskId = ref<string | null>(null);
  const sessions = ref<Record<string, TaskSession>>({});
  /** Draft instruction for a regular conversation that hasn't been persisted yet; empty when a report task has no current conversation. */
  const draftInput = ref("");
  const taskRuns = ref<AnalysisTaskRun[]>([]);
  const taskRunIndex = ref(0);
  const isCreatingPpt = ref(false);
  const isDownloadingReport = ref(false);
  const showAgentCreateDialog = ref(false);
  const editingAgent = ref<AnalysisAgent | null>(null);
  const sessionCache = new Map<string, ResponseSnapshot>();
  const pendingDeletions = new Set<string>();
  let taskListPollTimer: ReturnType<typeof setInterval> | null = null;
  let currentTaskPollTimer: ReturnType<typeof setInterval> | null = null;

  const currentTask = computed<AnalysisTask | null>(() =>
    currentTaskId.value ? tasks.value.find((task) => task.id === currentTaskId.value) || null : null
  );
  const activeSession = computed<TaskSession | null>(() =>
    currentTaskId.value ? sessions.value[currentTaskId.value] || null : null
  );
  const hasRunningTasks = computed(() => tasks.value.some((task) => task.status === "running"));
  const hasMoreTasks = computed(() => tasks.value.length < taskTotal.value);
  const taskProgressMap = computed(() => buildTaskProgressMap(tasks.value, sessions.value, t));
  const activeInput = computed({
    get: () => activeSession.value?.input ?? draftInput.value,
    set: (value: string) => {
      if (activeSession.value) activeSession.value.input = value;
      else draftInput.value = value;
    },
  });
  const selectedAgent = computed(
    () => agents.value.find((agent) => agent.id === selectedAgentId.value) || null
  );
  const isHarnessAgent = computed(() => selectedAgent.value?.reportDeliverableEnabled === false);
  /** Run history only belongs to report tasks; regular continuous conversations always show all turns, judged by the task's own delivery mode. */
  const isReportTask = computed(() => currentTask.value?.reportDeliverableEnabled !== false);
  const selectedRun = computed(() => taskRuns.value[taskRunIndex.value] || null);
  /** Single derivation entry: a non-report task, no run records, or the latest selected run all mean viewing the current conversation. */
  const isSelectedLatestRun = computed(
    () =>
      !isReportTask.value ||
      taskRuns.value.length === 0 ||
      taskRunIndex.value === taskRuns.value.length - 1
  );
  /** Read model for reviewing a selected historical run: the contract saves the report body per run, with no run-time snapshot. */
  const selectedRunMessages = computed<Message[]>(() => {
    const run = selectedRun.value;
    if (!run || isSelectedLatestRun.value) return activeSession.value?.messages ?? [];
    const messages: Message[] = [];
    if (currentTask.value?.question)
      messages.push({ id: 1, role: "user", content: currentTask.value.question });
    // The historical run's conversation view must use the deep analysis snapshot saved for that
    // run, not forge ordinary assistant messages from the report body, otherwise reviewing an old
    // run would directly show report content.
    if (run.snapshot) {
      const snapshot = {
        ...(run.snapshot as any),
        threadId: currentTask.value?.threadId,
        requestSeq: run.requestSeq,
        source: "history",
        status: (run.snapshot as any)?.status || (run.status as any),
      } as any;
      messages.push({
        id: 2,
        role: "assistant",
        content: snapshot.primaryText || "",
        snapshot,
      });
    } else {
      // Legacy data may only have report fields without a run-time snapshot. The report belongs
      // only to the report view and cannot be disguised as ordinary assistant messages in the
      // conversation view, otherwise reviewing an old run would show the report body.
      // Keep the user's question so the page clearly shows there is no replayable task process.
    }
    for (const followUp of run.followUpMessages || []) {
      messages.push({
        id: messages.length + 1,
        role: followUp.role,
        content: followUp.content,
        snapshot: followUp.snapshot as any,
      });
    }
    return messages;
  });
  const displayMessages = computed(() =>
    isSelectedLatestRun.value ? (activeSession.value?.messages ?? []) : selectedRunMessages.value
  );
  const displayStreamingSnapshot = computed(() =>
    isSelectedLatestRun.value ? (activeSession.value?.streamingSnapshot ?? null) : null
  );
  const displayIsLoading = computed(() =>
    isSelectedLatestRun.value ? (activeSession.value?.isLoading ?? false) : false
  );
  const displayTaskStatus = computed(() => selectedRun.value?.status || currentTask.value?.status);
  const showPendingTaskNotice = computed(
    () =>
      !!currentTask.value && currentTask.value.status === "pending" && !currentTask.value.lastRunAt
  );
  const reportDeepAnalysis = computed<DeepAnalysisTaskPayload | null>(() => {
    const selectedStatus = selectedRun.value?.status || currentTask.value?.status;
    if (selectedStatus === "cancelled") return null;
    const snapshot = activeSession.value?.streamingSnapshot;
    const deepAnalysis = snapshot?.deepAnalysis;
    if (
      deepAnalysis &&
      (deepAnalysis.sections.some((s) => !!s.markdown.trim()) || deepAnalysis.runState.error)
    ) {
      return deepAnalysis;
    }
    const messages = activeSession.value?.messages || [];
    for (let index = messages.length - 1; index >= 0; index--) {
      const archived = messages[index].snapshot?.deepAnalysis;
      if (
        archived &&
        (archived.sections.some((s) => !!s.markdown.trim()) || archived.runState.error)
      )
        return archived;
    }
    return null;
  });
  const reportSummaryPosition = computed(() => {
    const agentId = currentTask.value?.agentId || selectedAgentId.value;
    const agent = agents.value.find((item) => item.id === agentId);
    return agent?.summaryPosition === "top" ? "top" : "bottom";
  });
  const reportSections = computed<ReportSection[]>(() => {
    const run = selectedRun.value;
    if (run && !isSelectedLatestRun.value) {
      // Cancelled only means this run delivered no report; the cancel reason or stale body must never be treated as the report.
      const content = run.status === "cancelled" ? "" : run.resultReport || run.resultSummary || "";
      return orderReportSections(
        content ? [{ id: `run:${run.id}`, content }] : [],
        reportSummaryPosition.value
      );
    }
    if (reportDeepAnalysis.value) {
      return orderReportSections(
        buildReportSectionsFromDeepAnalysis(reportDeepAnalysis.value, {
          diagnosticLabel: "UnifiedReport",
        }),
        reportSummaryPosition.value
      );
    }
    const task = currentTask.value;
    const content = task?.status === "failed" ? task.resultSummary || "" : "";
    return orderReportSections(
      task && content ? [{ id: `task:${task.id}`, content }] : [],
      reportSummaryPosition.value
    );
  });
  const hasReportArtifact = computed(() =>
    reportSections.value.some((section) => Boolean(section.content.trim()))
  );
  const reportContent = computed(() => joinReportSections(reportSections.value));
  const isStreamingReport = computed(() =>
    isDeepAnalysisReportStreaming(activeSession.value?.streamingSnapshot)
  );
  const canCreatePpt = computed(
    () => Boolean(reportContent.value.trim()) && !isStreamingReport.value
  );

  async function loadAgents(): Promise<void> {
    try {
      agents.value = await analysisAgentApi.getEnabledAgents();
    } catch (error) {
      console.error(workbenchContent().console.loadAgentsFailed, error);
    }
  }

  async function loadTasks(options: { append?: boolean } = {}) {
    loadingTasks.value = true;
    try {
      const params: { agentId?: string; reportDeliverableEnabled?: boolean } = {};
      if (selectedAgentId.value) params.agentId = selectedAgentId.value;
      // Regular agents' conversations and report tasks are listed separately; the two modes are not mixed in the same task list.
      if (isHarnessAgent.value) params.reportDeliverableEnabled = false;
      if (options.append) {
        const page = await analysisTaskApi.listTaskPage({
          ...params,
          limit: TASK_PAGE_SIZE,
          offset: tasks.value.length,
        });
        taskTotal.value = page.total;
        tasks.value = [...tasks.value, ...page.tasks];
        return;
      }

      const loadedCount = Math.max(TASK_PAGE_SIZE, tasks.value.length || TASK_PAGE_SIZE);
      const firstPage = await analysisTaskApi.listTaskPage({
        ...params,
        limit: TASK_PAGE_SIZE,
        offset: 0,
      });
      taskTotal.value = firstPage.total;
      const refreshedTasks = [...firstPage.tasks];
      const targetCount = Math.min(loadedCount, firstPage.total);

      while (refreshedTasks.length < targetCount) {
        const page = await analysisTaskApi.listTaskPage({
          ...params,
          limit: TASK_PAGE_SIZE,
          offset: refreshedTasks.length,
        });
        if (page.tasks.length === 0) break;
        refreshedTasks.push(...page.tasks);
        taskTotal.value = page.total;
      }
      tasks.value = refreshedTasks;
    } catch (error) {
      console.error(workbenchContent().console.loadTasksFailed, error);
    } finally {
      loadingTasks.value = false;
    }
  }

  async function loadMoreTasks() {
    if (loadingTasks.value || !hasMoreTasks.value) return;
    await loadTasks({ append: true });
  }

  async function selectAgent(agentId: string) {
    selectedAgentId.value = agentId;
    await loadTasks();
  }

  function startTaskListPolling() {
    stopTaskListPolling();
    taskListPollTimer = setInterval(() => {
      if (hasRunningTasks.value && selectedAgentId.value !== undefined) loadTasks();
    }, 5000);
  }

  function stopTaskListPolling() {
    if (!taskListPollTimer) return;
    clearInterval(taskListPollTimer);
    taskListPollTimer = null;
  }

  function createSession(task: AnalysisTask): TaskSession {
    return {
      taskId: task.id,
      agentId: task.agentId,
      threadId: task.threadId || `task-${task.id}-${Date.now()}`,
      taskName: task.name,
      messages: [],
      input: "",
      isLoading: false,
      streamingSnapshot: null,
      stopRequested: false,
    };
  }

  function connectTaskStream(taskId: string, requestSeq?: number) {
    const session = sessions.value[taskId];
    if (!session || session._closeTaskStream) return;

    session.isLoading = true;
    const deepAnalysis = session.streamingSnapshot?.deepAnalysis;
    if (deepAnalysis?.runState.status !== "running") {
      session.streamingSnapshot = null;
    }
    session._onCompleteCalled = false;

    const eventHandler = createSSEEventHandler(session);
    const close = streamTaskExecution(taskId, {
      requestSeq,
      onOpen: () => {
        session.isLoading = true;
      },
      since: session.lastTaskEventSeq,
      onEvent: (event, meta) => {
        const seq = Number(meta?.lastEventId);
        if (Number.isFinite(seq)) session.lastTaskEventSeq = seq;
        if (session.stopRequested) return;
        if (event.type === "task_completed") {
          session.isLoading = false;
          if (session.streamingSnapshot) {
            session.streamingSnapshot =
              reduceDeepAnalysisEvent(session.streamingSnapshot, event) ||
              session.streamingSnapshot;
            session.messages.push(buildAssistantMessage(session.streamingSnapshot));
          }
          session.streamingSnapshot = null;
          session._closeTaskStream = undefined;
          // Lifecycle events don't carry the full artifact; share the authoritative recovery snapshot with the page review.
          void loadTaskHistory(taskId);
          return;
        }

        if (event.type === "task_cancelled" || event.type === "task_failed") {
          session.isLoading = false;
          session._closeTaskStream?.();
          session._closeTaskStream = undefined;
          if (session.streamingSnapshot) {
            session.streamingSnapshot =
              reduceDeepAnalysisEvent(session.streamingSnapshot, event) ||
              session.streamingSnapshot;
            session.messages.push(buildAssistantMessage(session.streamingSnapshot));
          }
          session.streamingSnapshot = null;
          void loadTaskHistory(taskId);
          return;
        }
        eventHandler(event);
      },
      onError: () => {
        session.isLoading = false;
        session._closeTaskStream = undefined;
      },
      onComplete: () => {
        session.isLoading = false;
        session._closeTaskStream = undefined;
      },
    });
    session._closeTaskStream = close;
  }

  async function openSession(task: AnalysisTask) {
    pendingDeletions.delete(task.id);
    if (!sessions.value[task.id]) {
      const session = createSession(task);
      const cached = sessionCache.get(task.id);
      if (cached) session.streamingSnapshot = cached;
      sessions.value[task.id] = session;
    }

    const session = sessions.value[task.id];
    if (session) {
      session.messages = [];
      await loadTaskHistory(task.id);
      if (session.messages.length === 0 && task.question) {
        session.messages.push({ id: Date.now(), role: "user", content: task.question });
      }
    }

    const runState =
      session?.streamingSnapshot?.deepAnalysis?.runState ||
      session?.messages.find((message) => message.snapshot?.deepAnalysis)?.snapshot?.deepAnalysis
        ?.runState ||
      task.runState;
    if ((runState?.status ?? task.status) === "running") connectTaskStream(task.id);
    if (session?.isLoading && session._followUpRunId && !session._closeStream) {
      connectFollowUpRun(session);
    }
  }

  function closeSession(taskId: string) {
    const session = sessions.value[taskId];
    if (session) {
      if (session.streamingSnapshot) {
        sessionCache.set(taskId, JSON.parse(JSON.stringify(session.streamingSnapshot)));
      }
      session._closeStream?.();
      session._closeStream = undefined;
      session._closeTaskStream?.();
      session._closeTaskStream = undefined;
    }

    if (!session?.isLoading && !session?._closeTaskStream && !session?._closeStream) {
      pendingDeletions.add(taskId);
      setTimeout(() => {
        if (pendingDeletions.has(taskId)) {
          pendingDeletions.delete(taskId);
          delete sessions.value[taskId];
        }
      }, 100);
    }
  }

  async function loadTaskHistory(taskId: string) {
    const session = sessions.value[taskId];
    if (!session) return;
    if (isHarnessTask(taskId)) {
      await loadConversationTurns(taskId);
      return;
    }
    try {
      const data = await analysisTaskApi.getTaskMessages(taskId);
      const historyMessages = data.messages || [];
      if (historyMessages.length === 0) return;

      let historyMapped: Message[] = historyMessages.map((msg: any, index: number) => {
        if (msg.role === "user") {
          return { id: Date.now() + index, role: "user" as const, content: msg.content };
        }
        return {
          id: Date.now() + index,
          role: "assistant" as const,
          content: msg.content,
          snapshot: msg.snapshot,
        };
      });

      const serverSnapshot = historyMapped.find(
        (message) => message.snapshot?.deepAnalysis
      )?.snapshot;
      if (serverSnapshot?.deepAnalysis) {
        const localSnapshot = session.streamingSnapshot?.deepAnalysis
          ? session.streamingSnapshot
          : session.messages.find((message) => message.snapshot?.deepAnalysis)?.snapshot;
        const serverState = serverSnapshot.deepAnalysis.runState;
        // Recovery uses the whole snapshot as the baseline; only a newer local activity tail can override a non-terminal baseline.
        const restored =
          serverState.status === "running" &&
          localSnapshot?.deepAnalysis &&
          serverState.revision < localSnapshot.deepAnalysis.runState.revision
            ? localSnapshot
            : serverSnapshot;
        const running = restored.deepAnalysis!.runState.status === "running";
        if (session.streamingSnapshot?.mode !== "standard") {
          session.streamingSnapshot = running ? restored : null;
          if (!running) session.isLoading = false;
        }
        if (!running) {
          if (sessionCache.get(taskId)?.deepAnalysis) sessionCache.delete(taskId);
          session._closeTaskStream?.();
          session._closeTaskStream = undefined;
        }
        historyMapped = historyMapped.flatMap((message) =>
          message.snapshot?.deepAnalysis
            ? running
              ? []
              : [{ ...message, content: restored.primaryText, snapshot: restored }]
            : [message]
        );
      }

      const historyUserContent = new Set(
        historyMapped
          .filter((message) => message.role === "user")
          .map((message) => message.content.trim())
      );
      const historyAssistantContent = new Set(
        historyMapped
          .filter((message) => message.role === "assistant")
          .map((message) => message.content.trim())
      );
      const localTail = session.messages.filter((message) => {
        if (message.snapshot?.deepAnalysis) return !serverSnapshot;
        const historyContent =
          message.role === "user" ? historyUserContent : historyAssistantContent;
        return !historyContent.has(message.content.trim());
      });
      session.messages = [...historyMapped, ...localTail];
    } catch (error) {
      console.error(workbenchContent().console.loadTaskHistoryFailed, error);
    }
  }

  function updateSnapshot(session: TaskSession, patch: Partial<ResponseSnapshot>) {
    const base = session.streamingSnapshot || {
      mode: "deep-analysis" as const,
      status: "streaming" as const,
      source: "live" as const,
      primaryText: "",
    };
    session.streamingSnapshot = {
      ...base,
      ...patch,
      deepAnalysis: patch.deepAnalysis || base.deepAnalysis,
    } as ResponseSnapshot;
  }

  function createFollowUpEventHandler(session: TaskSession) {
    return (event: any) => {
      if (session.stopRequested) return;
      switch (event.type) {
        case "run_started":
          session._followUpRunId = event.runId;
          break;
        case "follow_up_chunk": {
          const currentSnapshot = session.streamingSnapshot;
          updateSnapshot(session, {
            primaryText: (currentSnapshot?.primaryText || "") + (event.content || ""),
            mode: "standard",
            status: "streaming",
            source: "live",
          });
          break;
        }
        case "workflow_complete": {
          session.isLoading = false;
          if (session.streamingSnapshot) {
            session.streamingSnapshot.status = "completed";
            session.messages.push(buildAssistantMessage(session.streamingSnapshot));
          }
          session.streamingSnapshot = null;
          session._closeStream = undefined;
          if (!session._onCompleteCalled) {
            session._onCompleteCalled = true;
            session._onComplete?.(true);
          }
          break;
        }
        case "error": {
          session.isLoading = false;
          session._closeStream?.();
          updateSnapshot(session, {
            status: "failed",
            primaryText: `${t("chat.followUpFailed")}: ${event.error || t("common.unknownError")}`,
          });
          if (!session._onCompleteCalled) {
            session._onCompleteCalled = true;
            session._onComplete?.(false);
          }
          break;
        }
        case "run_cancelled": {
          session.isLoading = false;
          session._closeStream = undefined;
          session.streamingSnapshot = null;
          if (!session._onCompleteCalled) {
            session._onCompleteCalled = true;
            session._onComplete?.(false);
          }
          break;
        }
      }
    };
  }

  function updateFollowUpSeq(session: TaskSession, meta?: { lastEventId?: string }) {
    const seq = Number(meta?.lastEventId);
    if (Number.isFinite(seq)) session.lastFollowUpEventSeq = seq;
  }

  function pushFollowUpError(session: TaskSession, error: unknown) {
    session.isLoading = false;
    if (!session._onCompleteCalled) {
      session._onCompleteCalled = true;
      session._onComplete?.(false);
    }
    session.messages.push(
      buildAssistantMessage({
        mode: "error",
        status: "failed",
        source: "live",
        primaryText: `${t("diagnosis.requestFailed")}: ${error}`,
      })
    );
  }

  function connectFollowUpRun(session: TaskSession) {
    const handler = createFollowUpEventHandler(session);
    session._closeStream = streamFollowUpRun(session.threadId, {
      token: authHost().getToken() as string,
      since: session.lastFollowUpEventSeq,
      onEvent: (event, meta) => {
        updateFollowUpSeq(session, meta);
        handler(event);
      },
      onError: (error) => {
        if (!session.stopRequested) pushFollowUpError(session, error);
      },
      onComplete: () => {},
    });
  }

  function createSSEEventHandler(session: TaskSession) {
    return (event: any) => {
      if (session.stopRequested) return;
      const reduced = reduceDeepAnalysisEvent(session.streamingSnapshot, event);
      if (reduced) {
        session.streamingSnapshot = reduced;
        return;
      }
      if (event.type === "error") {
        session.isLoading = false;
        session._closeTaskStream?.();
        const message = event.error || t("common.unknownError");
        session.streamingSnapshot = {
          ...(session.streamingSnapshot || {
            mode: "deep-analysis",
            source: "live",
            primaryText: "",
          }),
          status: "failed",
          primaryText: `${t("analysis.analysisFailed")}: ${message}`,
        };
        if (!session._onCompleteCalled) {
          session._onCompleteCalled = true;
          session._onComplete?.(false);
        }
      }
    };
  }

  async function sendMessage(
    taskId: string,
    text?: string,
    onComplete?: (success: boolean) => void
  ) {
    const session = sessions.value[taskId];
    if (!session || session.isLoading) return;
    const submitText = (text || session.input).trim();
    if (!submitText) return;

    session.input = "";
    session.isLoading = true;
    session.stopRequested = false;
    session.streamingSnapshot = null;
    session._closeStream?.();
    session._closeStream = undefined;
    session._closeTaskStream?.();
    session._closeTaskStream = undefined;
    session._onComplete = onComplete;
    session._onCompleteCalled = false;
    session.lastFollowUpEventSeq = 0;
    session._followUpRunId = createRunId("analysis-follow-up", session.threadId || taskId);
    session.messages.push({ id: Date.now(), role: "user", content: submitText });
    if (!session.threadId) session.threadId = `task-${session.taskId}-${Date.now()}`;

    if (isHarnessTask(taskId)) {
      // Regular conversations' follow-up instructions always go through /turns; only follow-ups after a report completes go through /follow-up.
      try {
        const accepted = await analysisTaskApi.continueConversation(taskId, submitText);
        if (sessions.value[taskId] !== session) return;
        connectTaskStream(taskId, accepted.requestSeq);
        startCurrentTaskPolling(taskId);
        await loadTasks();
      } catch (error) {
        pushFollowUpError(session, error);
      }
      return;
    }

    try {
      const handler = createFollowUpEventHandler(session);
      session._closeStream = streamFollowUp(submitText, {
        threadId: session.threadId,
        agentId: session.agentId,
        token: authHost().getToken() as string,
        runId: session._followUpRunId,
        onEvent: (event, meta) => {
          updateFollowUpSeq(session, meta);
          handler(event);
        },
        onError: (error) => pushFollowUpError(session, error),
        onComplete: () => {},
      });
    } catch (error) {
      pushFollowUpError(session, error);
    }
  }

  function stopGenerating(taskId: string) {
    const session = sessions.value[taskId];
    if (!session) return;
    session.stopRequested = true;
    if (session._closeStream) {
      void cancelFollowUpRun(session.threadId, session._followUpRunId).catch(() => {});
    }
    session._closeStream?.();
    session._closeStream = undefined;
    session._closeTaskStream?.();
    session._closeTaskStream = undefined;

    if (session.streamingSnapshot) {
      const old = session.streamingSnapshot;
      if (old.mode === "standard") {
        session.messages.push(
          buildAssistantMessage({ ...old, status: "completed", stoppedByUser: true })
        );
        session.streamingSnapshot = null;
      } else {
        session.streamingSnapshot = {
          ...old,
          stoppedByUser: true,
          deepAnalysis: old.deepAnalysis
            ? {
                ...old.deepAnalysis,
                runState:
                  old.deepAnalysis.runState.status === "running"
                    ? { ...old.deepAnalysis.runState, status: "cancelled" }
                    : old.deepAnalysis.runState,
              }
            : old.deepAnalysis,
        };
      }
    }
    session.isLoading = false;
  }

  /** The task's own delivery mode takes precedence over the agent's current config: saved conversations don't switch views when config changes. */
  function isHarnessTask(taskId: string): boolean {
    const task = tasks.value.find((item) => item.id === taskId);
    const agentId = task?.agentId || sessions.value[taskId]?.agentId;
    const agent = agents.value.find((item) => item.id === agentId);
    const reportDeliverable = task?.reportDeliverableEnabled ?? agent?.reportDeliverableEnabled;
    return reportDeliverable === false;
  }

  /** Convert a regular conversation single turn's server-side facts into the page read model; the delivered body and the report body are separated. */
  function conversationTurnSnapshot(
    turn: AnalysisConversationTurn,
    threadId: string | undefined
  ): ResponseSnapshot {
    const status =
      turn.status === "failed" ? "failed" : turn.status === "running" ? "streaming" : "completed";
    return {
      mode: "deep-analysis",
      status,
      source: "history",
      threadId,
      requestSeq: turn.requestSeq,
      primaryText: turn.finalAnswer || "",
      trace: turn.messages,
      deepAnalysis: {
        executionMode: "loop",
        runState: {
          status: turn.status,
          revision: turn.requestSeq,
          progress: {
            done: turn.activities.filter((activity) => activity.status !== "running").length,
            label: "",
          },
        },
        activities: turn.activities,
        sections: [],
        charts: turn.charts,
        chartDiagnostics: turn.chartDiagnostics,
        finalAnswer: turn.finalAnswer,
      },
    };
  }

  async function loadConversationTurns(taskId: string) {
    const session = sessions.value[taskId];
    if (!session) return;
    try {
      const turns = await analysisTaskApi.getTurns(taskId);
      const threadId = tasks.value.find((item) => item.id === taskId)?.threadId;
      const messages: Message[] = [];
      let messageId = 1;
      for (const turn of turns) {
        messages.push({ id: messageId++, role: "user", content: turn.userMessage });
        if (turn.status === "running") {
          session.streamingSnapshot = conversationTurnSnapshot(turn, threadId);
          continue;
        }
        messages.push({
          id: messageId++,
          role: "assistant",
          content: turn.finalAnswer || "",
          snapshot: conversationTurnSnapshot(turn, threadId),
        });
      }
      session.messages = messages;
    } catch (error) {
      console.error(workbenchContent().console.loadConversationTurnsFailed, error);
    }
  }

  async function loadRuns(taskId: string) {
    if (!isReportTask.value) {
      taskRuns.value = [];
      taskRunIndex.value = 0;
      return;
    }
    try {
      const runs = await analysisTaskApi.listRuns(taskId);
      if (currentTaskId.value !== taskId) return;
      taskRuns.value = runs;
      taskRunIndex.value = Math.max(0, runs.length - 1);
    } catch (error) {
      console.error(workbenchContent().console.loadRunHistoryFailed, error);
    }
  }

  function selectRun(index: number) {
    if (index < 0 || index >= taskRuns.value.length) return;
    taskRunIndex.value = index;
  }

  /** Rerun reuses the same task identity: the server appends a run record and the page returns to that task's conversation view. */
  function resetTaskRun(task: AnalysisTask) {
    const session = sessions.value[task.id] || createSession(task);
    session._closeStream?.();
    session._closeStream = undefined;
    session._closeTaskStream?.();
    session._closeTaskStream = undefined;
    session.messages = task.question
      ? [{ id: Date.now(), role: "user", content: task.question }]
      : [];
    session.streamingSnapshot = null;
    session.isLoading = false;
    session.stopRequested = false;
    session.lastTaskEventSeq = undefined;
    session.lastFollowUpEventSeq = undefined;
    session._onCompleteCalled = false;
    sessionCache.delete(task.id);
    sessions.value[task.id] = session;
  }

  async function rerunTask(task: AnalysisTask) {
    try {
      const optimistic = { ...task, status: "running" as const };
      const index = tasks.value.findIndex((item) => item.id === task.id);
      if (index >= 0) tasks.value.splice(index, 1, optimistic);
      currentTaskId.value = task.id;
      taskRunIndex.value = Math.max(0, taskRuns.value.length - 1);
      resetTaskRun(optimistic);
      await analysisTaskApi.executeTask(task.id);
      connectTaskStream(task.id);
      startTaskListPolling();
      startCurrentTaskPolling(task.id);
    } catch (error: any) {
      await loadTasks();
      ElMessage.error(error?.message || t("analysis.analysisFailed"));
    }
  }

  /** First instruction of a regular conversation: first create a reportless task and start the first turn, then enter that conversation. */
  async function startConversation() {
    const agentId = selectedAgentId.value;
    const question = draftInput.value.trim();
    if (!agentId || !question || !isHarnessAgent.value) return;
    draftInput.value = "";
    try {
      const task = await analysisTaskApi.createTask({
        agentId,
        name: question.slice(0, 40),
        question,
        executeImmediately: true,
      });
      currentTaskId.value = task.id;
      await loadTasks();
      await openSession(task);
      startCurrentTaskPolling(task.id);
    } catch (error: any) {
      draftInput.value = question;
      ElMessage.error(error?.message || t("analysis.taskCreateFailed"));
    }
  }

  function stopCurrentTaskPolling() {
    if (!currentTaskPollTimer) return;
    clearInterval(currentTaskPollTimer);
    currentTaskPollTimer = null;
  }

  function startCurrentTaskPolling(taskId: string) {
    currentTaskPollTimer = setInterval(async () => {
      try {
        const updated = await analysisTaskApi.getTask(taskId);
        const index = tasks.value.findIndex((task) => task.id === taskId);
        if (index >= 0) tasks.value.splice(index, 1, updated);
        const current = index >= 0 ? tasks.value[index] : updated;
        if (current.status === "running") {
          const session = sessions.value[current.id];
          if (session && !session.isLoading && !session._closeTaskStream) {
            connectTaskStream(current.id);
          }
        }
        if (
          current.status === "completed" ||
          current.status === "failed" ||
          current.status === "cancelled"
        ) {
          const session = sessions.value[taskId];
          if (session?.stopRequested) {
            session.streamingSnapshot = null;
            session.stopRequested = false;
            await loadTaskHistory(taskId);
          }
          stopCurrentTaskPolling();
          await loadRuns(taskId);
        }
      } catch {
        // Polling failed, silently ignore
      }
    }, 3000);
  }

  async function selectTask(task: AnalysisTask, updateView: (view: "chat" | "report") => void) {
    currentTaskId.value = task.id;
    taskRuns.value = [];
    taskRunIndex.value = 0;
    let detailTask = task;
    try {
      detailTask = await analysisTaskApi.getTask(task.id);
      const index = tasks.value.findIndex((item) => item.id === detailTask.id);
      if (index >= 0) tasks.value.splice(index, 1, detailTask);
      else tasks.value.unshift(detailTask);
    } catch (error) {
      console.error(workbenchContent().console.loadTaskDetailFailed, error);
    }

    updateView("chat");
    await openSession(detailTask);
    await loadRuns(detailTask.id);
    if (detailTask.status === "running" || detailTask.status === "pending") {
      startCurrentTaskPolling(detailTask.id);
    }
    if (isHistoricalTask(detailTask) && hasReportArtifact.value) updateView("report");
  }

  function closeCurrentTask() {
    stopCurrentTaskPolling();
    if (!currentTaskId.value) return;
    closeSession(currentTaskId.value);
    currentTaskId.value = null;
  }

  function isHistoricalTask(task: AnalysisTask) {
    return task.status === "completed" || task.status === "failed" || task.status === "cancelled";
  }

  async function deleteTask(taskId: string) {
    try {
      await ElMessageBox.confirm(t("analysis.deleteTaskConfirm"), t("common.deleteConfirm"), {
        confirmButtonText: t("common.delete"),
        cancelButtonText: t("common.cancel"),
        type: "warning",
      });
    } catch {
      return;
    }
    try {
      await analysisTaskApi.deleteTask(taskId);
      await loadTasks();
      if (currentTaskId.value === taskId) closeCurrentTask();
      ElMessage.success(t("analysis.taskDeleted"));
    } catch (error: any) {
      ElMessage.error(error?.message || t("analysis.deleteFailed"));
    }
  }

  async function stopTask(taskId: string) {
    try {
      await ElMessageBox.confirm(t("analysis.stopTaskConfirm"), t("common.deleteConfirm"), {
        confirmButtonText: t("analysis.stopTask"),
        cancelButtonText: t("common.cancel"),
        type: "warning",
      });
    } catch {
      return;
    }
    try {
      stopGenerating(taskId);
      if (currentTaskId.value === taskId) closeCurrentTask();
      await analysisTaskApi.cancelTask(taskId);
      await loadTasks();
      ElMessage.success(t("analysis.taskStopped"));
    } catch (error: any) {
      ElMessage.error(error?.message || t("analysis.stopFailed"));
    }
  }

  async function createTask(
    onCreated: (task: AnalysisTask) => void,
    agentId: string,
    _agentName: string,
    taskTitle?: string,
    params?: {
      scheduleEnabled: boolean;
      scheduleExpression: string;
      scheduleFrequency: string;
      scheduleTime: string;
      emailEnabled: boolean;
      emailRecipient: string;
    }
  ) {
    if (!taskTitle) return;
    try {
      const task = await analysisTaskApi.createTask({
        agentId,
        name: taskTitle,
        question: taskTitle,
        executeImmediately: !params?.scheduleEnabled,
        scheduleEnabled: params?.scheduleEnabled ?? false,
        scheduleExpression: params?.scheduleExpression ?? "",
        notifyEmail: params?.emailRecipient ?? "",
        notifyOnComplete: params?.emailEnabled ?? false,
      });
      await loadTasks();
      onCreated(task);
      ElMessage.success(
        params?.scheduleEnabled
          ? t("analysis.scheduledTaskCreated", { name: task.name })
          : t("analysis.taskCreated", { name: task.name })
      );
    } catch (error: any) {
      ElMessage.error(error?.message || t("analysis.taskCreateFailed"));
    }
  }

  async function stopCurrentAnalysis() {
    const task = currentTask.value;
    if (!task) return;
    stopGenerating(task.id);
    try {
      await analysisTaskApi.cancelTask(task.id);
      await loadTasks();
    } catch {
      // Cancel request failed, silently ignore
    }
  }

  function updateActiveInput(value: string) {
    activeInput.value = value;
  }

  function sendCurrentMessage() {
    if (currentTask.value) return sendMessage(currentTask.value.id);
    if (isHarnessAgent.value) return startConversation();
  }

  function editAnalysisAgent(agent: AnalysisAgent) {
    editingAgent.value = { ...agent };
    showAgentCreateDialog.value = true;
  }

  async function refreshAgentsAfterEdit() {
    const refresh = loadAgents();
    editingAgent.value = null;
    await refresh;
  }

  function saveSchedule(settings: {
    frequency: string;
    time: string;
    dayOfWeek: number;
    dayOfMonth: number;
    emailNotify: boolean;
    emails: string;
  }) {
    const task = currentTask.value;
    if (!task) return;
    const scheduleMap: Record<string, string> = {
      [t("analysis.everyDay")]: "1d",
      [t("analysis.everyWeek")]: "7d",
      [t("analysis.everyMonth")]: "30d",
    };
    let scheduleExpression = `${scheduleMap[settings.frequency] || "1d"}@${settings.time}`;
    if (settings.frequency === t("analysis.everyWeek")) {
      scheduleExpression += `/${settings.dayOfWeek}`;
    } else if (settings.frequency === t("analysis.everyMonth")) {
      scheduleExpression += `/${settings.dayOfMonth}`;
    }

    analysisTaskApi
      .updateTask(task.id, {
        scheduleEnabled: true,
        scheduleExpression,
        notifyEmail: settings.emails || undefined,
        notifyOnComplete: settings.emailNotify && !!settings.emails,
      })
      .then(() => {
        ElMessage.success(t("analysis.scheduleSaved"));
        loadTasks();
      })
      .catch((error: any) => {
        ElMessage.error(error?.message || t("analysis.scheduleSaveFailed"));
      });
  }

  async function downloadReport() {
    const markdown = reportContent.value;
    if (!markdown.trim()) {
      ElMessage.warning(t("analysis.noReportContent"));
      return;
    }
    isDownloadingReport.value = true;
    try {
      const blob = await analysisReportApi.exportPdf({ markdown, renderInlineCharts: true });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      link.href = url;
      link.download = `${workbenchContent().reportPdfFilePrefix}${timestamp}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      ElMessage.success(t("analysis.reportDownloadStarted"));
    } catch (error: any) {
      ElMessage.error(error?.message || t("analysis.reportDownloadFailed"));
    } finally {
      isDownloadingReport.value = false;
    }
  }

  async function createPpt() {
    if (!canCreatePpt.value || isCreatingPpt.value) return;
    isCreatingPpt.value = true;
    try {
      await downloadPptx(
        currentTask.value?.name || t("analysis.comprehensiveSummary"),
        reportSections.value
      );
      ElMessage.success(t("analysis.pptGenerated"));
    } catch (error: any) {
      ElMessage.error(error?.message || t("analysis.pptGenerateFailed"));
    } finally {
      isCreatingPpt.value = false;
    }
  }

  function disposeWorkbench() {
    stopTaskListPolling();
    closeCurrentTask();
  }

  return {
    agents,
    selectedAgentId,
    tasks,
    taskTotal,
    loadingTasks,
    currentTaskId,
    currentTask,
    selectedAgent,
    isHarnessAgent,
    isReportTask,
    taskRuns,
    taskRunIndex,
    selectedRun,
    isSelectedLatestRun,
    selectedRunMessages,
    displayMessages,
    displayStreamingSnapshot,
    displayIsLoading,
    displayTaskStatus,
    sessions,
    activeSession,
    hasMoreTasks,
    taskProgressMap,
    activeInput,
    showPendingTaskNotice,
    reportSections,
    hasReportArtifact,
    reportContent,
    isStreamingReport,
    canCreatePpt,
    isCreatingPpt,
    isDownloadingReport,
    showAgentCreateDialog,
    editingAgent,
    loadAgents,
    loadTasks,
    loadMoreTasks,
    selectAgent,
    startTaskListPolling,
    stopTaskListPolling,
    openSession,
    closeSession,
    connectTaskStream,
    loadTaskHistory,
    sendMessage,
    stopGenerating,
    stopCurrentTaskPolling,
    selectTask,
    closeCurrentTask,
    deleteTask,
    stopTask,
    createTask,
    rerunTask,
    selectRun,
    startConversation,
    stopCurrentAnalysis,
    updateActiveInput,
    sendCurrentMessage,
    editAnalysisAgent,
    refreshAgentsAfterEdit,
    saveSchedule,
    downloadReport,
    createPpt,
    disposeWorkbench,
  };
});
