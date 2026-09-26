export type DashboardLayout = {
  colSpan?: number;
  rowSpan?: number;
};

export type TransformSpec =
  | {
      kind: "groupBy";
      groupBy: string[];
      metrics: Array<{ op: "count" | "sum" | "avg"; field?: string; as: string }>;
      sortBy?: { field: string; order: "asc" | "desc" };
      limit?: number;
      otherLabel?: string;
    }
  | {
      kind: "pivot";
      index: string;
      columns: string;
      value: { op: "count" | "sum"; field?: string; as: string };
      topIndex?: number;
      otherLabel?: string;
    };

export type DataPlan =
  | { mode: "raw" }
  | {
      mode: "derived";
      title?: string;
      transform: TransformSpec;
    };

export type DashboardChartEntry = {
  id: string;
  name: string;
  chartType: string;
  dsl: Record<string, unknown>;
  abcProgram?: AbcProgramDashboard;
  fields?: Record<string, unknown>;
  dataPlan?: DataPlan;
  conditions?: unknown[];
  layout?: DashboardLayout;
  source?: {
    threadId?: string;
    requestSeq?: number;
    datasetIndex?: number;
    datasetKey?: string;
    subQuestion?: string;
  };
};

export type DashboardMetricEntry = {
  id: string;
  name: string;
  unit?: string;
  dsl: Record<string, unknown>;
  abcProgram?: AbcProgramDashboard;
  dataPlan?: DataPlan;
  agg?: "count" | "sum" | "avg";
  valueField?: string;
  layout?: DashboardLayout;
  source?: {
    threadId?: string;
    requestSeq?: number;
    datasetIndex?: number;
    datasetKey?: string;
    subQuestion?: string;
  };
};

export type DashboardGroup = {
  id: string;
  title: string;
  charts: DashboardChartEntry[];
  metrics: DashboardMetricEntry[];
};

export type DashboardDetail = {
  id: string;
  ownerId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  source?: {
    threadId?: string;
    requestSeq?: number;
  };
  groups: DashboardGroup[];
};

export type DashboardListItem = Pick<DashboardDetail, "id" | "name" | "createdAt" | "updatedAt">;

export type AbcProgramOutKeyRef = {
  key: string;
  className?: string;
  attrName?: string;
  asGroupBy?: boolean;
  statCal?: boolean;
};

export type AbcProgramParameter = {
  key: string;
  name?: string;
  type?: string;
  value?: unknown;
  className?: string;
  attrName?: string;
};

export type AbcProgramDashboard = {
  title: string;
  code: string;
  outKeyRefs: AbcProgramOutKeyRef[];
  parameters?: AbcProgramParameter[];
};
