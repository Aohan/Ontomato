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
  /** 是否挂载报告交付件；关闭时的任务按常规会话逐轮受理 */
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
  /** 过去每次运行的状态与结果；当前报告仍以分析产物为唯一权威。 */
  runHistory?: AnalysisTaskRun[];
}

export interface AnalysisTaskRun {
  /** Reference to this run's Harness session, never a second message snapshot. */
  harnessSessionId?: string;
  id: string;
  status: AnalysisTaskStatus;
  requestSeq?: number;
  resultSummary?: string;
  /** 该次运行结束时的报告正文；只用于历史运行回看，不参与当前报告判定。 */
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
 * 常规会话单轮：消息、活动与交付正文分开保存，逐轮追加、后轮不覆盖前轮。
 * 未记录结果的历史工具调用以未知结果表达，不在读取时重放。
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
