import type {
  KnowledgeTreeResponse,
  KnowledgeMarkdownFile,
  SessionInfo,
  SessionHistorySnapshot,
  SessionStopResult,
} from "@ontomato/contracts/diagnosis";
import type {
  WorkspaceManifest,
  RetainedWorkspaceManifest,
  ArtifactFileTreeNode,
  ArtifactFilePreview,
  ArtifactRetention,
  LogSourceConfig,
  ArtifactType as RetentionArtifactType,
} from "@ontomato/contracts/observe";
import type {
  CaseSet,
  CaseSetListItem,
  CaseSetImportResult,
  RunMeta,
  RetainedRunMeta,
  RunResults,
} from "@ontomato/contracts/autotest";
import type {
  HttpResponse,
  HttpSuccessResponse,
  HttpAcknowledgement,
} from "@ontomato/contracts/http";
import { t } from "../../i18n";
import {
  apiPost,
  createEventSource,
  nodeApiDelete,
  nodeApiFetch,
  nodeApiGet,
  nodeApiPost,
  nodeApiPut,
} from "../../utils/api";
import { apiUrl } from "../../utils/api-base";
import { authHost } from "../../utils/auth";

const AGENT_BASE = "/observe/agent";
const AUTOTEST_BASE = "/observe/autotest";

export function artifactRetentionRequestKey(
  artifactType: RetentionArtifactType,
  artifactId: string
): string {
  return `${artifactType}:${artifactId}`;
}

export async function setArtifactRetention(
  artifactType: RetentionArtifactType,
  artifactId: string,
  kept: boolean
): Promise<boolean> {
  const response: HttpSuccessResponse<ArtifactRetention> = await nodeApiPut(
    `/observe/retention/${artifactType}/${encodeURIComponent(artifactId)}`,
    { kept }
  );
  const updated = response?.data?.kept;
  if (typeof updated !== "boolean") {
    throw new Error("Invalid artifact retention response");
  }
  return updated;
}

export class ArtifactNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

async function fetchArtifact<T = any>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      tk: authHost().getToken() || "",
    },
  });
  if (res.status === 404) throw new ArtifactNotFoundError("Not found");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json: HttpResponse<T> = await res.json();
  if (json.success === false) throw new Error(json.error || "Request failed");
  return json.data;
}

async function fetchDiagnosisKnowledge<T = any>(path: string, opts?: any): Promise<T> {
  const res = await fetch(`${apiUrl("/observe/agent/knowledge")}${path}`, {
    headers: {
      "Content-Type": "application/json",
      tk: authHost().getToken() || "",
      ...((opts?.headers as Record<string, string>) || {}),
    },
    ...opts,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return json.data;
}

async function requestAutotest<T = any>(path: string, opts?: any): Promise<T> {
  const res = await nodeApiFetch(
    `${AUTOTEST_BASE}${path}`,
    opts?.method || "GET",
    opts?.body,
    opts
  );
  const json: HttpResponse<T> = await res.json();
  if (json.success === false) throw new Error(json.error || t("diagnosis.requestFailed"));
  return json.data;
}

async function requestTestcase<T = any>(path: string, opts?: any): Promise<T> {
  const res = await fetch(`${apiUrl(AUTOTEST_BASE)}${path}`, {
    headers: {
      "Content-Type": "application/json",
      tk: authHost().getToken() || "",
      ...((opts?.headers as Record<string, string>) || {}),
    },
    ...opts,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json: HttpResponse<T> = await res.json();
  if (json.success === false) throw new Error(json.error || t("diagnosis.requestFailed"));
  return json.data;
}

export const diagnosisApi = {
  executeDsl: (dsl: unknown) => apiPost("/dsl/executeV1", dsl),
  getKnowledgeTree: () => fetchDiagnosisKnowledge<KnowledgeTreeResponse>(""),
  getKnowledgeContent: (path: string) => {
    const query = new URLSearchParams({ path }).toString();
    return fetchDiagnosisKnowledge<KnowledgeMarkdownFile>(`/content?${query}`);
  },
  listRunCaseSets: () => requestAutotest<CaseSetListItem[]>("/case-sets"),
  startRun: (body: unknown) => requestAutotest<RunMeta>("/runs", { method: "POST", body }),
  stopRun: (runId: string) => requestAutotest<RunMeta>(`/runs/${runId}/stop`, { method: "POST" }),
  getRunData: (runId: string) => requestAutotest<RetainedRunMeta>(`/runs/${runId}`),
  getRunResultsData: (runId: string) => requestAutotest<RunResults>(`/runs/${runId}/results`),
  listCaseSets: () => requestTestcase<CaseSetListItem[]>("/case-sets"),
  getCaseSet: (id: string) => requestTestcase<CaseSet>(`/case-sets/${id}`),
  saveCaseSet: (id: string, body: string) =>
    requestTestcase<CaseSet>(`/case-sets/${id}`, { method: "PUT", body }),
  deleteCaseSet: (id: string) => requestTestcase<void>(`/case-sets/${id}`, { method: "DELETE" }),
  createCaseSet: (body: string) =>
    requestTestcase<CaseSetImportResult>("/case-sets", { method: "POST", body }),
  listSessions: (): Promise<HttpSuccessResponse<SessionInfo[]>> =>
    nodeApiGet(`${AGENT_BASE}/sessions`),
  createSession: (body: unknown): Promise<HttpSuccessResponse<SessionInfo>> =>
    nodeApiPost(`${AGENT_BASE}/sessions`, body),
  deleteSession: (sessionId: string): Promise<HttpAcknowledgement> =>
    nodeApiDelete(`${AGENT_BASE}/sessions/${sessionId}`),
  getSessionHistory: (sessionId: string): Promise<HttpSuccessResponse<SessionHistorySnapshot>> =>
    nodeApiGet(`${AGENT_BASE}/sessions/${sessionId}/history`),
  openSessionStream: (sessionId: string, opts?: any) =>
    nodeApiFetch(`${AGENT_BASE}/sessions/${sessionId}/stream`, "GET", undefined, opts),
  sendMessage: (sessionId: string, message: string, opts?: any) =>
    nodeApiFetch(`${AGENT_BASE}/chat`, "POST", { sessionId, message }, opts),
  stopSession: (sessionId: string): Promise<HttpSuccessResponse<SessionStopResult>> =>
    nodeApiPost(`${AGENT_BASE}/sessions/${sessionId}/stop`),
  turnArtifactUrl: (turnKey: string) => apiUrl(`/observe/turns/${encodeURIComponent(turnKey)}`),
  turnBuildUrl: () => apiUrl("/observe/turns"),
  caseArtifactUrl: (runId: string, caseId: string) =>
    apiUrl(
      `/observe/autotest/runs/${encodeURIComponent(runId)}/cases/${encodeURIComponent(caseId)}/artifacts`
    ),
  getArtifactManifest: (apiPrefix: string) => fetchArtifact<WorkspaceManifest>(apiPrefix),
  getArtifactTree: (apiPrefix: string) =>
    fetchArtifact<ArtifactFileTreeNode | ArtifactFileTreeNode[]>(`${apiPrefix}/tree`),
  getArtifactFile: (apiPrefix: string, encodedPath: string) =>
    fetchArtifact<ArtifactFilePreview>(`${apiPrefix}/files/${encodedPath}`),
  artifactDownloadUrl: (apiPrefix: string, token: string) =>
    `${apiPrefix}/download?tk=${encodeURIComponent(token)}`,
  rebuildArtifact: (url: string, body: unknown): Promise<HttpSuccessResponse<WorkspaceManifest>> =>
    nodeApiPost(url.startsWith("/api/") ? url.slice(4) : url, body),
  listTurns: (): Promise<HttpSuccessResponse<RetainedWorkspaceManifest[]>> =>
    nodeApiGet("/observe/turns"),
  deleteTurn: (turnKey: string): Promise<HttpAcknowledgement> =>
    nodeApiDelete(`/observe/turns/${encodeURIComponent(turnKey)}`),
  buildTurn: (turnKey: string): Promise<HttpSuccessResponse<WorkspaceManifest>> =>
    nodeApiPost("/observe/turns", { turnKey }),
  listRuns: (): Promise<HttpSuccessResponse<RetainedRunMeta[]>> =>
    nodeApiGet(`${AUTOTEST_BASE}/runs`),
  deleteRun: (runId: string): Promise<HttpAcknowledgement> =>
    nodeApiDelete(`${AUTOTEST_BASE}/runs/${encodeURIComponent(runId)}`),
  getRun: (runId: string): Promise<HttpSuccessResponse<RetainedRunMeta>> =>
    nodeApiGet(`${AUTOTEST_BASE}/runs/${runId}`),
  getRunResults: (runId: string): Promise<HttpSuccessResponse<RunResults>> =>
    nodeApiGet(`${AUTOTEST_BASE}/runs/${runId}/results`),
  initializeLogSourceConfig: (): Promise<HttpSuccessResponse<LogSourceConfig>> =>
    nodeApiGet("/observe/log-source-config"),
  downloadRunUrl: (runId: string, token: string) =>
    `${apiUrl(AUTOTEST_BASE)}/runs/${encodeURIComponent(runId)}/download?tk=${encodeURIComponent(token)}`,
  openRunEvents: (runId: string, token: string) =>
    createEventSource(
      `${apiUrl(AUTOTEST_BASE)}/runs/${runId}/events?tk=${encodeURIComponent(token)}`
    ),
  openLiveLogs: (params: URLSearchParams) =>
    createEventSource(`${apiUrl("/observe")}/live-logs?${params.toString()}`),
};
