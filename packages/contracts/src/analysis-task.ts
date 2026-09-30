import type {
  AnalysisActivity,
  AnalysisActivityStatus,
  DeepAnalysisTaskPayload,
} from "./analysis-presentation";
import type { AnalysisChartDiagnostic, AnalysisChartResult } from "./analysis-charts";
import type { EgressMessage } from "./agent-egress";
export type AnalysisTaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type AnalysisTaskTriggerSource = "manual" | "scheduled";

export interface AnalysisTask {
  id: string;
  agentId: string;
  userId: string;
  name: string;
  description: string;
  status: AnalysisTaskStatus;
  executionMode?: DeepAnalysisTaskPayload["executionMode"];
  runState?: DeepAnalysisTaskPayload["runState"];
  /** Whether a report deliverable is attached; when off, tasks are accepted turn by turn like regular sessions */
  reportDeliverableEnabled?: boolean;
  threadId?: string;
  question?: string;
  scheduleExpression?: string;
  scheduleEnabled: boolean;
  notifyEmail?: string;
  notifyOnComplete: boolean;
  resultSummary?: string;
  resultReport?: string;
  triggerSource: AnalysisTaskTriggerSource;
  lastRunAt?: number;
  nextRunAt?: number;
  createdAt: number;
  updatedAt: number;
  /** Status and result of each past run; the current report still treats analysis artifacts as the only authority. */
  runHistory?: AnalysisTaskRun[];
}

export interface AnalysisTaskRun {
  /** Reference to this run's Harness session, never a second message snapshot. */
  harnessSessionId?: string;
  id: string;
  status: AnalysisTaskStatus;
  requestSeq?: number;
  resultSummary?: string;
  /** Report body at the end of that run; only for historical run review, never part of the current report decision. */
  resultReport?: string;
  snapshot?: unknown;
  followUpMessages?: Array<{
    role: "user" | "assistant";
    content: string;
    requestSeq?: number;
    snapshot?: unknown;
  }>;
  startedAt?: number;
  completedAt?: number;
}

export interface AnalysisTaskDetail extends AnalysisTask, Partial<DeepAnalysisTaskPayload> {}

export interface AnalysisTaskPage {
  tasks: AnalysisTaskDetail[];
  total: number;
  limit: number;
  offset: number;
}

export interface LoopSubagentTrace {
  activityId: string;
  topic: string;
  status: "running" | "completed" | "failed" | "cancelled";
  messages: EgressMessage[];
  error?: string;
}

export interface AnalysisTaskCounts {
  total: number;
  running: number;
  completed: number;
  scheduled: number;
}

/**
 * One regular-session turn: messages, activities, and the deliverable body
 * are stored separately and appended turn by turn; later turns never overwrite
 * earlier ones. Historical tool calls without a recorded result are expressed
 * as unknown results and are not replayed on read.
 */
export interface AnalysisConversationTurn {
  requestSeq: number;
  userMessage: string;
  status: AnalysisActivityStatus;
  messages: EgressMessage[];
  activities: AnalysisActivity[];
  finalAnswer?: string;
  charts: AnalysisChartResult[];
  chartDiagnostics: AnalysisChartDiagnostic[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}
