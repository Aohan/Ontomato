export type ChartType =
  | "bar"
  | "line"
  | "pie"
  | "scatter"
  | "area"
  | "radar"
  | "gauge"
  | "funnel"
  | "heatmap"
  | "treemap"
  | "sunburst"
  | "sankey"
  | "boxplot"
  | "candlestick"
  | "effect-scatter"
  | "lines"
  | "pictorial-bar"
  | "grouped-bar";

export interface TableData {
  id: number;
  headers: string[];
  rows: string[][];
  chartType: ChartType;
  title: string;
  beforeContent: string;
}

export interface ChartSpec {
  chartType: ChartType;
  title: string;
  xField: string;
  yField: string;
  seriesField: string;
  data: Array<Record<string, any>>;
  reason: string;
}

export interface VisualizationHTML {
  html: string;
  type: "visualization";
  meta?: {
    chartType?: string;
    skillId?: string;
    executionTime?: number;
    loading?: boolean;
  };
}

export interface ContentPart {
  type: "text" | "table" | "chart" | "visualization" | "subgraph";
  content: string;
  table?: TableData;
  chart?: ChartSpec;
  visualization?: VisualizationHTML;
  subgraph?: unknown;
}

/**
 * One dataset in a query result. The body table corresponds to it by sub-question or header, and
 * the name, row count, download, and DSL/code/lineage details are provided with the corresponding
 * table; `code`/`outKeyRefs` are given by the execution facts by dataset index, and datasets that
 * did not produce that detail do not carry these two fields.
 */
export interface ResultDataset {
  id: string;
  title: string;
  rows: Array<Record<string, unknown>>;
  dsl?: unknown;
  subQuestion?: string;
  code?: string;
  outKeyRefs?: unknown[];
}

/**
 * Existing technical output with no dataset to attach to (historical records may have only stored
 * decomposition and code facts). It is not a dataset: it has no rows or count, and only carries the
 * already-produced DSL, post-calculation program, and field lineage.
 */
export interface ResultTechnicalFact {
  key: string;
  title: string;
  dsl?: unknown;
  code?: string;
  outKeyRefs?: unknown[];
}

/** A view request for result details: DSL, post-calculation program, or field lineage, carried solely by the detail dialog. */
export interface ResultDetailRequest {
  kind: "dsl" | "code" | "lineage";
  title: string;
  dsl?: unknown;
  code?: string;
  outKeyRefs?: unknown[];
}

export interface ChartTheme {
  primaryColor: string;
  colors: string[];
  textColor: string;
  bgColor: string;
  borderColor: string;
  gridColor: string;
  tooltipBg: string;
  title: {
    text: string;
    left: string;
    top: number;
    textStyle: { color: string };
  };
  tooltip: {
    trigger: string;
    backgroundColor: string;
    borderColor: string;
    textStyle: { color: string };
  };
  legend: {
    orient: string;
    left: string;
    top: string;
    textStyle: { color: string };
  };
  grid: {
    left: string;
    right: string;
    bottom: string;
    top: string;
    containLabel?: boolean;
  };
  xAxis: {
    type: "category";
    axisLabel: { color: string };
    axisLine: { lineStyle: { color: string } };
    splitLine: { lineStyle: { color: string; opacity: number } };
  };
  yAxis: {
    type: "value";
    axisLabel: { color: string };
    axisLine: { lineStyle: { color: string } };
    splitLine: { lineStyle: { color: string; opacity: number } };
  };
}

import { t } from "../../../../i18n";


export const chartTypeNames: Record<string, string> = {
  bar: t("chart.bar"),
  line: t("chart.line"),
  pie: t("chart.pie"),
  scatter: t("chart.scatter"),
  area: t("chart.area"),
  radar: t("chart.radar"),
  gauge: t("chart.gauge"),
  funnel: t("chart.funnel"),
  heatmap: t("chart.heatmap"),
  treemap: t("chart.treemap"),
  sunburst: t("chart.sunburst"),
  sankey: t("chart.sankey"),
  boxplot: t("chart.boxplot"),
  candlestick: t("chart.candlestick"),
  "effect-scatter": t("chart.rippleScatter"),
  lines: t("chart.lines"),
  "pictorial-bar": t("chart.pictorialBar"),
  "grouped-bar": t("chart.groupedBar"),
};
