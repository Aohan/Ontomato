import type { AgentMessage } from "../../../core/agent-loop/types";
import type { AnalysisActivityStatus } from "@ontomato/contracts/analysis-presentation";
import type { AnalysisActivity } from "@ontomato/contracts/analysis-presentation";
import type {
  AnalysisChartDiagnostic,
  AnalysisChartResult,
} from "@ontomato/contracts/analysis-charts";

/** Stable reference of one evidence turn inside query_runs; later turns restore historical evidence through it. */
export interface AnalysisConversationEvidenceRef {
  questionId: string;
  question: string;
  threadId: string;
  requestSeq: number;
  sourceKind: "analysis_sub_question";
  sourceRef: string;
}

/**
 * Persisted facts of one regular-session turn: messages keep tool results and never store executable tool instances.
 * Later turns never overwrite earlier ones; reading history never replays the external actions recorded inside it.
 * Messages are read by harness turn reference; business activities and evidence remain owned by this turn.
 */
export interface AnalysisConversationTurnRecord {
  harnessTurnId?: string;
  requestSeq: number;
  userMessage: string;
  status: AnalysisActivityStatus;
  messages: AgentMessage[];
  activities: AnalysisActivity[];
  evidenceRefs: AnalysisConversationEvidenceRef[];
  charts: AnalysisChartResult[];
  chartDiagnostics: AnalysisChartDiagnostic[];
  finalAnswer?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}
