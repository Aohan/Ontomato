export interface AnalysisChartPlan {
  chartId: string;
  title: string;
  chartType: string;
  xField?: string;
  yField?: string;
  sourceSubQuestion: string;
  reason?: string;
  seriesField?: string;
  sortBy?: ChartSortBy;
  sortOrder?: "asc" | "desc";
  topN?: number;
  excludeCategoryValues?: ChartCategoryValue[];
  skillId?: string;
  config?: Record<string, unknown>;
}

export interface AnalysisChartResult extends AnalysisChartPlan {
  scopeId: string;
  html: string;
  skillId: string;
  dataCount: number;
  /** 报告中的图表占位标识 */
  marker?: string;
  /** 来源追踪 */
  provenance?: ProvenanceInfo;
  /** 证据摘要 */
  evidenceSummary?: string;
}

export interface AnalysisChartDiagnostic {
  scopeId: string;
  reason:
    | "no_data_candidates"
    | "no_visualization_skill"
    | "no_viable_plan"
    | "invalid_plan"
    | "invalid_render_output"
    | "skill_execution_failed"
    | "no_renderable_chart";
  message: string;
  severity: "info" | "warning";
}

export type ChartSortBy = "xField" | "yField" | "none";

export type ChartCategoryValue = string | number;

/**
 * 来源追踪元数据
 */
export interface ProvenanceInfo {
  /** 来源子问题 ID 列表 */
  sourceQuestionIds: string[];
  /** 来源图表 ID 列表 */
  sourceChartIds?: string[];
  /** 来源数据集引用 */
  sourceDatasetRefs?: string[];
  /** 生成时间戳 */
  generatedAt?: number;
  /** 生成器类型 */
  generator: "llm" | "skill" | "system";
}
