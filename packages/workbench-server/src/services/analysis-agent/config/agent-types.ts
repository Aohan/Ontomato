import type {
  AnalysisAgentExecutionMode,
  AnalysisReportSummaryPosition,
} from "@ontomato/contracts/analysis-agent";
/**
 * Analysis agent configuration and execution form.
 */

/**
 * Execution form: dimension orchestration (default) or loop execution.
 * The form is configured explicitly on the agent and never switches with the entry point or a single request.
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
