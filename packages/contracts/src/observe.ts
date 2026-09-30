import type { BranchKey } from "./query-thinking";

export type ParsedLogSource = "data-agent" | "ontomato" | "llm" | "backend";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ParsedLogRecord {
  domainId?: string;
  source: ParsedLogSource;
  time?: string;
  level?: LogLevel;
  turnKey?: string;
  threadId?: string;
  requestSeq?: number;
  taskId?: string;
  sessionId?: string;
  backendNodeId?: string;
  agentName?: string;
  agentRunId?: string;
  context?: string;
  status?: string;
  durationMs?: number;
  startedAt?: string;
  endedAt?: string;
  input?: string;
  output?: string;
  error?: string;
  logger?: string;
  thread?: string;
  logId?: string;
  message: string;
}

export interface TimelineEvent {
  time: string;
  source: ParsedLogSource;
  type: "node_start" | "node_end" | "llm_call" | "error";
  name: string;
  durationMs?: number;
  status?: "success" | "error" | "pending";
  detail?: string;
}

export type LogSourceType = "data-agent-app" | "ontomato-app" | "data-agent-llm" | "ontomato-llm" | "backend-node-api";

export interface LogSource {
  sourceType: LogSourceType;
  path?: string;
  url?: string;
  displayName: string;
  available: boolean;
  error?: string;
}

export interface LogSourceConfig {
  backendNodes: BackendNodeConfig[];
}

export interface BackendNodeConfig {
  nodeId: string;
  baseUrl: string;
}

export type PostProcessSeverity = "info" | "warning" | "error";

export interface WorkspacePostProcessSummary {
  status: "ok" | "warning" | "error";
  severity: PostProcessSeverity;
  message: string;
  warningCount: number;
  errorCount: number;
}

export type WorkspaceStatus = "collecting" | "completed" | "failed";

export type WorkspaceSource = "autotest" | "manual" | "api" | "analysis-task";

export interface WorkspaceUpstreamTurn {
  turnKey: string;
  threadId: string;
  requestSeq: number;
  relation: "previous_no_query";
  reason: string;
  question?: string;
  finalAnswer?: string;
  snapshotMode?: string;
  snapshotStatus?: string;
  queryRunCount: number;
  executionEventCount: number;
}

/**
 * One evidence unit of a backend session on a node: a routing-table row, or
 * the fallback window when the session has no routing row. Session and node
 * are two independent dimensions; evidence, counts, cancellation, and missing
 * reasons all live at this layer (backend session locating and cancellation
 * · design 7, 12).
 */
export interface WorkspaceBackendSessionNode {
  /** Node from the routing row; falls back to the node in the query record; defaults to the backend when neither exists */
  nodeId?: string;
  /** Start/end times registered by the routing row; absent when there is no row or it is unregistered, evidence then uses the query time window */
  startTs?: number;
  endTs?: number;
  /** Cancellation time of this session on this node; non-null means cancelled on this node */
  cancelledAt?: number;
  /** Explanation of the evidence window: no routing row, row without registered start/end, etc. */
  windowMessage?: string;
  agentLlmCount: number;
  diagnosticEventCount: number;
  /** Why node locating failed */
  locationMessage?: string;
  /** Why agent-llm is missing or could not be fetched */
  agentLlmMessage?: string;
  /** Why diagnostic-events is missing or could not be fetched */
  diagnosticEventMessage?: string;
}

/**
 * Retrieval status of one backend session in a workspace: per-node time
 * windows, counts, cancellation, and missing reasons. One query can produce
 * several backend sessions; one evidence unit failing does not affect the
 * others (backend session locating and cancellation · design 7, 12).
 */
export interface WorkspaceBackendSessionEvidence {
  branch: BranchKey;
  sessionId: string;
  nodes: WorkspaceBackendSessionNode[];
}

export interface WorkspaceManifest {
  domainId?: string;
  workspaceId: string;
  /** Standard question Turn identity exposed to observe users. */
  turnKey?: string;
  /** Structured request sequence for the standard question Turn. */
  requestSeq?: number;
  status: WorkspaceStatus;
  createdAt: string;
  completedAt?: string;
  error?: string;
  /** Origin of this workspace. */
  source?: WorkspaceSource;
  /** Summary counts for quick display. */
  appLogCount: number;
  llmCallCount: number;
  backendLogCount: number;
  backendDiagnosticEventCount?: number;
  errorCount: number;
  /** Duration in milliseconds (if available from autotest). */
  durationMs?: number;
  /** Linked autotest run ID (if source is autotest). */
  runId?: string;
  /** Linked autotest case ID (if source is autotest). */
  caseId?: string;
  /** Linked deep-analysis task ID (if source is analysis-task). */
  taskId?: string;
  /** Linked deep-analysis agent ID (if source is analysis-task). */
  agentId?: string;
  /** The user's original question. */
  question?: string;
  /** The thread ID that produced this workspace. */
  threadId?: string;
  /** Upstream no-query Turns embedded into this workspace. */
  upstreamTurns?: WorkspaceUpstreamTurn[];
  /** All backend sessions in the query record with their retrieval status; omitted when there are none. */
  backendSessions?: WorkspaceBackendSessionEvidence[];
  /** Actual query start time (from the turn run), separate from the workspace generation time. */
  turnStartedAt?: string;
  /** Actual query end time (from the turn run). */
  turnEndedAt?: string;
  /** Backend runtime log collection notes: session not located, per-node failures, etc. */
  backendLogMessage?: string;
  /** Highest-level summary for post-processing evidence availability. */
  postProcess?: WorkspacePostProcessSummary;
}

export interface FlowchartNode {
  id: string;
  label: string;
  status: "success" | "error" | "pending" | "skipped";
  durationMs?: number;
  startTime?: string;
  endTime?: string;
  error?: string;
}

export interface FlowchartEdge {
  from: string;
  to: string;
}

export interface Flowchart {
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
}

export interface ArtifactFileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: ArtifactFileTreeNode[];
}

export interface ArtifactFilePreview {
  content: string;
  size: number;
  loadedBytes: number;
  truncated: boolean;
}

export interface ErrorSummary {
  totalErrors: number;
  totalWarnings: number;
  errors: ParsedLogRecord[];
  warnings: ParsedLogRecord[];
}

export interface LogSourceProbeResult {
  ok: boolean;
  error?: string;
  detail?: Record<string, unknown>;
}

export interface LogParseResult {
  appLogCount: number;
  llmLogCount: number;
}

export interface ArtifactRetention {
  kept: boolean;
}

export type RetainedWorkspaceManifest = WorkspaceManifest & ArtifactRetention;

export type ArtifactType = "turn-workspace" | "autotest-run";

/**
 * On-disk text format of diagnosis prompt artifacts (written by Node, read by
 * the observe page): the marker words inside `-----<marker> BEGIN/END-----`
 * for the seven semantic markers, and the recognition rule for turn titles.
 * Each edition installs its own pre-migration values, independent of UI
 * language; code reads values only by semantic key.
 */
export type PromptMarkerKind =
  | "systemPrompt"
  | "userPrompt"
  | "reasoning"
  | "llmOutput"
  | "toolCall"
  | "toolReturn"
  | "message";

export interface PromptTranscriptFormat {
  promptMarkers: Record<PromptMarkerKind, string>;
  /** Original recognition regex for turn title lines (after trim), paired with the Node roundTitle output. */
  roundTitlePattern: RegExp;
}
