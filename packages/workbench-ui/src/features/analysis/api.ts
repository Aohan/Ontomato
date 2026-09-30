import type {
  AnalysisTaskDetail as AnalysisTask,
  AnalysisTaskPage,
  AnalysisTaskRun,
  AnalysisConversationTurn,
  LoopSubagentTrace,
} from "@ontomato/contracts/analysis-task";
import type { AnalysisAgent } from "@ontomato/contracts/analysis-agent";
import type { AnalysisReportHotCardSummary } from "@ontomato/contracts/analysis-report";
import type { AnalysisStreamEvent } from "@ontomato/contracts/analysis-events";
import { workbenchI18n } from "../../i18n";
import { authHost } from "../../utils/auth";
import { apiUrl } from "../../utils/api-base";
import {
  createEventSource,
  nodeApiBlobPost,
  nodeApiDelete,
  nodeApiFetch,
  nodeApiGet,
  nodeApiPost,
  nodeApiPut,
} from "../../utils/api";
import { workbenchContent } from "../../content";

export const analysisAgentApi = {
  async listAgents(): Promise<AnalysisAgent[]> {
    const res = await nodeApiGet("/analysis-agents");
    // Handle two response formats: { success: true, data: [...] } or directly return [...]
    if (res.success && Array.isArray(res.data)) {
      return res.data;
    }
    if (Array.isArray(res)) {
      return res;
    }
    return [];
  },
  async getEnabledAgents(): Promise<AnalysisAgent[]> {
    const res = await nodeApiGet("/analysis-agents/enabled");
    if (res.success && Array.isArray(res.data)) {
      return res.data;
    }
    if (res.data && Array.isArray(res.data.data)) {
      return res.data.data;
    }
    if (Array.isArray(res)) {
      return res;
    }
    return [];
  },
  async getAgent(id: string): Promise<AnalysisAgent> {
    const res = await nodeApiGet(`/analysis-agents/${id}`);
    return res.data?.data || res.data;
  },
  async listHotReports(id: string): Promise<AnalysisReportHotCardSummary[]> {
    const res = await nodeApiGet(`/analysis-agents/${id}/hot-reports`);
    const data = res.data ?? res;
    return Array.isArray(data) ? data : [];
  },
  async createAgent(
    agent: Omit<AnalysisAgent, "id" | "createdAt" | "updatedAt">
  ): Promise<AnalysisAgent> {
    const res = await nodeApiPost("/analysis-agents", agent);
    return res.data;
  },
  async updateAgent(id: string, updates: Partial<AnalysisAgent>): Promise<AnalysisAgent> {
    const res = await nodeApiPut(`/analysis-agents/${id}`, updates);
    return res.data;
  },
  async deleteAgent(id: string): Promise<void> {
    await nodeApiDelete(`/analysis-agents/${id}`);
  },
};

export function streamDeepAnalysis(
  message: string,
  options: {
    agentId: string;
    threadId?: string;
    token?: string;
    runId?: string;
    since?: number;
    onEvent?: (event: AnalysisStreamEvent, meta?: { lastEventId?: string }) => void;
    onError?: (error: string) => void;
    onComplete?: () => void;
  }
): () => void {
  const { agentId, onEvent, onError, onComplete } = options;
  const threadId = options.threadId || `thread-${Date.now()}`;
  const token = options.token || "";

  const params = new URLSearchParams({
    message,
    threadId,
    agentId,
  });
  if (options.runId) {
    params.append("runId", options.runId);
  }
  params.append("locale", workbenchI18n().global.locale.value as string);
  if (Number.isFinite(options.since)) {
    params.append("since", String(options.since));
  }

  if (token) {
    params.append("tk", token);
  }
  const apiKey1 = authHost().getApiKey();
  if (!token && apiKey1) {
    params.append("apiKey", apiKey1);
  }

  const url = apiUrl(`/analysis-agents/chat/deep-analysis?${params.toString()}`);
  const eventSource = createEventSource(url);
  let receivedOpen = false;

  eventSource.onopen = () => {
    receivedOpen = true;
    console.log(workbenchContent().console.deepAnalysisConnected);
  };

  eventSource.onmessage = (event) => {
    receivedOpen = true;
    try {
      const data: AnalysisStreamEvent = JSON.parse(event.data);

      if (data.type === "error") {
        onEvent?.(
          { type: "error", error: data.error, timestamp: data.timestamp },
          { lastEventId: event.lastEventId }
        );
        eventSource.close();
        return;
      }

      if (data.type === "workflow_complete") {
        onEvent?.(data, { lastEventId: event.lastEventId });
        onComplete?.();
        eventSource.close();
        return;
      }

      onEvent?.(data, { lastEventId: event.lastEventId });
    } catch (error) {
      console.error(workbenchContent().console.deepAnalysisParseFailed, error);
    }
  };

  eventSource.onerror = (error) => {
    console.error(workbenchContent().console.deepAnalysisError, error);
    if (receivedOpen) return;
    onError?.(workbenchContent().text.sseConnectionFailed);
    eventSource.close();
  };

  return () => {
    eventSource.close();
  };
}

export function streamFollowUp(
  message: string,
  options: {
    threadId: string;
    agentId?: string;
    token?: string;
    runId?: string;
    since?: number;
    onEvent?: (event: AnalysisStreamEvent, meta?: { lastEventId?: string }) => void;
    onError?: (error: string) => void;
    onComplete?: () => void;
  }
): () => void {
  const { threadId, agentId, onEvent, onError, onComplete } = options;
  const token = options.token || "";

  const params = new URLSearchParams({
    message,
    threadId,
    locale: workbenchI18n().global.locale.value as string,
  });

  if (agentId) {
    params.append("agentId", agentId);
  }
  if (options.runId) {
    params.append("runId", options.runId);
  }
  if (Number.isFinite(options.since)) {
    params.append("since", String(options.since));
  }
  if (token) {
    params.append("tk", token);
  }
  const apiKey2 = authHost().getApiKey();
  if (!token && apiKey2) {
    params.append("apiKey", apiKey2);
  }

  const url = apiUrl(`/analysis-agents/chat/follow-up?${params.toString()}`);
  const eventSource = createEventSource(url);
  let receivedOpen = false;

  eventSource.onopen = () => {
    receivedOpen = true;
    console.log(workbenchContent().console.followUpConnected);
  };

  eventSource.onmessage = (event) => {
    receivedOpen = true;
    try {
      const data: AnalysisStreamEvent = JSON.parse(event.data);

      if (data.type === "error") {
        onEvent?.(
          { type: "error", error: data.error, timestamp: data.timestamp },
          { lastEventId: event.lastEventId }
        );
        eventSource.close();
        return;
      }

      if (data.type === "workflow_complete") {
        onEvent?.(data, { lastEventId: event.lastEventId });
        onComplete?.();
        eventSource.close();
        return;
      }

      onEvent?.(data, { lastEventId: event.lastEventId });
    } catch (error) {
      console.error(workbenchContent().console.followUpParseFailed, error);
    }
  };

  eventSource.onerror = (error) => {
    console.error(workbenchContent().console.followUpError, error);
    if (receivedOpen) return;
    onError?.(workbenchContent().text.sseConnectionFailed);
    eventSource.close();
  };

  return () => {
    eventSource.close();
  };
}

export function streamFollowUpRun(
  threadId: string,
  options: {
    token?: string;
    since?: number;
    onEvent?: (event: AnalysisStreamEvent, meta?: { lastEventId?: string }) => void;
    onError?: (error: string) => void;
    onComplete?: () => void;
  }
): () => void {
  const { onEvent, onError, onComplete } = options;
  const params = new URLSearchParams({
    locale: workbenchI18n().global.locale.value as string,
  });
  if (options.token) params.append("tk", options.token);
  if (Number.isFinite(options.since)) params.append("since", String(options.since));
  const apiKey = authHost().getApiKey();
  if (!options.token && apiKey) params.append("apiKey", apiKey);

  const url = `/api/analysis-agents/chat/follow-up/${encodeURIComponent(threadId)}/stream?${params.toString()}`;
  const eventSource = createEventSource(url);
  let receivedOpen = false;

  eventSource.onopen = () => {
    receivedOpen = true;
  };

  eventSource.onmessage = (event) => {
    receivedOpen = true;
    try {
      const data: AnalysisStreamEvent = JSON.parse(event.data);
      if (data.type === "error") {
        onEvent?.(
          { type: "error", error: data.error, timestamp: data.timestamp },
          { lastEventId: event.lastEventId }
        );
        eventSource.close();
        return;
      }
      if (data.type === "workflow_complete" || data.type === "run_cancelled") {
        onEvent?.(data, { lastEventId: event.lastEventId });
        onComplete?.();
        eventSource.close();
        return;
      }
      if (data.type === "run_not_found") {
        onComplete?.();
        eventSource.close();
        return;
      }
      onEvent?.(data, { lastEventId: event.lastEventId });
    } catch (error) {
      console.error(workbenchContent().console.followUpRunParseFailed, error);
    }
  };

  eventSource.onerror = () => {
    if (receivedOpen) return;
    onError?.(workbenchContent().text.sseConnectionFailed);
    eventSource.close();
  };

  return () => {
    eventSource.close();
  };
}

export interface CreateTaskParams {
  agentId: string;
  name: string;
  description?: string;
  question: string;
  scheduleExpression?: string;
  scheduleEnabled?: boolean;
  notifyEmail?: string;
  notifyOnComplete?: boolean;
  executeImmediately?: boolean;
}

const CONVERSATION_TURN_STATUSES = ["running", "completed", "failed", "cancelled"];
const EGRESS_ROLES = ["user", "assistant", "toolResult"];

/** Egress messages only contain whitelisted content types; thinking content must not reach the page from turn history. */
function isEgressMessage(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (typeof message.role !== "string" || !EGRESS_ROLES.includes(message.role)) return false;
  if (!Array.isArray(message.content)) return false;
  return message.content.every((part) => {
    if (!part || typeof part !== "object") return false;
    const type = (part as Record<string, unknown>).type;
    return type === "text" || type === "toolCall";
  });
}

/** Turn boundaries only validate stable identity, status, and required collections; field semantics are owned by the shared contract. */
function isConversationTurn(value: unknown): value is AnalysisConversationTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as Record<string, unknown>;
  return (
    Number.isInteger(turn.requestSeq) &&
    typeof turn.userMessage === "string" &&
    typeof turn.status === "string" &&
    CONVERSATION_TURN_STATUSES.includes(turn.status) &&
    Array.isArray(turn.messages) &&
    turn.messages.every(isEgressMessage) &&
    Array.isArray(turn.activities) &&
    Array.isArray(turn.charts) &&
    Array.isArray(turn.chartDiagnostics)
  );
}

export const analysisTaskApi = {
  async listTaskPage(params?: {
    agentId?: string;
    reportDeliverableEnabled?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<AnalysisTaskPage> {
    const query = new URLSearchParams();
    if (params?.agentId) query.set("agentId", params.agentId);
    if (params?.reportDeliverableEnabled !== undefined)
      query.set("reportDeliverableEnabled", String(params.reportDeliverableEnabled));
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.offset !== undefined) query.set("offset", String(params.offset));
    const qs = query.toString();
    const res = await nodeApiGet(`/analysis-tasks${qs ? "?" + qs : ""}`);
    const data = res.data || res;
    if (Array.isArray(data)) {
      return {
        tasks: data,
        total: data.length,
        limit: params?.limit ?? data.length,
        offset: params?.offset ?? 0,
      };
    }
    return {
      tasks: Array.isArray(data?.tasks) ? data.tasks : [],
      total: Number(data?.total || 0),
      limit: Number(data?.limit || params?.limit || 0),
      offset: Number(data?.offset || params?.offset || 0),
    };
  },
  async listTasks(params?: {
    agentId?: string;
    reportDeliverableEnabled?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<AnalysisTask[]> {
    const page = await this.listTaskPage(params);
    return page.tasks;
  },
  async getTask(id: string): Promise<AnalysisTask> {
    const res = await nodeApiGet(`/analysis-tasks/${id}`);
    return res.data || res;
  },
  async createTask(params: CreateTaskParams): Promise<AnalysisTask> {
    const res = await nodeApiPost("/analysis-tasks", params);
    return res.data || res;
  },
  async executeTask(id: string): Promise<void> {
    await nodeApiPost(`/analysis-tasks/${id}/execute`);
  },
  async cancelTask(id: string): Promise<void> {
    await nodeApiPost(`/analysis-tasks/${id}/cancel`);
  },
  async updateTask(id: string, updates: Partial<AnalysisTask>): Promise<AnalysisTask> {
    const res = await nodeApiPut(`/analysis-tasks/${id}`, updates);
    return res.data || res;
  },
  async deleteTask(id: string): Promise<void> {
    await nodeApiDelete(`/analysis-tasks/${id}`);
  },
  async getTaskMessages(id: string): Promise<any> {
    const res = await nodeApiGet(`/analysis-tasks/${id}/messages`);
    return res.data || res;
  },
  /** Records of each past run; used for historical review after a task rerun. */
  async listRuns(id: string): Promise<AnalysisTaskRun[]> {
    const res = await nodeApiGet(`/analysis-tasks/${id}/runs`);
    const data = res.data || res;
    return Array.isArray(data) ? data : [];
  },
  /** Regular conversations are read by turn; turns and the report body are saved separately so later turns don't overwrite earlier ones. */
  async getTurns(id: string): Promise<AnalysisConversationTurn[]> {
    const res = await nodeApiGet(`/analysis-tasks/${encodeURIComponent(id)}/turns`);
    const data = res.data || res;
    const turns: unknown = data?.turns;
    // Turn history is an untrusted boundary: shape mismatches are thrown as protocol errors rather than faked as empty conversations.
    if (!Array.isArray(turns) || !turns.every(isConversationTurn))
      throw new Error(workbenchI18n().global.t("harness.loadFailed"));
    return turns;
  },
  async continueConversation(
    id: string,
    message: string
  ): Promise<{ taskId: string; requestSeq: number; status: "running" }> {
    const res = await nodeApiPost(`/analysis-tasks/${encodeURIComponent(id)}/turns`, { message });
    return res.data || res;
  },
  async getLoopSubagentTrace(taskId: string, activityId: string): Promise<LoopSubagentTrace> {
    const res = await nodeApiGet(
      `/analysis-tasks/${taskId}/trajectory/${encodeURIComponent(activityId)}/subagent`
    );
    return res.data || res;
  },
};

export function streamTaskExecution(
  taskId: string,
  options: {
    requestSeq?: number;
    since?: number;
    onEvent?: (event: AnalysisStreamEvent, meta?: { lastEventId?: string }) => void;
    onError?: (error: string) => void;
    onComplete?: () => void;
    onOpen?: () => void;
  }
): () => void {
  const { onEvent, onError, onComplete } = options;
  const token = authHost().getToken();
  const apiKey = authHost().getApiKey();
  const queryParts: string[] = [];
  if (token) queryParts.push(`tk=${encodeURIComponent(token)}`);
  if (!token && apiKey) queryParts.push(`apiKey=${encodeURIComponent(apiKey)}`);
  if (Number.isFinite(options.since))
    queryParts.push(`since=${encodeURIComponent(String(options.since))}`);
  if (options.requestSeq !== undefined)
    queryParts.push(`requestSeq=${encodeURIComponent(String(options.requestSeq))}`);
  const query = queryParts.length ? `?${queryParts.join("&")}` : "";
  const url = apiUrl(`/analysis-tasks/${taskId}/stream${query}`);
  const eventSource = createEventSource(url);
  let closed = false;

  eventSource.onopen = () => {
    options.onOpen?.();
  };

  eventSource.onmessage = (event) => {
    if (closed) return;
    try {
      const raw: unknown = JSON.parse(event.data);
      const data = raw as AnalysisStreamEvent;
      // Late-turn events are dropped by the contract-declared request sequence, not mixed into the current turn.
      if (
        options.requestSeq !== undefined &&
        data.requestSeq !== undefined &&
        data.requestSeq !== options.requestSeq
      )
        return;

      if (data.type === "error") {
        onEvent?.(
          { type: "error", error: data.error, timestamp: data.timestamp },
          { lastEventId: event.lastEventId }
        );
        eventSource.close();
        return;
      }

      if (
        data.type === "task_completed" ||
        data.type === "task_cancelled" ||
        data.type === "task_failed"
      ) {
        closed = true;
        onEvent?.(data, { lastEventId: event.lastEventId });
        onComplete?.();
        eventSource.close();
        return;
      }

      onEvent?.(data, { lastEventId: event.lastEventId });
    } catch {
      // ignore parse error
    }
  };

  eventSource.onerror = () => {
    if (closed) return;
    if (eventSource.readyState === EventSource.CLOSED) {
      onError?.(workbenchContent().text.connectionFailed);
    }
  };

  return () => {
    closed = true;
    eventSource.close();
  };
}

export const analysisReportApi = {
  exportPdf: (body: unknown) => nodeApiBlobPost("/reports/export-pdf", body),
  listCards: (queryString: string) => nodeApiGet(`/analysis-reports/cards${queryString}`),
  getCard: (id: string) => nodeApiGet(`/analysis-reports/cards/${id}`),
  deleteCard: (id: string) => nodeApiDelete(`/analysis-reports/cards/${id}`),
  updateCardStatus: (id: string, status: string) =>
    nodeApiPut(`/analysis-reports/cards/${id}/status`, { status }),
  updateCardBusinessDescription: (id: string, businessDescription: string) =>
    nodeApiPut(`/analysis-reports/cards/${id}/business-description`, { businessDescription }),
  summarizePpt: (body: unknown) => nodeApiPost("/ppt/summarize", body),
};

export function cancelDeepAnalysisRun(threadId: string, runId?: string): Promise<Response> {
  const runQuery = runId ? `?runId=${encodeURIComponent(runId)}` : "";
  return nodeApiFetch(
    `/analysis-agents/chat/deep-analysis/${encodeURIComponent(threadId)}/cancel${runQuery}`,
    "POST",
    runId ? { runId } : undefined
  );
}

export function cancelFollowUpRun(threadId: string, runId?: string): Promise<Response> {
  const runQuery = runId ? `?runId=${encodeURIComponent(runId)}` : "";
  return nodeApiFetch(
    `/analysis-agents/chat/follow-up/${encodeURIComponent(threadId)}/cancel${runQuery}`,
    "POST",
    runId ? { runId } : undefined
  );
}
