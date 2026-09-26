import type { AnalysisChartDiagnostic, AnalysisChartResult } from "./analysis-charts";
import type { QueryExecutionDisplayFact } from "./query-execution";

export type AnalysisActivityStatus = "running" | "completed" | "failed" | "cancelled";

export interface AnalysisRunState {
  status: AnalysisActivityStatus;
  /** 单调版本；迟到状态不能覆盖较新的事实。 */
  revision: number;
  progress: { done: number; total?: number; label: string };
  error?: string;
}

export interface AnalysisEvidenceQuestion {
  questionId: string;
  question: string;
  status: AnalysisActivityStatus | "pending";
  statusText?: string;
  dataCount?: number;
  error?: string;
  execution?: QueryExecutionDisplayFact;
}

export interface AnalysisActivity {
  activityId: string;
  /** 受理序号决定展示顺序，更新不改变顺序。 */
  seq: number;
  revision: number;
  kind:
    | "plan"
    | "evidence"
    | "skill"
    | "narrative"
    | "chapter"
    | "publish"
    | "chart"
    | "dispatch"
    | "probe"
    | "external_tool";
  /** 取消收口由服务端把尚未结束的活动和问题置为 cancelled。 */
  status: AnalysisActivityStatus;
  startedAt: number;
  finishedAt?: number;
  groupId?: string;
  error?: string;
  dimensions?: Array<{
    dimensionId: string;
    name: string;
    value?: string;
    reason?: string;
    questions: Array<{ questionId: string; question: string }>;
  }>;
  questions?: AnalysisEvidenceQuestion[];
  skills?: Array<{
    skillId: string;
    action: "load" | "run";
    entry?: string;
    status: AnalysisActivityStatus;
    error?: string;
  }>;
  narrative?: string;
  chapter?: string;
  topic?: string;
  workerSummary?: string;
  charts?: Array<{ chartId: string; title: string }>;
  serviceName?: string;
  toolName?: string;
  toolArguments?: Record<string, unknown>;
  probeTool?: "probe_classes" | "probe_class_data";
  probeArguments?: Record<string, unknown>;
  dispatchId?: string;
}

export interface AnalysisSection {
  sectionId: string;
  title?: string;
  /** 标题 Markdown 层级，交付端不猜测节的业务身份。 */
  titleLevel?: number;
  order: number;
  markdown: string;
  /** 草稿没有终态；失败保留正文和错误。 */
  status?: "success" | "failed";
  error?: string;
  revision: number;
}

/** 两种执行形态的事件累积、持久化和页面恢复共用这一形状。 */
export interface DeepAnalysisTaskPayload {
  executionMode: "dimension" | "loop";
  runState: AnalysisRunState;
  activities: AnalysisActivity[];
  sections: AnalysisSection[];
  charts: AnalysisChartResult[];
  chartDiagnostics: AnalysisChartDiagnostic[];
  finalAnswer?: string;
}
