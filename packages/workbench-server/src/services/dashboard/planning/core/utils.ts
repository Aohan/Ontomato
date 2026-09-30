import { tApp } from "../../../../i18n";
import type { TransformSpec, DataPlan } from "@ontomato/contracts/dashboard";
import type { DatasetProfile, DatasetInput, DataType } from "../types/index";
import { buildModelDataView } from "../../../../utils/model-data-view";

export function toNumber(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function cleanJsonBlock(text: string) {
  return String(text ?? "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

export function getChartFieldContract(chartType: string): string[] {
  const CHART_FIELD_CONTRACTS: Record<string, string[]> = {
    metric: [tApp("queryFixed.151")],
    pie: [tApp("queryFixed.152"), tApp("queryFixed.151")],
    "nightingale-rose": [tApp("queryFixed.152"), tApp("queryFixed.151")],
    "bar-line": [tApp("queryFixed.153"), tApp("queryFixed.154"), tApp("queryFixed.155")],
    "pictorial-bar": [tApp("queryFixed.156"), tApp("queryFixed.157")],
    sankey: [tApp("queryFixed.158"), tApp("queryFixed.159"), tApp("queryFixed.160")],
    "liquid-fill": [tApp("queryFixed.161")],
    scatter: [tApp("queryFixed.162"), tApp("queryFixed.163"), tApp("queryFixed.164")],
    sunburst: [tApp("queryFixed.165"), tApp("queryFixed.166")],
    treemap: [tApp("queryFixed.167"), tApp("queryFixed.166")],
    boxplot: [tApp("queryFixed.168"), tApp("queryFixed.169")],
    "area-line": [tApp("queryFixed.153"), tApp("queryFixed.163")],
    gauge: [tApp("queryFixed.170")],
    radar: [tApp("queryFixed.171"), tApp("queryFixed.172")],
    funnel: [tApp("queryFixed.173"), tApp("queryFixed.166")],
  };
  return CHART_FIELD_CONTRACTS[chartType] ?? [];
}

export function applyTransformSpec(
  rows: Array<Record<string, any>>,
  spec: TransformSpec
): Array<Record<string, any>> {
  const input = Array.isArray(rows) ? rows : [];
  if (!input.length || !spec) return input.slice();

  if (spec.kind === "groupBy") {
    const map = new Map<string, { keyParts: any[]; count: number; sums: Record<string, number> }>();
    for (const r of input) {
      const keyParts = (spec.groupBy || []).map((field) => r?.[field] ?? tApp("queryFixed.174"));
      const key = keyParts.map((v) => String(v ?? "")).join("||");

      let st = map.get(key);
      if (!st) {
        st = { keyParts, count: 0, sums: {} };
        map.set(key, st);
      }

      st.count += 1;

      for (const metric of spec.metrics || []) {
        const field = metric?.field;
        if (!field) continue;
        const v = toNumber(r?.[field]) || 0;
        st.sums[field] = (st.sums[field] ?? 0) + v;
      }
    }

    let result = [...map.values()].map((st) => {
      const obj: Record<string, any> = {};
      (spec.groupBy || []).forEach((field, index) => {
        obj[field] = st.keyParts[index];
      });
      for (const metric of spec.metrics || []) {
        if (!metric?.op || !metric.as) continue;
        obj[metric.as] = computeMetricValue(metric, st);
      }
      return obj;
    });

    const sortBy = spec.sortBy;
    if (sortBy?.field) {
      const order = sortBy.order === "asc" ? 1 : -1;
      result = result.sort(
        (a, b) => ((toNumber(a[sortBy.field]) || 0) - (toNumber(b[sortBy.field]) || 0)) * order
      );
    }

    if (spec.limit && result.length > spec.limit) {
      return result.slice(0, spec.limit);
    }

    return result;
  }

  return input.slice();
}

type GroupByTransformSpec = Extract<TransformSpec, { kind: "groupBy" }>;

function computeMetricValue(
  metric: GroupByTransformSpec["metrics"][number],
  state: { count: number; sums: Record<string, number> }
) {
  const { op, field } = metric;
  const sumValue = field ? (state.sums[field] ?? 0) : 0;
  const { count } = state;

  if (op === "count") {
    return count;
  }

  if (op === "avg") {
    return count ? sumValue / count : 0;
  }

  if (op === "sum") {
    if (sumValue === 0 && count > 0) {
      return count;
    }
    return sumValue;
  }

  return sumValue;
}

export function applyDataPlan(
  rows: Array<Record<string, any>>,
  plan?: DataPlan
): Array<Record<string, any>> {
  if (plan?.mode === "derived" && plan.transform) {
    return applyTransformSpec(rows, plan.transform);
  }
  return rows;
}

export function isNumericLike(rows: any[], key: string) {
  let seen = 0;
  let num = 0;
  for (const r of rows) {
    const v = r?.[key];
    if (v == null || v === "") continue;
    seen++;
    const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
    if (Number.isFinite(n)) num++;
  }
  return seen > 0 && num / seen >= 0.6;
}

export function pickFirstNumericKey(rows: any[]): string | "" {
  if (!rows.length) return "";
  const sample = rows.slice(0, Math.min(20, rows.length));
  const keys = Object.keys(sample[sample.length - 1] || {});
  const numericKeys = keys.filter((k) => isNumericLike(sample, k));
  return numericKeys[0] || "";
}

export function buildDatasetProfile(ds: DatasetInput): DatasetProfile {
  const rows = Array.isArray(ds?.data) ? ds.data : [];
  const rowCount = rows.length;
  const fields = Array.from(new Set(rows.flatMap((row) => Object.keys(row || {}))));
  const dataView = buildModelDataView(rows);

  const isSingleRowSmall = rowCount === 1;
  const hasFiniteNumber = rows.some((row) =>
    fields.some(
      (field) => typeof row?.[field] === "number" && Number.isFinite(row[field] as number)
    )
  );

  const dataType: DataType = isSingleRowSmall
    ? "metric_summary"
    : hasFiniteNumber
      ? "chart_summary"
      : "object_detail";

  return {
    datasetKey: ds.datasetKey,
    subQuestion: ds.subQuestion,
    dsl: ds.dsl,
    rowCount,
    fields,
    sourceRows: rows,
    dataView,
    dataType,
  };
}
