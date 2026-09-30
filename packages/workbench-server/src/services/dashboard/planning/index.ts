import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";

import {
  batchAppendChartFieldMapper,
  batchDashboardChartFieldMapper,
  recommendAppendDatasetPlan,
  recommendDashboardDatasetPlan,
} from "./core/chart-recommender";
import {
  applyDataPlan,
  buildDatasetProfile,
  isNumericLike,
  pickFirstNumericKey,
} from "./core/utils";
import type {
  DashboardPlanningChainInput,
  DashboardPlanningChainOutput,
  DatasetInput,
  DatasetProfile,
  PlannedDashboardChartEntry,
  PlannedDashboardGroup,
  PlannedDashboardMetricEntry,
} from "./types/index";

export { applyDataPlan };

export function createDashboardPlanningChain() {
  // Step 1: dataset configuration build
  const datasetProfileBuilder = RunnableLambda.from(
    async (input: Partial<DashboardPlanningChainInput> & { datasets: DatasetInput[] }) => {
      const datasets = Array.isArray(input?.datasets) ? input.datasets : [];
      const profiles = datasets.map((ds) => buildDatasetProfile(ds));
      const mode = input?.mode === "append" ? "append" : "dashboard";

      const existingChartTypes = Array.isArray(input?.existingChartTypes)
        ? input.existingChartTypes.map((x: any) => String(x)).filter(Boolean)
        : undefined;
      return { mode, existingChartTypes, datasets, profiles };
    }
  ).withConfig({ runName: "dashboard_profile" });

  // Step 2: structure planning
  const structurePlanner = RunnableLambda.from(
    async (input: {
      mode: "dashboard" | "append";
      existingChartTypes?: string[];
      profiles: DatasetProfile[];
    }): Promise<DashboardPlanningChainOutput> => {
      const { existingChartTypes, profiles } = input;

      if (input.mode === "append") {
        const plan = await recommendAppendDatasetPlan(profiles, existingChartTypes || []);
        const { charts = [], metrics = [] } = plan as any;
        return { mode: "append", charts, metrics, profiles };
      } else {
        const plan = await recommendDashboardDatasetPlan(profiles);
        const { name = "", groups = [] } = plan as any;
        return { mode: "dashboard", name, groups, profiles };
      }
    }
  ).withConfig({ runName: "dashboard_structure_plan" });

  // Step 3: chart card field mapping
  const attachFieldsToPlanned = RunnableLambda.from(
    async (
      input:
        | {
            mode: "dashboard";
            name?: string;
            groups: PlannedDashboardGroup[];
            profiles: DatasetProfile[];
          }
        | { mode: "append"; charts: any[]; metrics: any[]; profiles: DatasetProfile[] }
    ): Promise<DashboardPlanningChainOutput> => {
      if (input.mode === "append") {
        const plan = await batchAppendChartFieldMapper(input.charts, input.profiles);
        const { charts = [] } = plan as any;
        return { mode: "append", charts, metrics: input.metrics, profiles: input.profiles };
      } else {
        const plan = await batchDashboardChartFieldMapper(input.groups, input.profiles);
        const { groups = [] } = plan as any;
        return { mode: "dashboard", name: input.name, groups, profiles: input.profiles };
      }
    }
  ).withConfig({ runName: "dashboard_attach_fields" });

  // Step 4: metric spec finalization
  const finalizeOutput = RunnableLambda.from(
    async (
      input:
        | {
            mode: "dashboard";
            name?: string;
            groups: PlannedDashboardGroup[];
            profiles: DatasetProfile[];
          }
        | {
            mode: "append";
            charts: PlannedDashboardChartEntry[];
            metrics: PlannedDashboardMetricEntry[];
            profiles: DatasetProfile[];
          }
    ): Promise<DashboardPlanningChainOutput> => {
      const groups: PlannedDashboardGroup[] =
        input.mode === "append"
          ? [{ title: "append", charts: input.charts, metrics: input.metrics }]
          : input.groups || [];

      const profileIndex = new Map<string, DatasetProfile>();
      for (const p of input.profiles || []) profileIndex.set(p.datasetKey, p);

      const finalizeMetric = (m: PlannedDashboardMetricEntry): PlannedDashboardMetricEntry => {
        const prof = profileIndex.get(m.datasetKey);
        const baseRows = Array.isArray(prof?.sourceRows) ? prof.sourceRows : [];

        const plannedRows = applyDataPlan(baseRows, (m as any)?.dataPlan);
        const previewFields = plannedRows.length
          ? Object.keys(plannedRows[plannedRows.length - 1] || {})
          : [];
        const fields =
          previewFields.length > 0 ? previewFields : Array.isArray(prof?.fields) ? prof.fields : [];

        let agg = m.agg;
        let valueField = m.valueField;

        const valueFieldKey = typeof valueField === "string" ? valueField : "";
        const exists = valueFieldKey !== "" && fields.includes(valueFieldKey);

        const numericOK =
          agg === "count" ? true : exists ? isNumericLike(plannedRows, valueFieldKey) : false;

        if (!exists || !numericOK) {
          const k = pickFirstNumericKey(plannedRows);
          if (k) {
            valueField = k;
            if (agg === "count") agg = "sum";
          } else {
            agg = "count";
            valueField = "__count__";
          }
        }

        if (agg === m.agg && valueField === m.valueField) return m;
        return { ...m, agg, valueField };
      };

      const finalizedGroups: PlannedDashboardGroup[] = groups.map((g) => {
        const metrics = (g.metrics || []).map(finalizeMetric);
        return { ...g, metrics };
      });

      if (input.mode === "append") {
        const g0 = finalizedGroups[0];
        return { mode: "append", charts: g0?.charts || [], metrics: g0?.metrics || [] };
      } else {
        return { mode: "dashboard", name: input.name, groups: finalizedGroups };
      }
    }
  ).withConfig({ runName: "dashboard_finalize" });

  return RunnableSequence.from([
    datasetProfileBuilder,
    structurePlanner,
    attachFieldsToPlanned,
    finalizeOutput,
  ]);
}
