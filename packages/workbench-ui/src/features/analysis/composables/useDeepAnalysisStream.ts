import { nextTick, type Ref } from "vue";
import type { Message, ResponseSnapshot } from "../../../types/chat";
import { reduceDeepAnalysisEvent } from "../utils/deep-analysis-event-reducer";
import { t } from "../../../i18n";
import { authHost } from "../../../utils/auth";
import { streamDeepAnalysis } from "../api";
import { errorPunctuation } from "../../../utils/error-punctuation";


function createRunId(threadId: string) {
  return `analysis-deep-${threadId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface DeepAnalysisStreamDeps {
  messages: Ref<Message[]>;
  tailRevision: Ref<number>;
  streamingSnapshot: Ref<ResponseSnapshot | null>;
  currentAgentId: Ref<string | undefined>;
  currentThreadId: Ref<string>;
  currentThreadTitle: Ref<string>;
  isLoading: Ref<boolean>;
  stopRequested: Ref<boolean>;
  currentEventSource: Ref<Pick<EventSource, "close"> | null>;
  updateStreamingSnapshot: (patch: Partial<ResponseSnapshot>) => void;
  resetStreamingState: () => void;
  clearCurrentEventSource: () => void;
}

export function createDeepAnalysisSender(deps: DeepAnalysisStreamDeps) {
  const {
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
  } = deps;

  async function sendDeepAnalysisMessage(text: string, token: string, threadListRef: any) {
    const credential = token || authHost().getApiKey();
    const agentId = currentAgentId.value;
    const requestSeq = messages.value.filter((message) => message.role === "user").length - 1;
    const runId = createRunId(currentThreadId.value);
    if (!agentId) throw new Error(t("diagnosis.agentIdRequired"));
    let close: (() => void) | undefined;
    close = streamDeepAnalysis(text, {
      threadId: currentThreadId.value,
      agentId,
      runId,
      token,
      onEvent: async (json, meta) => {
        if (
          !close ||
          currentEventSource.value?.close !== close ||
          credential !== (authHost().getToken() || authHost().getApiKey())
        )
          return;
        const seq = Number(meta?.lastEventId);
        if (Number.isFinite(seq)) updateStreamingSnapshot({ lastEventSeq: seq });

        try {
          const current = streamingSnapshot.value;
          const reduced = reduceDeepAnalysisEvent(current, json);

          if (json.type === "workflow_complete") {
            handleWorkflowComplete();
            return;
          }
          if (reduced) {
            updateStreamingSnapshot(reduced);
          } else if (json.type === "title") {
            currentThreadTitle.value = json.title;
            threadListRef?.updateThreadTitle(currentThreadId.value, json.title);
          } else if (json.type === "auth_failed") {
            handleAuthFailure();
            return;
          } else if (json.type === "error") {
            handleError(json);
            return;
          }

          if (json.type === "task_cancelled" || json.type === "run_cancelled") {
            clearCurrentEventSource();
            isLoading.value = false;
            resetStreamingState();
          }
          await nextTick();
          tailRevision.value++;
        } catch {
          // Ignore incomplete events.
        }
      },
      onError: async () => {
        if (
          !close ||
          currentEventSource.value?.close !== close ||
          credential !== (authHost().getToken() || authHost().getApiKey())
        )
          return;
        if (stopRequested.value) {
          stopRequested.value = false;
          return;
        }

        clearCurrentEventSource();
        isLoading.value = false;
        const verdict = await authHost().verifySessionOnce();
        if (credential !== (authHost().getToken() || authHost().getApiKey())) return;
        if (verdict === "invalid") {
          authHost().handleAuthExpired();
          return;
        }
        updateStreamingSnapshot({
          mode: "error",
          status: "failed",
          primaryText: t("diagnosis.connectionFailedHint"),
        });
        resetStreamingState();
      },
    });
    currentEventSource.value = { close };
    stopRequested.value = false;

    updateStreamingSnapshot({
      mode: "deep-analysis",
      status: "streaming",
      source: "live",
      threadId: currentThreadId.value,
      runId,
      lastEventSeq: 0,
      requestSeq,
      primaryText: "",
      deepAnalysis: {
        executionMode: "dimension",
        runState: { status: "running", revision: -1, progress: { done: 0, label: "" } },
        activities: [],
        sections: [],
        charts: [],
        chartDiagnostics: [],
      },
    });

    messages.value.push({
      id: Date.now(),
      role: "assistant",
      content: "",
      snapshot: streamingSnapshot.value!,
    });
  }

  function handleError(event: any) {
    updateStreamingSnapshot({
      mode: "deep-analysis",
      status: "failed",
      primaryText:
        streamingSnapshot.value?.primaryText ||
        `${t("diagnosis.deepAnalysisError")}${errorPunctuation().detailSeparator}${event.error}`,
    });
    clearCurrentEventSource();
    isLoading.value = false;
    resetStreamingState();
  }

  function handleAuthFailure() {
    updateStreamingSnapshot({
      mode: "deep-analysis",
      status: "failed",
      primaryText: streamingSnapshot.value?.primaryText || t("user.sessionExpired"),
    });
    clearCurrentEventSource();
    isLoading.value = false;
    resetStreamingState();
    authHost().handleAuthExpired();
  }

  function handleWorkflowComplete() {
    updateStreamingSnapshot({
      status: "completed",
    });
    clearCurrentEventSource();
    isLoading.value = false;
    resetStreamingState();
  }

  return { sendDeepAnalysisMessage };
}
