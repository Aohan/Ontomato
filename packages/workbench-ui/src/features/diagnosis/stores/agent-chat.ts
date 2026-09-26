import type {
  SessionHistoryMessage as AgentChatMessage,
  SessionHistorySnapshot as AgentHistorySnapshot,
  SessionInfo as AgentSession,
  SessionContext,
  DiagnosisStreamEvent,
  SessionStopResult,
} from "@ontomato/contracts/diagnosis";
import type { HttpResponse } from "@ontomato/contracts/http";
import type { DiagnosisResponseStatus } from "../types/agent-chat";
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { t } from "../../../i18n";
import { ApiRequestError } from "../../../utils/api";
import { diagnosisApi } from "../api";

import {
  parseDiagnosisStreamEvent,
  reduceDiagnosisLiveTail,
  type DiagnosisLiveTail,
} from "../utils/agent-chat-stream";

interface SessionChatReadModel {
  history: AgentChatMessage[];
  live: DiagnosisLiveTail;
  status: DiagnosisResponseStatus;
  draft: string;
}

interface StreamSubscription {
  controller: AbortController;
  lastSeq: number;
  epoch: symbol;
}

function emptySessionState(): SessionChatReadModel {
  return {
    history: [],
    live: { messages: [], status: "idle" },
    status: "idle",
    draft: "",
  };
}

function unwrapApiData<T>(value: unknown): T {
  if (!value || typeof value !== "object") throw new Error(t("diagnosis.requestFailed"));
  const response = value as HttpResponse<T>;
  if (response.success === false) {
    throw new Error(response.error || t("diagnosis.requestFailed"));
  }
  return response.data as T;
}

function isHistoryStatus(value: unknown): value is AgentHistorySnapshot["responseStatus"] {
  return (
    value === "idle" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "interrupted"
  );
}

function normalizeHistorySnapshot(value: unknown): AgentHistorySnapshot {
  if (!value || typeof value !== "object") throw new Error("Invalid diagnosis history snapshot");
  const snapshot = value as Record<string, unknown>;
  if (!Array.isArray(snapshot.messages) || !isHistoryStatus(snapshot.responseStatus)) {
    throw new Error("Invalid diagnosis history snapshot");
  }
  const messages = snapshot.messages.filter(
    (message): message is AgentChatMessage =>
      Boolean(message) &&
      typeof message === "object" &&
      ((message as { role?: unknown }).role === "user" ||
        (message as { role?: unknown }).role === "assistant") &&
      typeof (message as { content?: unknown }).content === "string"
  );
  if (messages.length !== snapshot.messages.length) {
    throw new Error("Invalid diagnosis history message");
  }
  return { messages, responseStatus: snapshot.responseStatus };
}

function sessionPayloadContext(context?: SessionContext): SessionContext | undefined {
  if (!context) return undefined;
  return {
    page: context.page,
    ...(context.targetKey ? { targetKey: context.targetKey } : {}),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const useDiagnosisChatStore = defineStore("diagnosis-chat", () => {
  const sessions = ref<AgentSession[]>([]);
  const currentSessionId = ref("");
  const sessionStates = ref<Record<string, SessionChatReadModel>>({});
  const newSessionDraft = ref("");
  const sessionsLoading = ref(false);
  const subscriptions = new Map<string, StreamSubscription>();
  const subscriptionEpochs = new Map<string, symbol>();

  const currentSession = computed(() =>
    sessions.value.find((session) => session.id === currentSessionId.value)
  );
  const messages = computed(() => {
    const state = sessionStates.value[currentSessionId.value];
    return state ? [...state.history, ...state.live.messages] : [];
  });
  const isSending = computed(() => {
    const status = sessionStates.value[currentSessionId.value]?.status;
    return status === "starting" || status === "running";
  });
  const draft = computed({
    get: () =>
      currentSessionId.value
        ? (sessionStates.value[currentSessionId.value]?.draft ?? "")
        : newSessionDraft.value,
    set: (value: string) => {
      const sessionId = currentSessionId.value;
      if (!sessionId) {
        newSessionDraft.value = value;
        return;
      }
      patchSessionState(sessionId, { draft: value });
    },
  });

  function getSessionState(sessionId: string): SessionChatReadModel {
    return sessionStates.value[sessionId] ?? emptySessionState();
  }

  function patchSessionState(sessionId: string, patch: Partial<SessionChatReadModel>): void {
    sessionStates.value = {
      ...sessionStates.value,
      [sessionId]: { ...getSessionState(sessionId), ...patch },
    };
  }

  function getSubscriptionEpoch(sessionId: string): symbol {
    const existing = subscriptionEpochs.get(sessionId);
    if (existing) return existing;
    const epoch = Symbol();
    subscriptionEpochs.set(sessionId, epoch);
    return epoch;
  }

  function setSessionResponseStatus(sessionId: string, status: "idle" | "running"): void {
    sessions.value = sessions.value.map((session) =>
      session.id === sessionId ? { ...session, responseStatus: status } : session
    );
  }

  async function loadSessions(): Promise<void> {
    sessionsLoading.value = true;
    try {
      const remote = unwrapApiData<AgentSession[]>(await diagnosisApi.listSessions()) ?? [];
      const current = sessions.value.find((session) => session.id === currentSessionId.value);
      sessions.value =
        current && !remote.some((session) => session.id === current.id)
          ? [current, ...remote]
          : remote;
      for (const session of remote) {
        const state = sessionStates.value[session.id];
        if (!state || state.status === "idle") {
          patchSessionState(session.id, {
            status: session.responseStatus,
            live: { messages: [], status: session.responseStatus },
          });
        }
      }
    } finally {
      sessionsLoading.value = false;
    }
  }

  async function createSession(options?: {
    title?: string;
    context?: SessionContext;
  }): Promise<AgentSession | null> {
    try {
      const body: Record<string, unknown> = {
        title: options?.title || t("chat.newSession"),
      };
      const context = sessionPayloadContext(options?.context);
      if (context) body.context = context;

      const session = unwrapApiData<AgentSession>(await diagnosisApi.createSession(body));
      const pendingDraft = newSessionDraft.value;
      session.responseStatus = "idle";
      sessions.value = [session, ...sessions.value];
      currentSessionId.value = session.id;
      sessionStates.value = {
        ...sessionStates.value,
        [session.id]: { ...emptySessionState(), draft: pendingDraft },
      };
      newSessionDraft.value = "";
      return session;
    } catch (error) {
      console.error("Failed to create diagnosis session", error);
      return null;
    }
  }

  async function deleteSession(sessionId: string): Promise<void> {
    await diagnosisApi.deleteSession(sessionId);
    subscriptions.get(sessionId)?.controller.abort();
    subscriptions.delete(sessionId);
    subscriptionEpochs.delete(sessionId);
    sessions.value = sessions.value.filter((session) => session.id !== sessionId);
    sessionStates.value = Object.fromEntries(
      Object.entries(sessionStates.value).filter(([id]) => id !== sessionId)
    );
    if (currentSessionId.value === sessionId) currentSessionId.value = "";
  }

  async function selectSession(sessionId: string): Promise<void> {
    currentSessionId.value = sessionId;
    await loadHistory(sessionId);
  }

  function clearSession(): void {
    currentSessionId.value = "";
  }

  async function loadHistory(sessionId: string): Promise<void> {
    const epoch = getSubscriptionEpoch(sessionId);
    if (subscriptionEpochs.get(sessionId) !== epoch) return;
    const snapshot = normalizeHistorySnapshot(
      unwrapApiData(await diagnosisApi.getSessionHistory(sessionId))
    );
    if (subscriptionEpochs.get(sessionId) !== epoch) return;
    const existingSubscription = subscriptions.has(sessionId);
    const history = snapshot.messages.map((message) => ({
      ...message,
      ...(message.segments
        ? { segments: message.segments.map((segment) => ({ ...segment })) }
        : {}),
    }));
    if (snapshot.responseStatus === "interrupted") {
      history.push({ role: "assistant", content: t("diagnosis.responseInterrupted") });
    }

    patchSessionState(sessionId, {
      history,
      status: snapshot.responseStatus,
      ...(!existingSubscription ? { live: { messages: [], status: snapshot.responseStatus } } : {}),
    });
    setSessionResponseStatus(sessionId, snapshot.responseStatus === "running" ? "running" : "idle");
    if (snapshot.responseStatus === "running" && !existingSubscription) {
      startSubscription(sessionId, epoch);
    }
  }

  function applyStreamEvent(sessionId: string, event: DiagnosisStreamEvent): boolean {
    const state = getSessionState(sessionId);
    const live = reduceDiagnosisLiveTail(state.live, event);
    patchSessionState(sessionId, { live, status: live.status });
    setSessionResponseStatus(sessionId, live.status === "running" ? "running" : "idle");
    return (
      event.type === "response_end" ||
      event.type === "error" ||
      event.type === "response_unavailable"
    );
  }

  async function consumeResponse(
    sessionId: string,
    response: Response,
    subscription: StreamSubscription
  ): Promise<boolean> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error(t("diagnosis.noResponse"));

    const decoder = new TextDecoder();
    let buffer = "";
    let pendingSeq: number | undefined;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (subscriptions.get(sessionId) !== subscription) return false;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("id: ")) {
          const seq = Number(line.slice(4));
          pendingSeq = Number.isFinite(seq) ? seq : undefined;
          continue;
        }
        if (!line.startsWith("data: ")) continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        const event = parseDiagnosisStreamEvent(parsed);
        if (!event) continue;
        if (pendingSeq !== undefined)
          subscription.lastSeq = Math.max(subscription.lastSeq, pendingSeq);
        pendingSeq = undefined;
        if (applyStreamEvent(sessionId, event)) return true;
      }
    }
    return false;
  }

  function startSubscription(
    sessionId: string,
    epoch: symbol,
    initialResponse?: Response,
    initialController?: AbortController
  ): void {
    if (subscriptionEpochs.get(sessionId) !== epoch) return;
    const existing = subscriptions.get(sessionId);
    if (existing?.epoch === epoch) return;
    existing?.controller.abort();
    const subscription: StreamSubscription = {
      controller: initialController ?? new AbortController(),
      lastSeq: 0,
      epoch,
    };
    subscriptions.set(sessionId, subscription);

    void (async () => {
      let response = initialResponse;
      let terminal = false;
      let unavailable = false;
      while (!subscription.controller.signal.aborted) {
        if (subscriptions.get(sessionId) !== subscription) return;
        try {
          response ??= await diagnosisApi.openSessionStream(sessionId, {
            signal: subscription.controller.signal,
            headers:
              subscription.lastSeq > 0 ? { "Last-Event-ID": String(subscription.lastSeq) } : {},
          });
          terminal = await consumeResponse(sessionId, response, subscription);
          response = undefined;
          if (terminal) break;
        } catch (error) {
          if (subscription.controller.signal.aborted) return;
          if (error instanceof ApiRequestError && error.status === 404) {
            unavailable = true;
            break;
          }
        }

        const status = getSessionState(sessionId).status;
        if (status !== "starting" && status !== "running") break;
        await delay(500);
      }

      if (subscriptions.get(sessionId) !== subscription) return;
      subscriptions.delete(sessionId);
      if (terminal || unavailable || getSessionState(sessionId).status !== "running") {
        try {
          await loadHistory(sessionId);
        } catch {
          // The session may have been deleted while the stream was closing.
        }
      }
    })();
  }

  async function sendMessage(text: string): Promise<boolean> {
    const sessionId = currentSessionId.value;
    const message = text.trim();
    if (!sessionId || !message) return false;
    const state = getSessionState(sessionId);
    if (state.status === "starting" || state.status === "running") return false;

    const epoch = Symbol();
    subscriptionEpochs.set(sessionId, epoch);
    subscriptions.get(sessionId)?.controller.abort();
    subscriptions.delete(sessionId);
    patchSessionState(sessionId, {
      status: "starting",
      live: { messages: [], status: "starting" },
      draft: state.draft.trim() === message ? "" : state.draft,
    });
    const controller = new AbortController();
    try {
      const response = await diagnosisApi.sendMessage(sessionId, message, {
        signal: controller.signal,
      });
      startSubscription(sessionId, epoch, response, controller);
      return true;
    } catch (error) {
      const currentDraft = getSessionState(sessionId).draft;
      patchSessionState(sessionId, {
        status: "idle",
        live: { messages: [], status: "idle" },
        draft: currentDraft || message,
      });
      console.error("Failed to send diagnosis message", error);
      return false;
    }
  }

  async function stopSending(): Promise<boolean> {
    const sessionId = currentSessionId.value;
    if (!sessionId) return false;
    const state = getSessionState(sessionId);
    if (state.status !== "starting" && state.status !== "running") return false;
    try {
      const result = unwrapApiData<SessionStopResult>(await diagnosisApi.stopSession(sessionId));
      return result.cancelled;
    } catch (error) {
      console.error("Failed to stop diagnosis response", error);
      return false;
    }
  }

  return {
    sessions,
    currentSessionId,
    currentSession,
    sessionsLoading,
    messages,
    isSending,
    draft,
    loadSessions,
    createSession,
    deleteSession,
    selectSession,
    clearSession,
    loadHistory,
    sendMessage,
    stopSending,
  };
});
