import type { DataPlan } from "@ontomato/contracts/dashboard";
import type { ModelDataView } from "../../../../utils/model-data-view";

export type PlannedDashboardChartEntry = {
  name: string;
  datasetKey: string;
  type?: string;
  fields?: Record<string, any>;
  dataPlan?: DataPlan;
};

export type PlannedDashboardMetricEntry = {
  datasetKey: string;
  unit: string;
  name: string;
  dataPlan?: DataPlan;
  valueField?: string;
  agg?: "count" | "sum" | "avg";
};

export type PlannedDashboardGroup = {
  title: string;
  charts: PlannedDashboardChartEntry[];
  metrics?: PlannedDashboardMetricEntry[];
};

export type DatasetInput = {
  datasetKey: string;
  subQuestion: string;
  dsl: Record<string, unknown>;
  data: Array<Record<string, any>>;
};

export type DataType = "metric_summary" | "chart_summary" | "object_detail";

export type DatasetProfile = {
  datasetKey: string;
  subQuestion: string;
  dsl: Record<string, unknown>;
  rowCount: number;
  fields: string[];
  sourceRows: Array<Record<string, any>>;
  dataView: ModelDataView<Record<string, any>>;
  dataType: DataType;
};

export type DashboardPlanningChainInput = {
  mode: "dashboard" | "append";
  datasets: DatasetInput[];
  existingChartTypes?: string[];
};

export type DashboardPlanningChainOutput =
  | {
      mode: "dashboard";
      name?: string;
      groups: PlannedDashboardGroup[];
      profiles?: DatasetProfile[];
    }
  | {
      mode: "append";
      charts: PlannedDashboardChartEntry[];
      metrics: PlannedDashboardMetricEntry[];
      profiles?: DatasetProfile[];
    };

export type FieldMappingRequest = {
  id: string;
  chartType: string;
  contract: string[];
  subQuestion: string;
  dataView: ModelDataView<Record<string, any>>;
  allFields: string[];
};
