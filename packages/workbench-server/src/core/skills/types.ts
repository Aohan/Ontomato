import type { DataAnalysisResult } from "@ontomato/contracts/skills";
import type { ChartSortBy, ChartCategoryValue } from "@ontomato/contracts/analysis-charts";
import type { SkillCategoryValue, SkillTypeValue } from "./constants";
import type { SkillManifest } from "./manifest";

export type { SkillManifest } from "./manifest";

export interface SkillMeta {
  id: string;
  path: string;
  manifest: SkillManifest;
  skillMdPath?: string;
}

export interface SkillInput {
  query?: string;
  data?: any[] | any[][];
  datasets?: Array<{
    title?: string;
    data: any[];
    dsl?: unknown;
    dimensionId?: string;
    dimensionName?: string;
    subQuestion?: string;
  }>;
  analysis?: object;
  dataAnalysis?: DataAnalysisResult;
  queryResult?: any;
  mockData?: any[];
  context?: {
    intermediateResults?: {
      queryData?: any;
      analysisResult?: any;
      visualizationSpec?: any;
    };
  };
  theme?: {
    bgColor?: string;
    textColor?: string;
    colors?: string[];
  };
  container?: {
    width?: number;
    height?: number;
  };
  chartType?: string;
  title?: string;
  timeField?: string;
  valueField?: string;
  xField?: string;
  yField?: string;
  seriesField?: string;
  dataRef?: string;
  sortBy?: ChartSortBy;
  sortOrder?: "asc" | "desc";
  topN?: number;
  excludeCategoryValues?: ChartCategoryValue[];
  services?: {
    createModel?: (temperature?: number) => any;
    createLogger?: (name: string) => any;
  };
  autoDetectChartType?: boolean;
  availableRenderSkills?: Array<{
    id: string;
    title: string;
    description?: string;
  }>;
}

export interface SkillMatch {
  skill: SkillMeta;
  confidence: number;
  reason: string;
}

export interface SkillQuery {
  type?: SkillTypeValue;
  category?: SkillCategoryValue;
  selectedSkillIds?: readonly string[];
  includeDisabled?: boolean;
}

export interface RuntimeConfig {
  skillsRoot: string;
  timeout: number;
  enableCache: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
}
