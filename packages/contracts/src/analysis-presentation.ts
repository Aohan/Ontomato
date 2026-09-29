import type { AnalysisChartDiagnostic, AnalysisChartResult } from "./analysis-charts";
import type { QueryExecutionDisplayFact } from "./query-execution";

export type AnalysisActivityStatus = "running" | "completed" | "failed" | "cancelled";

export interface AnalysisRunState {
  status: AnalysisActivityStatus;
  /** Monotonic revision; late-arriving states must not overwrite newer facts. */
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
  /** Acceptance sequence determines display order; updates never change it. */
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
  /** Cancellation is finalized by the server setting still-unfinished activities and questions to cancelled. */
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
  /** Heading Markdown level; delivery ends never guess a section's business identity. */
  titleLevel?: number;
  order: number;
  markdown: string;
  /** Drafts have no terminal state; failures keep the body and the error. */
  status?: "success" | "failed";
  error?: string;
  revision: number;
}

/** Both execution forms share this shape for event accumulation, persistence, and page recovery. */
export interface DeepAnalysisTaskPayload {
  executionMode: "dimension" | "loop";
  runState: AnalysisRunState;
  activities: AnalysisActivity[];
  sections: AnalysisSection[];
  charts: AnalysisChartResult[];
  chartDiagnostics: AnalysisChartDiagnostic[];
  finalAnswer?: string;
}
