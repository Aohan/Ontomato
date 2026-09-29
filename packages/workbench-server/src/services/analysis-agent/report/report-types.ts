import type { AnalysisChartResult, ProvenanceInfo } from "@ontomato/contracts/analysis-charts";
/**
 * Generation inputs and outputs of dimension reports and the multi-dimension summary.
 */

import type { AnalysisEvidence } from "../runtime/evidence-types";

/**
 * Dimension report generation result (with source tracing)
 */
export interface DimensionReportGenerationResult {
  report: string;
  provenance: ProvenanceInfo;
}

/**
 * Multi-dimension summary generation result (with source tracing)
 */
export interface MultiDimensionSummaryGenerationResult {
  summary: string;
  provenance: ProvenanceInfo;
}

/**
 * Dimension report generation parameters
 */
export interface DimensionReportParams {
  /** Dimension name */
  dimensionName: string;
  /** Dimension value */
  dimensionValue: string;
  /** Evidence layer data (normalized query results) */
  evidence: AnalysisEvidence[];
  /** Dataset definitions */
  datasetSchema: string;
  /** Prompt rules */
  summarizerPrompt: string;
  /** Analysis dimension prompt (guides report generation) */
  analysisDimensionPrompt?: string;
  /** Analysis skill execution results */
  skillResults?: any[];
  /** Context of previously generated dimension reports */
  priorDimensionReports?: Array<{
    dimensionName: string;
    dimensionValue: string;
    report: string;
  }>;
  charts?: AnalysisChartResult[];
  /** Request locale used for display-value formatting */
  locale?: string;
  /** Cancellation signal */
  signal?: AbortSignal;
}

/**
 * Multi-dimension summary parameters
 */
export interface MultiDimensionSummaryParams {
  /** All dimension reports */
  dimensionReports: Array<{
    dimensionName: string;
    dimensionValue: string;
    report: string;
  }>;
  /** The original question */
  originalQuestion: string;
  /** Prompt rules */
  conclusionMakerPrompt: string;
  /** Analysis skill execution results */
  skillResults?: any[];
  /** Available charts */
  charts?: AnalysisChartResult[];
  /** Cancellation signal */
  signal?: AbortSignal;
}
