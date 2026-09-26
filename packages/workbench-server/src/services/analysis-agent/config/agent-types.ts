import type {
  AnalysisAgentExecutionMode,
  AnalysisReportSummaryPosition,
} from "@ontomato/contracts/analysis-agent";
/**
 * 分析智能体的配置与执行形态。
 */

/**
 * 执行形态：维度编排（默认）或循环执行。
 * 显式配置在智能体上，不随发起入口或单次请求切换。
 */

export const ANALYSIS_AGENT_EXECUTION_MODES: readonly AnalysisAgentExecutionMode[] = [
  "dimension",
  "loop",
];

export const DEFAULT_ANALYSIS_AGENT_EXECUTION_MODE: AnalysisAgentExecutionMode = "dimension";

export function isAnalysisAgentExecutionMode(value: unknown): value is AnalysisAgentExecutionMode {
  return ANALYSIS_AGENT_EXECUTION_MODES.includes(value as AnalysisAgentExecutionMode);
}

export const ANALYSIS_REPORT_SUMMARY_POSITIONS: readonly AnalysisReportSummaryPosition[] = [
  "top",
  "bottom",
];

export const DEFAULT_ANALYSIS_REPORT_SUMMARY_POSITION: AnalysisReportSummaryPosition = "bottom";

export function isAnalysisReportSummaryPosition(
  value: unknown
): value is AnalysisReportSummaryPosition {
  return ANALYSIS_REPORT_SUMMARY_POSITIONS.includes(value as AnalysisReportSummaryPosition);
}
