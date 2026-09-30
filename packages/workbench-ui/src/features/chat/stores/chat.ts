import { computed, nextTick, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import { ElMessage, ElMessageBox } from "element-plus";
import type {
  ResponseSnapshot,
  Message,
  ExecutionSnapshotStep,
  SendMessageOverrides,
} from "../../../types/chat";
import { createDeepAnalysisSender } from "../../analysis";
import { createStandardSender } from "../composables/useStandardStream";
import {
  buildAssistantMessage,
  finalizeSnapshotOnStop,
  hasMeaningfulSnapshot,
  normalizeHistorySnapshot,
} from "../../../utils/snapshot-helpers";
import { authHost } from "../../../utils/auth";
import { cancelDeepAnalysisRun } from "../../analysis";
import { chatApi } from "../api";
import { t } from "../../../i18n";
import type { QAThread } from "../../workbench";
import {
  forgetCurrentQaThread,
  rememberCurrentQaThread,
  restoreCurrentQaThread,
} from "../utils/current-qa-thread";
import { workbenchContent } from "../../../content";

const QA_THREAD_PAGE_SIZE = 50;

function getCurrentOwnerId(): string {
  const userInfo = authHost().getUserInfo();
  return userInfo?.userId || userInfo?.loginCode || userInfo?.userName || "anonymous";
}

export const useChatStore = defineStore("chat", () => {
  const messages = ref<Message[]>([]);
  const tailRevision = ref(0);
  const input = ref("");
  const isLoading = ref(false);
  const currentThreadId = ref(`thread-${Date.now()}`);
  const isCurrentThreadPersisted = ref(false);
  const currentThreadTitle = ref(t("chat.newConversation"));
  const isSelectingThread = ref(false);
  const streamingSnapshot = ref<ResponseSnapshot | null>(null);
  const currentEventSource = shallowRef<Pick<EventSource, "close"> | null>(null);
  const stopRequested = ref(false);
  const currentAgentId = ref<string | undefined>(undefined);
  const pendingAnalysisMode = ref(false);
  const hasSettledTitle = ref(false);
  const threads = ref<QAThread[]>([]);
  const fetchingThreads = ref(false);
  const threadTotal = ref(0);
  let threadSelection = 0;

  const hasMoreThreads = computed(() => threads.value.length < threadTotal.value);
  const threadsLoading = computed(() => fetchingThreads.value || isSelectingThread.value);
  const showWelcome = computed(
    () => !isCurrentThreadPersisted.value && messages.value.length === 0
  );
  const graphNodeIds = computed(() => {
    for (let index = messages.value.length - 1; index >= 0; index--) {
      const message = messages.value[index];
      if (message.role === "assistant" && message.snapshot?.graphNodeIds?.length) {
        return message.snapshot.graphNodeIds;
      }
    }
    return [];
  });

  const updateStreamingSnapshot = (patch: Partial<ResponseSnapshot>) => {
    const base = streamingSnapshot.value || {
      mode: currentAgentId.value ? "deep-analysis" : "standard",
      status: "streaming",
      source: "live",
      primaryText: "",
      executionSteps: [],
    };

    const nextSnapshot: ResponseSnapshot = {
      ...base,
      ...patch,
      executionSteps: patch.executionSteps || base.executionSteps || [],
      execution: patch.execution || base.execution,
      datasets: patch.datasets || base.datasets,
      graphNodeIds: patch.graphNodeIds || base.graphNodeIds,
      deepAnalysis: patch.deepAnalysis || base.deepAnalysis,
    };

    streamingSnapshot.value = nextSnapshot;

    const lastMsg = messages.value[messages.value.length - 1];
    if (
      lastMsg &&
      lastMsg.role === "assistant" &&
      (lastMsg.snapshot?.status === "streaming" ||
        (nextSnapshot.mode === "deep-analysis" &&
          nextSnapshot.runId &&
          lastMsg.snapshot?.runId === nextSnapshot.runId))
    ) {
      messages.value[messages.value.length - 1] = { ...lastMsg, snapshot: nextSnapshot };
    }
  };

  const resetStreamingState = () => {
    streamingSnapshot.value = null;
  };

  const clearCurrentEventSource = () => {
    currentEventSource.value?.close();
    currentEventSource.value = null;
  };

  const detachCurrentStream = () => {
    threadSelection++;
    isSelectingThread.value = false;
    if (currentEventSource.value) {
      stopRequested.value = true;
      clearCurrentEventSource();
    }
    isLoading.value = false;
    resetStreamingState();
  };

  const updateThreadTitleByText = (text: string) => {
    currentThreadTitle.value =
      text.trim().replace(/\n/g, " ").slice(0, 24) || t("chat.newConversation");
  };

  const addOrUpdateExecutionStep = (step: ExecutionSnapshotStep) => {
    const existing = streamingSnapshot.value?.executionSteps || [];
    const next = [...existing];
    const index = next.findIndex((item) => item.id === step.id || item.name === step.name);
    if (index >= 0) {
      next[index] = { ...next[index], ...step };
    } else {
      next.push(step);
    }
    updateStreamingSnapshot({ executionSteps: next });
  };

  const { sendDeepAnalysisMessage } = createDeepAnalysisSender({
    messages,
    tailRevision,
    streamingSnapshot,
    currentAgentId,
    currentThreadId,
    currentThreadTitle,
    isLoading,
    stopRequested,
    currentEventSource,
    updateStreamingSnapshot,
    resetStreamingState,
    clearCurrentEventSource,
  });

  const { sendStandardMessage, resumeStandardMessage } = createStandardSender({
    messages,
    tailRevision,
    isLoading,
    stopRequested,
    streamingSnapshot,
    currentThreadId,
    currentThreadTitle,
    currentEventSource,
    updateStreamingSnapshot,
    resetStreamingState,
    clearCurrentEventSource,
    addOrUpdateExecutionStep,
    hasSettledTitle,
  });

  function addThread(threadId: string, title: string) {
    if (!threads.value.some((thread) => thread.threadId === threadId)) {
      const now = new Date().toISOString();
      threads.value.unshift({ threadId, title, createdAt: now, updatedAt: now, messageCount: 0 });
    }
    isCurrentThreadPersisted.value = true;
  }

  function updateThreadTimestamp(threadId: string) {
    const thread = threads.value.find((item) => item.threadId === threadId);
    if (!thread) return;
    thread.updatedAt = new Date().toISOString();
    threads.value = [thread, ...threads.value.filter((item) => item.threadId !== threadId)];
  }

  function updateThreadTitle(threadId: string, title: string) {
    const thread = threads.value.find((item) => item.threadId === threadId);
    if (thread) thread.title = title;
  }

  async function loadThreads(options: { append?: boolean } = {}): Promise<void> {
    fetchingThreads.value = true;
    try {
      const offset = options.append ? threads.value.length : 0;
      const data = await chatApi.listThreads(QA_THREAD_PAGE_SIZE, offset);
      const nextThreads = data.threads || (Array.isArray(data) ? data : []);
      threadTotal.value = Number(data.total || nextThreads.length || 0);
      threads.value = options.append ? [...threads.value, ...nextThreads] : nextThreads;
      const current = threads.value.find((thread) => thread.threadId === currentThreadId.value);
      if (current?.title) currentThreadTitle.value = current.title;
    } catch (error) {
      console.error(workbenchContent().console.loadQaThreadsFailed, error);
    } finally {
      fetchingThreads.value = false;
    }
  }

  async function restoreCurrentThread() {
    if (currentEventSource.value || isSelectingThread.value) return;
    const threadId = restoreCurrentThreadId();
    if (!threadId) return;
    await selectThread({
      threadId,
      title: threads.value.find((thread) => thread.threadId === threadId)?.title,
    });
  }

  async function loadMoreThreads() {
    if (threadsLoading.value || !hasMoreThreads.value) return;
    await loadThreads({ append: true });
  }

  async function stopGenerating() {
    if (!isLoading.value) return;

    stopRequested.value = true;
    const currentRunId = streamingSnapshot.value?.runId;
    const cancelRequest = currentAgentId.value
      ? cancelDeepAnalysisRun(currentThreadId.value, currentRunId)
      : chatApi.cancelRun(currentThreadId.value, currentRunId);
    await cancelRequest.catch(() => {});
    clearCurrentEventSource();

    if (streamingSnapshot.value && hasMeaningfulSnapshot(streamingSnapshot.value)) {
      const finalizedSnapshot = finalizeSnapshotOnStop(streamingSnapshot.value);
      updateStreamingSnapshot({ stoppedByUser: true } as any);
      streamingSnapshot.value = finalizedSnapshot;
    }

    isLoading.value = false;
    resetStreamingState();
    await nextTick();
    tailRevision.value++;
  }

  async function sendMessage(
    textOverride?: SendMessageOverrides,
    { updateThreadList = true }: { updateThreadList?: boolean } = {}
  ) {
    const override =
      typeof textOverride === "string"
        ? { submitText: textOverride, displayText: textOverride }
        : textOverride;

    const submitText = (override?.submitText ?? input.value).trim();
    const displayText = (override?.displayText ?? override?.submitText ?? input.value).trim();

    if (!submitText || !displayText || isLoading.value) return;

    if (!currentAgentId.value) {
      rememberCurrentQaThread(
        getCurrentOwnerId(),
        authHost().getUserInfo()?.domainId || "",
        currentThreadId.value
      );
    }

    const isNewConversation = messages.value.length === 0;
    if (!textOverride) input.value = "";

    if (isNewConversation) {
      updateThreadTitleByText(displayText);
      if (updateThreadList) addThread(currentThreadId.value, currentThreadTitle.value);
    } else if (updateThreadList) {
      updateThreadTimestamp(currentThreadId.value);
    }

    messages.value.push({ id: Date.now(), role: "user", content: displayText });
    isLoading.value = true;
    resetStreamingState();

    await nextTick();
    tailRevision.value++;

    try {
      const token = authHost().getToken() as string;
      const threadOwner = updateThreadList ? useChatStore() : undefined;

      if (currentAgentId.value) {
        await sendDeepAnalysisMessage(submitText, token, threadOwner);
        return;
      }

      await sendStandardMessage({
        submitText,
        displayText,
        token,
        threadListRef: threadOwner,
      });
    } catch (error) {
      messages.value.push(
        buildAssistantMessage({
          mode: "error",
          status: "failed",
          source: "live",
          primaryText: `${t("diagnosis.requestFailed")}: ${error}`,
        })
      );
      isLoading.value = false;
      resetStreamingState();
      clearCurrentEventSource();
    }
  }

  const setAgentId = (agentId: string | undefined) => {
    currentAgentId.value = agentId;
  };

  const startNewConversation = () => {
    detachCurrentStream();
    forgetCurrentQaThread(getCurrentOwnerId(), authHost().getUserInfo()?.domainId || "");
    currentThreadId.value = `thread-${Date.now()}`;
    isCurrentThreadPersisted.value = false;
    currentThreadTitle.value = t("chat.newConversation");
    messages.value = [];
    currentAgentId.value = undefined;
    pendingAnalysisMode.value = false;
    hasSettledTitle.value = false;
  };

  function ensureConversation() {
    if (messages.value.length === 0 && !isSelectingThread.value) startNewConversation();
  }

  const startNewAnalysisConversation = () => {
    startNewConversation();
    currentThreadTitle.value = t("chat.newAnalysis");
    pendingAnalysisMode.value = true;
  };

  async function loadThreadHistory(
    threadId: string,
    title?: string
  ): Promise<{ activeTurn?: { requestSeq: number } }> {
    const credential = authHost().getToken() || authHost().getApiKey();
    const selection = threadSelection;
    try {
      const response = await chatApi.getThreadMessages(threadId);

      if (response.status === 403) throw new Error(t("user.noPermission"));

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const errorMsg = errorData?.error || `${t("diagnosis.requestFailed")} (${response.status})`;
        console.warn(workbenchContent().console.loadMessagesFailed(threadId), errorMsg);
        if (
          selection === threadSelection &&
          currentThreadId.value === threadId &&
          credential === (authHost().getToken() || authHost().getApiKey())
        )
          messages.value = [];
        return {};
      }

      const data = await response.json();
      if (
        selection !== threadSelection ||
        currentThreadId.value !== threadId ||
        credential !== (authHost().getToken() || authHost().getApiKey())
      )
        return {};
      const historyMessages = data.messages || [];

      messages.value = historyMessages.map((msg: any, index: number) => {
        if (msg.role === "user") {
          return {
            id: Date.now() + index,
            role: "user",
            content: msg.content,
          } satisfies Message;
        }

        const baseSnapshot = msg.snapshot || {
          mode: "standard",
          status: "completed",
          primaryText: msg.content,
          analysisText: msg.analysisResult,
          visualizationHTML: msg.visualizationHTML,
        };
        const historySnapshot: ResponseSnapshot = normalizeHistorySnapshot({
          ...baseSnapshot,
          source: "history",
          threadId,
          requestSeq: msg.requestSeq,
          deepAnalysis: baseSnapshot.deepAnalysis,
        });

        return {
          id: Date.now() + index,
          role: "assistant",
          content: historySnapshot.primaryText,
          snapshot: historySnapshot,
        } satisfies Message;
      });

      const storedTitle =
        title || threads.value.find((thread) => thread.threadId === threadId)?.title;
      if (storedTitle) {
        currentThreadTitle.value = storedTitle;
      } else {
        const firstUserMessage = historyMessages.find((message: any) => message.role === "user");
        currentThreadTitle.value =
          firstUserMessage?.content?.replace(/\n/g, " ").slice(0, 24) || t("chat.historySession");
      }

      await nextTick();
      tailRevision.value++;
      const requestSeq = Number(data.activeTurn?.requestSeq);
      return Number.isInteger(requestSeq) ? { activeTurn: { requestSeq } } : {};
    } catch (error) {
      console.error(workbenchContent().console.loadHistoryFailed, error);
      return {};
    }
  }

  async function selectThread(thread: { threadId: string; title?: string }) {
    const threadId = thread.threadId;
    detachCurrentStream();
    const selection = threadSelection;
    currentThreadId.value = threadId;
    isCurrentThreadPersisted.value = true;
    rememberCurrentQaThread(getCurrentOwnerId(), authHost().getUserInfo()?.domainId || "", threadId);
    messages.value = [];
    isSelectingThread.value = true;
    hasSettledTitle.value = true;

    try {
      const { activeTurn } = await loadThreadHistory(threadId, thread.title);
      if (!activeTurn || selection !== threadSelection || currentThreadId.value !== threadId)
        return;

      await resumeStandardMessage({
        threadId,
        requestSeq: activeTurn.requestSeq,
        token: authHost().getToken() as string,
        onRunNotFound: async () => {
          if (selection !== threadSelection || currentThreadId.value !== threadId) return;
          await loadThreadHistory(threadId, thread.title);
        },
      });
    } finally {
      if (selection === threadSelection) isSelectingThread.value = false;
    }
  }

  async function deleteThread(
    threadId: string,
    onCurrentDeleted: () => void,
    reloadThreads: () => void
  ) {
    try {
      await ElMessageBox.confirm(t("chat.deleteConfirm"), t("chat.deleteConfirmTitle"), {
        confirmButtonText: t("common.delete"),
        cancelButtonText: t("common.cancel"),
        type: "warning",
      });
    } catch {
      return;
    }
    try {
      await chatApi.deleteThread(threadId);
    } catch (error) {
      console.error(workbenchContent().console.deleteQaThreadFailed, error);
      return;
    }

    if (currentThreadId.value === threadId) {
      startNewConversation();
      onCurrentDeleted();
    }
    reloadThreads();
  }

  async function renameThread(thread: QAThread, reloadThreads: () => void) {
    try {
      const { value } = await ElMessageBox.prompt(t("chat.renamePrompt"), t("chat.rename"), {
        confirmButtonText: t("common.ok"),
        cancelButtonText: t("common.cancel"),
        inputValue: thread.title || "",
        inputPattern: /^.{1,50}$/,
        inputErrorMessage: t("chat.titleLengthHint"),
      });
      const nextTitle = String(value);
      await chatApi.renameThread(thread.threadId, nextTitle);
      updateThreadTitle(thread.threadId, nextTitle);
      if (currentThreadId.value === thread.threadId) currentThreadTitle.value = nextTitle;
      ElMessage.success(t("chat.renameSuccess"));
      reloadThreads();
    } catch {
      // User cancelled
    }
  }

  const restoreCurrentThreadId = () =>
    restoreCurrentQaThread(getCurrentOwnerId(), authHost().getUserInfo()?.domainId || "");

  return {
    messages,
    tailRevision,
    input,
    isLoading,
    currentThreadId,
    isCurrentThreadPersisted,
    currentThreadTitle,
    isSelectingThread,
    currentAgentId,
    pendingAnalysisMode,
    streamingSnapshot,
    threads,
    threadsLoading,
    threadTotal,
    hasMoreThreads,
    showWelcome,
    graphNodeIds,
    addThread,
    updateThreadTimestamp,
    updateThreadTitle,
    loadThreads,
    restoreCurrentThread,
    loadMoreThreads,
    sendMessage,
    stopGenerating,
    setAgentId,
    startNewConversation,
    ensureConversation,
    startNewAnalysisConversation,
    selectThread,
    renameThread,
    deleteThread,
    restoreCurrentThreadId,
    detachCurrentStream,
  };
});
