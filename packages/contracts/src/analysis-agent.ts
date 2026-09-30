export type AnalysisAgentExecutionMode = "dimension" | "loop";

/** Display position of the comprehensive summary in the report. Historical agents default to the end of the report. */
export type AnalysisReportSummaryPosition = "top" | "bottom";

export interface AnalysisAgent {
  /** Business ID (UUID) */
  id: string;
  /** Agent name */
  name: string;
  /** Agent description */
  description: string;
  /** Icon (optional) */
  icon?: string;
  /** Execution form marker; agents without one use dimension orchestration */
  executionMode: AnalysisAgentExecutionMode;
  /** Loop-form prompt: role positioning, analysis method, and report structure requirements; only effective in loop form */
  loopPrompt?: string;
  /** Whether a report deliverable is attached; when off, the loop delivers via the final reply and trajectory */
  reportDeliverableEnabled: boolean;
  /** Whether hot report matching is on; when off, the analysis pipeline skips hot report reuse and always re-analyzes with the current configuration */
  hotReportEnabled?: boolean;
  /** Analysis dimension prompt (used to split dimensions into sub-questions) */
  analysisDimensionPrompt?: string;
  /** Dimension report generation prompt */
  summarizerPrompt: string;
  /** Multi-dimension summary prompt */
  conclusionMakerPrompt: string;
  /** Display position of the comprehensive summary in the report; unconfigured historical agents render at the end */
  summaryPosition?: AnalysisReportSummaryPosition;
  /** Enabled analysis skill ID list */
  enabledSkillIds?: string[];
  /** Enabled analysis visualization skill ID list */
  enabledVisualizationSkillIds?: string[];
  /** Snapshot of external MCP service names explicitly authorized to the loop supervisor */
  enabledMcpServiceNames?: string[];
  /** Associated object class names, limiting dimension splitting and query scope */
  classNames?: string[];
  /** Whether enabled */
  isEnabled: boolean;
  /** Sort order (smaller values first) */
  sortOrder?: number;
  /** Creation timestamp */
  createdAt: number;
  /** Update timestamp */
  updatedAt: number;
}

export type DimensionType = "categorical" | "temporal" | "numeric";

export type DimensionValueSource = "static" | "dataset_field";

export interface AnalysisDimension {
  id: string;
  agentId: string;
  name: string;
  dimensionType: DimensionType;
  values?: string[];
  valueSource: DimensionValueSource;
  datasetField?: string;
  subQuestionTemplate: string;
  order?: number;
  isEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}
