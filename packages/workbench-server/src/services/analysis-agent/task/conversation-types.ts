import type { AgentMessage } from "../../../core/agent-loop/types";
import type { AnalysisActivityStatus } from "@ontomato/contracts/analysis-presentation";
import type { AnalysisActivity } from "@ontomato/contracts/analysis-presentation";
import type {
  AnalysisChartDiagnostic,
  AnalysisChartResult,
} from "@ontomato/contracts/analysis-charts";

/** 一轮取证在 query_runs 中的稳定引用；后续轮次据此恢复历史证据。 */
export interface AnalysisConversationEvidenceRef {
  questionId: string;
  question: string;
  threadId: string;
  requestSeq: number;
  sourceKind: "analysis_sub_question";
  sourceRef: string;
}

/**
 * 常规会话一轮的持久化事实：消息保留工具结果，不保存可执行工具实例。
 * 后轮不覆盖前轮；读取历史时不自动重放其中记录的外部动作。
 * 消息按 Harness 回合引用读取；业务活动与证据仍由本回合拥有。
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
