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
 * 一个后端会话在一个节点上的取证单位：路由表一行，或该会话没有路由行时的回退窗口。
 * 会话与节点是两个维度，取证、条数、取消与缺失原因都落在这一层
 * （问数后端会话的定位与取消·设计 7、12）。
 */
export interface WorkspaceBackendSessionNode {
  /** 路由行节点；无路由行时用查询记录里的节点；都没有时为默认后端 */
  nodeId?: string;
  /** 路由行登记的起止时间；无路由行或未登记时缺省，取证改用问数时间窗 */
  startTs?: number;
  endTs?: number;
  /** 该节点上该会话的取消时间；非空即在此节点被取消 */
  cancelledAt?: number;
  /** 取证窗口的说明：无路由行、路由行未登记起止等 */
  windowMessage?: string;
  agentLlmCount: number;
  diagnosticEventCount: number;
  /** 节点定位失败的原因 */
  locationMessage?: string;
  /** agent-llm 缺失或取回失败的原因 */
  agentLlmMessage?: string;
  /** diagnostic-events 缺失或取回失败的原因 */
  diagnosticEventMessage?: string;
}

/**
 * 工作区里一个后端会话的取回状态：逐节点写明时间窗、条数、取消与缺失原因。
 * 一次问数可以产生多个后端会话，一个取证单位失败不影响其他
 * （问数后端会话的定位与取消·设计 7、12）。
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
  /** 查询记录里的全部后端会话及各自的取回状态；没有会话时不出现。 */
  backendSessions?: WorkspaceBackendSessionEvidence[];
  /** 问数实际开始时间（来自 turn run），与工作区生成时间分开。 */
  turnStartedAt?: string;
  /** 问数实际结束时间（来自 turn run）。 */
  turnEndedAt?: string;
  /** 后端运行日志收取说明：未定位到会话、逐节点失败等。 */
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
 * 诊断提示词产物的落盘文本格式（Node 写入、观察页阅读共用）：七个语义标记在 `-----<标记> BEGIN/END-----`
 * 中的标记词，以及轮次标题的识别规则。两版各装迁出前的原值，不随界面语言变化；代码只按语义键取值。
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
  /** 轮次标题行（trim 后）的原识别正则，与 Node roundTitle 的输出成对。 */
  roundTitlePattern: RegExp;
}
