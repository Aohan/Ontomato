import type { AbcProgramDashboard } from "@ontomato/contracts/dashboard";

export type DashboardDatasetInput = {
  datasetKey: string;
  subQuestion: string;
  data: Array<Record<string, unknown>>;
  dsl: Record<string, unknown>;
  abcProgram?: AbcProgramDashboard;
  source?: {
    threadId?: string;
    requestSeq?: number;
    datasetIndex?: number;
  };
};
