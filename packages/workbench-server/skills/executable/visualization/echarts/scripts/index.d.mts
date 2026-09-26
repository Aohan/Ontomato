import type { ChartSortBy, ChartCategoryValue } from "../../../../../contracts/analysis-charts";
import type { SkillOutput } from "../../../../../contracts/skills";

/** Input fields read by the `execute` of `scripts/index.mjs`. */
export interface EchartsSkillInput {
  data?: unknown;
  chartType: string;
  title: string;
  xField?: string;
  yField?: string;
  seriesField?: string;
  sortBy?: ChartSortBy;
  sortOrder?: "asc" | "desc";
  topN?: number;
  indicators?: Array<{ field?: string; name?: string; max?: number }>;
  excludeCategoryValues?: ChartCategoryValue[];
  /** Explicit links for the sankey chart; element fields are read compatibly by the script as source/target. */
  links?: Array<Record<string, unknown>>;
  /** Explicit nodes for the sankey chart. */
  nodes?: Array<Record<string, unknown>>;
}

export function execute(input: EchartsSkillInput): Promise<SkillOutput>;
