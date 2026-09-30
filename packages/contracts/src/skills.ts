import type { ChartSortBy, ChartCategoryValue } from "./analysis-charts";
export interface SkillInfo {
  id: string;
  type: "executable" | "knowledge";
  category: "analysis" | "visualization";
  title?: string;
  description?: string;
  tags: string[];
  enabled: boolean;
  path: string;
  version: string;
  outputType?: string;
  useCases?: string[];
}

export interface SkillDeleteResult {
  affectedAgents: AnalysisAgentSkillReference[];
  cleanedAgentCount: number;
}

export interface AnalysisAgentSkillReference {
  id: string;
  name: string;
  usesAnalysis: boolean;
  usesVisualization: boolean;
}

export interface SkillOutput {
  html?: string;
  json?:
    | ChartSelectionResult
    | DataAnalysisResult
    | DataSourceResult
    | TitleGenerationResult
    | object;
  text?: string;
  meta?: {
    chartType?: string;
    detectedChartType?: string;
    detectedReason?: string;
    executionTime?: number;
    skillId?: string;
    [key: string]: any;
  };
}

export interface SkillExecutionMetrics {
  skillId: string;
  totalExecutions: number;
  totalFailures: number;
  totalSuccesses: number;
  totalDurationMs: number;
  lastExecutedAt: number | null;
}

export interface SkillMetricsSnapshot {
  skills: Record<string, SkillExecutionMetrics>;
  updatedAt: number;
}

export interface ChartSelectionResult {
  chartType: string;
  skillId: string;
  xField?: string;
  yField?: string;
  seriesField?: string;
  sortBy?: ChartSortBy;
  sortOrder?: "asc" | "desc";
  topN?: number;
  excludeCategoryValues?: ChartCategoryValue[];
  title?: string;
  reason: string;
  confidence: number;
}

export interface DataAnalysisResult {
  success: boolean;
  error?: string;
  rowCount: number;
  fields: string[];
  fieldAnalysis: Record<
    string,
    {
      type: "numeric" | "category" | "time" | "province" | "id" | "unknown";
      uniqueCount: number;
      nullCount: number;
      sampleValues: any[];
      isProvince: boolean;
      stats: { min: number; max: number; avg: number; sum: number } | null;
    }
  >;
  fieldTypes: {
    numeric: string[];
    category: string[];
    time: string[];
    province: string[];
    id: string[];
  };
  structure: {
    type: "empty" | "flow" | "matrix" | "simple" | "general";
    reason: string;
  };
  recommendations: {
    hasNumeric: boolean;
    hasCategory: boolean;
    hasTime: boolean;
    hasProvince: boolean;
    categoryCount: number;
    timeFieldCount: number;
    provinceFieldCount: number;
  };
}

export interface DataSourceResult {
  success: boolean;
  error?: string;
  data: Record<string, unknown>[] | null;
  source: "query_result" | "user_mock" | "user_provided" | "mock_generated" | "none";
  reason: string;
  rowCount: number;
  fields: string[];
  datasetInfo?: {
    name?: string;
    index: number;
    total: number;
  };
}

export interface TitleGenerationResult {
  title: string;
  method: "query_extract" | "llm_generated" | "query_fallback" | "default";
}
