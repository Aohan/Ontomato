import type {
  QueryExecutionFacts,
  ResponseSnapshot,
  Message,
  ExecutionSnapshotStep,
} from "../../../types/chat";
import type { ChatClientEvent } from "@ontomato/contracts/chat";
import { nextTick, type Ref } from "vue";

import { buildExecutionStepId } from "../../../utils/snapshot-helpers";
import { t, workbenchI18n } from "../../../i18n";
import { authHost } from "../../../utils/auth";
import { chatApi } from "../api";


function createRunId(threadId: string) {
  return `chat-${threadId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface StandardStreamDeps {
  messages: Ref<Message[]>;
  tailRevision: Ref<number>;
  isLoading: Ref<boolean>;
  stopRequested: Ref<boolean>;
  streamingSnapshot: Ref<ResponseSnapshot | null>;
  currentThreadId: Ref<string>;
  currentThreadTitle: Ref<string>;
  currentEventSource: Ref<Pick<EventSource, "close"> | null>;
  updateStreamingSnapshot: (patch: Partial<ResponseSnapshot>) => void;
  resetStreamingState: () => void;
  clearCurrentEventSource: () => void;
  addOrUpdateExecutionStep: (step: ExecutionSnapshotStep) => void;
  hasSettledTitle: Ref<boolean>;
}

export interface SendStandardMessageOptions {
  submitText: string;
  displayText: string;
  token: string;
  threadListRef?: any;
}

export interface ResumeStandardMessageOptions {
  threadId: string;
  requestSeq: number;
  token: string;
  onRunNotFound?: () => void | Promise<void>;
}

interface AttachStandardStreamOptions {
  openStream: () => EventSource;
  threadId: string;
  threadListRef?: any;
  onRunNotFound?: () => void | Promise<void>;
}

export function createStandardSender(deps: StandardStreamDeps) {
  const {
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
  } = deps;

  async function attachStandardStream(options: AttachStandardStreamOptions) {
    const { openStream, threadId: streamThreadId, threadListRef, onRunNotFound } = options;
    const credential = authHost().getToken() || authHost().getApiKey();
    try {
      const eventSource = openStream();
      currentEventSource.value = eventSource;
      stopRequested.value = false;
      let receivedOpen = false;
      const isCurrentStream = () =>
        currentEventSource.value === eventSource &&
        currentThreadId.value === streamThreadId &&
        credential === (authHost().getToken() || authHost().getApiKey());

      eventSource.addEventListener("open", () => {
        receivedOpen = true;
      });

      eventSource.onmessage = async (event) => {
        if (!isCurrentStream()) return;
        receivedOpen = true;
        const data = event.data;
        if (data === "[DONE]") {
          if (streamingSnapshot.value) {
            updateStreamingSnapshot({
              status: "completed",
              requestSeq:
                typeof streamingSnapshot.value.requestSeq === "number"
                  ? streamingSnapshot.value.requestSeq
                  : messages.value.filter((msg) => msg.role === "user").length - 1,
              executionSteps: (streamingSnapshot.value.executionSteps || []).map((step) => ({
                ...step,
                status: step.status === "failed" ? "failed" : "completed",
              })),
            });
          }
          resetStreamingState();
          clearCurrentEventSource();
          isLoading.value = false;
          await nextTick();
          tailRevision.value++;
          return;
        }

        try {
          const json: ChatClientEvent = JSON.parse(data);
          if (json.type === "run_not_found") {
            const liveMessage = messages.value.at(-1);
            if (liveMessage?.role === "assistant" && liveMessage.snapshot?.source === "live") {
              messages.value.pop();
            }
            clearCurrentEventSource();
            isLoading.value = false;
            resetStreamingState();
            await onRunNotFound?.();
            return;
          }
          const current = streamingSnapshot.value;

          if (json.type === "run_started") {
            updateStreamingSnapshot({
              runId: json.runId,
              threadId: json.threadId || streamThreadId,
              turnKey: json.turnKey || current?.turnKey,
              requestSeq:
                typeof json.requestSeq === "number" ? json.requestSeq : current?.requestSeq,
            });
          } else if (json.type === "turn_key") {
            updateStreamingSnapshot({
              turnKey: json.turnKey,
              threadId: json.threadId || streamThreadId,
              requestSeq:
                typeof json.requestSeq === "number" ? json.requestSeq : current?.requestSeq,
            });
          } else if (json.type === "token") {
            updateStreamingSnapshot({
              showPendingUnderstanding: false,
              primaryText: `${current?.primaryText || ""}${json.content}`,
            });
          } else if (json.type === "analysis_token") {
            updateStreamingSnapshot({
              showPendingUnderstanding: true,
              analysisText: `${current?.analysisText || ""}${json.content}`,
            });
          } else if (json.type === "title") {
            if (!hasSettledTitle.value) {
              hasSettledTitle.value = true;
              currentThreadTitle.value = json.title;
              threadListRef?.updateThreadTitle(streamThreadId, json.title);
            }
          } else if (json.type === "thinking_state") {
            updateStreamingSnapshot({
              showPendingUnderstanding: true,
              // Execution facts arrive gradually during the live stream: thinking state comes first,
              // the result event brings the remaining facts, and QC is added last.
              // There is only this one copy on the snapshot; both the view and stop normalization read it.
              execution: {
                ...current?.execution,
                thinkingSummary: json.thinking || current?.execution?.thinkingSummary,
                thinkingState: json.thinkingState,
              },
            });
          } else if (json.type === "abc_progress") {
            if (current?.execution?.thinkingState?.abc) {
              updateStreamingSnapshot({
                execution: {
                  ...current.execution,
                  thinkingState: {
                    ...current.execution.thinkingState,
                    abc: { ...current.execution.thinkingState.abc, progress: json.progress },
                  },
                },
              });
            }
          } else if (json.type === "abc_content") {
            if (json.content) {
              updateStreamingSnapshot({
                primaryText: json.content,
                showPendingUnderstanding: true,
              });
            }
          } else if (json.type === "result") {
            const resultContent =
              typeof json.content === "string"
                ? json.content
                : json.content?.markdownTable || json.content?.content || "";
            // The result event brings the main body of this run's execution facts (table, secondary breakdown, lineage, winning branch).
            const resultFacts =
              typeof json.content === "string" ? undefined : json.content?.execution;
            if (resultContent || resultFacts) {
              updateStreamingSnapshot({
                ...(resultContent ? { primaryText: resultContent } : {}),
                showPendingUnderstanding: true,
                execution: { ...current?.execution, ...(resultFacts as QueryExecutionFacts) },
              });
            }
          } else if (json.type === "query_datasets") {
            updateStreamingSnapshot({
              showPendingUnderstanding: true,
              datasets: Array.isArray(json.datasets)
                ? json.datasets.map((dataset: any, index: number) => ({
                    id: `dataset-${index}`,
                    title:
                      dataset?.subQuestion ||
                      dataset?.name ||
                      dataset?.description ||
                      `${t("hotData.dataTable")}_${index + 1}`,
                    rows: Array.isArray(dataset?.data) ? dataset.data : [],
                    dsl: dataset?.dsl,
                    subQuestion: dataset?.subQuestion,
                  }))
                : [],
              graphNodeIds: Array.isArray(json.nodeIds)
                ? json.nodeIds.map((item: unknown) => String(item)).filter(Boolean)
                : current?.graphNodeIds,
            });
          } else if (json.type === "thinking_summary") {
            updateStreamingSnapshot({
              showPendingUnderstanding: true,
              execution: {
                ...current?.execution,
                thinkingSummary: current?.execution?.thinkingSummary
                  ? `${current.execution.thinkingSummary}\n${json.thinkingSummary || ""}`.trim()
                  : json.thinkingSummary,
                thinkingSteps: Array.isArray(json.thinkingSteps)
                  ? json.thinkingSteps
                  : current?.execution?.thinkingSteps,
                thinkingState: json.thinkingState || current?.execution?.thinkingState,
              },
            });
          } else if (json.type === "chain_start") {
            updateStreamingSnapshot({ showPendingUnderstanding: true });
            addOrUpdateExecutionStep({
              id: buildExecutionStepId(json.name, "stage"),
              name: json.name,
              icon: json.icon,
              detail: json.description || "",
              status: "running",
              kind: "stage",
            });
          } else if (json.type === "visualization_html") {
            updateStreamingSnapshot({
              showPendingUnderstanding: true,
              visualizationHTML: json.html,
              visualizationLoading: false,
            });
          } else if (json.type === "post_thinking") {
            if (json.qcState) {
              updateStreamingSnapshot({
                showPendingUnderstanding: true,
                execution: { ...current?.execution, qcState: json.qcState },
              });
            }
          } else if (json.type === "clarification") {
            updateStreamingSnapshot({
              showPendingUnderstanding: false,
              status: "completed",
              clarification: {
                message: json.message || t("chat.clarificationDefault"),
                options: json.options || [],
              },
            });
            resetStreamingState();
            clearCurrentEventSource();
            isLoading.value = false;
            await nextTick();
            tailRevision.value++;
            return;
          } else if (json.type === "run_cancelled") {
            updateStreamingSnapshot({
              status: "completed",
              stoppedByUser: true,
              showPendingUnderstanding: false,
            });
            resetStreamingState();
            clearCurrentEventSource();
            isLoading.value = false;
            await nextTick();
            tailRevision.value++;
            return;
          } else if (json.type === "auth_failed") {
            updateStreamingSnapshot({
              mode: "error",
              status: "failed",
              primaryText: t("user.sessionExpired"),
            });
            resetStreamingState();
            clearCurrentEventSource();
            isLoading.value = false;
            // Explicit auth failure from the server: straight to the single exit.
            authHost().handleAuthExpired();
            return;
          } else if (json.type === "error") {
            // Keep partial results when the query-failure fact already carries an error explanation;
            // errors at other stages still go through the original error page,
            // and we must not swallow the current error reason just because earlier query results exist.
            const hasPartialContent = Boolean(
              current?.primaryText ||
              current?.analysisText ||
              current?.visualizationHTML ||
              (current?.datasets && current.datasets.length > 0)
            );
            if (hasPartialContent && current?.execution?.error) {
              updateStreamingSnapshot({ status: "failed" });
            } else {
              updateStreamingSnapshot({
                mode: "error",
                status: "failed",
                primaryText: `${t("common.error")}: ${json.error}`,
              });
            }
            resetStreamingState();
            clearCurrentEventSource();
            isLoading.value = false;
            await nextTick();
            tailRevision.value++;
            return;
          }
        } catch {
          // ignore
        }

        await nextTick();
        tailRevision.value++;
      };

      eventSource.onerror = async () => {
        if (!isCurrentStream()) return;
        if (stopRequested.value) {
          stopRequested.value = false;
          return;
        }

        if (!receivedOpen) {
          // The connection never opened. Do NOT infer an auth failure from
          // this alone (network flaps hit the same path) -- ask datarag.
          clearCurrentEventSource();
          isLoading.value = false;
          const verdict = await authHost().verifySessionOnce();
          if (credential !== (authHost().getToken() || authHost().getApiKey())) return;
          if (verdict === "invalid") {
            authHost().handleAuthExpired();
            return;
          }
          // Session is fine (or verify inconclusive): plain network error.
          updateStreamingSnapshot({
            mode: "error",
            status: "failed",
            primaryText: t("diagnosis.connectionFailedHint"),
          });
          resetStreamingState();
          return;
        }
      };
    } catch (error) {
      updateStreamingSnapshot({
        mode: "error",
        status: "failed",
        primaryText: `${t("diagnosis.requestFailed")}: ${error}`,
      });
      isLoading.value = false;
      resetStreamingState();
      clearCurrentEventSource();
    }
  }

  async function prepareLiveTail(options: {
    threadId: string;
    runId?: string;
    requestSeq?: number;
  }) {
    isLoading.value = true;
    resetStreamingState();
    updateStreamingSnapshot({
      mode: "standard",
      status: "streaming",
      source: "live",
      threadId: options.threadId,
      runId: options.runId,
      requestSeq: options.requestSeq,
      primaryText: "",
      showPendingUnderstanding: true,
      executionSteps: [],
    });
    messages.value.push({
      id: Date.now(),
      role: "assistant",
      content: "",
      snapshot: streamingSnapshot.value!,
    });
    await nextTick();
    tailRevision.value++;
  }

  async function sendStandardMessage(options: SendStandardMessageOptions) {
    const { submitText, displayText, token, threadListRef } = options;
    const threadId = currentThreadId.value;
    const runId = createRunId(threadId);
    await prepareLiveTail({
      threadId,
      runId,
    });

    const apiKey = authHost().getApiKey();
    const params = new URLSearchParams({
      message: submitText,
      displayMessage: displayText,
      threadId,
      runId,
      locale: workbenchI18n().global.locale.value as string,
      ...(token ? { tk: token } : {}),
      ...(!token && apiKey ? { apiKey } : {}),
    });
    await attachStandardStream({
      openStream: () => chatApi.openStream(params),
      threadId,
      threadListRef,
    });
  }

  async function resumeStandardMessage(options: ResumeStandardMessageOptions) {
    const { threadId, requestSeq, token, onRunNotFound } = options;
    await prepareLiveTail({ threadId, requestSeq });

    const apiKey = authHost().getApiKey();
    const params = new URLSearchParams({
      ...(token ? { tk: token } : {}),
      ...(!token && apiKey ? { apiKey } : {}),
    });
    await attachStandardStream({
      openStream: () => chatApi.openResumeStream(threadId, params),
      threadId,
      onRunNotFound,
    });
  }

  return { sendStandardMessage, resumeStandardMessage };
}
