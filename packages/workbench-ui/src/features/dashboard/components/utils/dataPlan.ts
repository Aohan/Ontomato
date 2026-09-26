import type { DataPlan, TransformSpec } from "@ontomato/contracts/dashboard";
type MetricSpec = Extract<TransformSpec, { kind: "groupBy" }>["metrics"][number];
import { t } from "../../../../i18n";


type Row = Record<string, unknown>;

type GroupState = { keyParts: unknown[]; count: number; sums: Record<string, number> };

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function applyTransformSpec(rows: unknown, spec: TransformSpec): Row[] {
  const input: Row[] = Array.isArray(rows) ? rows.filter(isRow) : [];
  if (!input.length || !spec) return input.slice();

  if (spec.kind === "groupBy") {
    const map = new Map<string, GroupState>();
    for (const row of input) {
      const keyParts = (spec.groupBy || []).map((field) => row?.[field] ?? t("common.unknown"));
      const key = keyParts.join("||");
      if (!map.has(key)) {
        map.set(key, { keyParts, count: 0, sums: {} });
      }
      const state = map.get(key)!;
      state.count += 1;
      for (const metric of spec.metrics || []) {
        if (!metric?.field) continue;
        state.sums[metric.field] =
          (state.sums[metric.field] || 0) + (toNumber(row?.[metric.field]) || 0);
      }
    }

    let result = Array.from(map.values()).map((state) => {
      const obj: Row = {};
      (spec.groupBy || []).forEach((field, index) => {
        obj[field] = state.keyParts[index];
      });
      for (const metric of spec.metrics || []) {
        if (!metric?.op || !metric.as) continue;
        obj[metric.as] = computeMetricValue(metric, state);
      }
      return obj;
    });

    if (spec.sortBy?.field) {
      const sortField = spec.sortBy.field;
      const order = spec.sortBy.order === "asc" ? 1 : -1;
      result = result.sort(
        (a, b) =>
          ((toNumber(sortField ? a[sortField] : undefined) || 0) -
            (toNumber(sortField ? b[sortField] : undefined) || 0)) *
          order
      );
    }

    if (spec.limit && result.length > spec.limit) {
      return result.slice(0, spec.limit);
    }
    return result;
  }

  return input.slice();
}

function computeMetricValue(metric: MetricSpec, state: GroupState) {
  const { op, field } = metric;
  const sumValue = field ? state.sums[field] || 0 : 0;
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

export function applyDataPlan(rows: unknown, plan?: DataPlan | null): Row[] {
  if (plan?.mode === "derived" && plan?.transform) {
    return applyTransformSpec(rows, plan.transform);
  }
  return Array.isArray(rows) ? rows : [];
}

function isRow(value: unknown): value is Row {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
