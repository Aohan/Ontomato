// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import {
  fetchDashboardLocalDetail,
  getAnswerByDslConditionParam,
  getConditionsFromDsl,
} from "../../api";
import { queryViewApi } from "../../../query-view";
import { applyDataPlan } from "./dataPlan";
import echartsGenerator from "./echartsGenerator";

/* ======================== Basic utility functions ======================== */

export function normalizeId(v) {
  return String(v || "").trim();
}

export function isAbortError(e) {
  if (!e) return false;
  if (e?.name === "AbortError") return true;
  const msg = typeof e?.message === "string" ? e.message : "";
  return msg.includes("AbortError") || msg.includes("aborted");
}

export function toNumber(v) {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function fetchClassMetas() {
  try {
    const json = await queryViewApi.getMetas();
    const def = Array.isArray(json?.data?.classDef) ? json.data.classDef : [];

    const cmap = {};
    for (const d of def) {
      if (!d?.className) continue;
      const perClass = {};
      for (const a of Array.isArray(d?.attrs) ? d.attrs : []) {
        if (!a?.name) continue;
        perClass[a.name] = a.showName || a.attrDesc || a.name;
      }
      cmap[d.className] = perClass;
    }

    return cmap;
  } catch {
    return {};
  }
}

function computeMetricValue(rows, opts = {}) {
  const input = Array.isArray(rows) ? rows : [];
  if (!input.length) return 0;

  const sample = input.slice(0, Math.min(20, input.length));
  const keys = Object.keys(sample[sample.length - 1] || {});

  const numericKeys = keys.filter((k) => {
    let seen = 0;
    let num = 0;
    for (const r of sample) {
      const v = r?.[k];
      if (v == null || v === "") continue;
      seen++;
      if (toNumber(v) != null) num++;
    }
    return seen > 0 && num / seen >= 0.6;
  });

  const valueField = opts.valueField || numericKeys[0] || "";

  if (!valueField) return input.length;

  const agg = opts.agg === "avg" ? "avg" : "sum";

  if (agg === "avg") {
    let sum = 0;
    let cnt = 0;
    for (const r of input) {
      const v = toNumber(r?.[valueField]);
      if (v == null) continue;
      sum += v;
      cnt++;
    }
    return cnt ? sum / cnt : 0;
  }

  let sum = 0;
  let hasAny = false;
  for (const r of input) {
    const v = toNumber(r?.[valueField]);
    if (v == null) continue;
    sum += v;
    hasAny = true;
  }

  return hasAny ? sum : input.length;
}

/* ======================== Concurrency control ======================== */

export async function runTaskPool(tasks, concurrency, signal) {
  const max = Math.max(1, Math.floor(concurrency || 1));
  let cursor = 0;

  const workers = Array.from({ length: Math.min(max, tasks.length) }, async () => {
    while (true) {
      if (signal?.aborted) return;
      const idx = cursor++;
      if (idx >= tasks.length) return;
      await tasks[idx]();
    }
  });

  await Promise.all(workers);
}

/* ======================== Condition mapping ======================== */

export async function buildConditionsMap(id) {
  const tmp = new Map();

  const detail = await fetchDashboardLocalDetail(id);
  const groups = Array.isArray(detail?.groups) ? detail.groups : [];

  for (const group of groups) {
    for (const chart of Array.isArray(group?.charts) ? group.charts : []) {
      const chartId = normalizeId(chart?.id);
      const conds = Array.isArray(chart?.conditions) ? chart.conditions : [];
      if (chartId && conds.length) {
        tmp.set(chartId, conds);
      }
    }
  }

  return tmp;
}

/* ======================== Patch series (pure functions) ======================== */

export function patchDimensionTitle(groups, groupId, nextTitle) {
  const title = String(nextTitle || "").trim();
  if (!groupId || !title) return groups;

  return groups.map((g) => {
    const gid = normalizeId(g?.id || "");
    return gid === groupId ? { ...g, title } : g;
  });
}

export function patchDeleteDimension(groups, groupId) {
  if (!groupId) return groups;
  return groups.filter((g) => normalizeId(g?.id || "") !== groupId);
}

export function patchChartTitle(groups, chartId, nextTitle) {
  const cid = normalizeId(chartId);
  const title = String(nextTitle || "").trim();
  if (!cid || !title) return groups;

  return groups.map((g) => {
    if (!g || !Array.isArray(g.charts)) return g;
    return {
      ...g,
      charts: g.charts.map((c) => (normalizeId(c?.id) === cid ? { ...c, title } : c)),
    };
  });
}

export function patchDeleteChart(groups, chartId) {
  const cid = normalizeId(chartId);
  if (!cid) return groups;

  return groups.map((g) => {
    if (!g || !Array.isArray(g.charts)) return g;

    return {
      ...g,
      charts: g.charts.filter((c) => normalizeId(c?.id) !== cid),
    };
  });
}

export function patchChartOption(groups, chartId, option, chartType, rows, fields, dsl) {
  const cid = normalizeId(chartId);
  if (!cid) return groups;

  return groups.map((g) => {
    if (!g || !Array.isArray(g.charts)) return g;

    return {
      ...g,
      charts: g.charts.map((c) =>
        normalizeId(c?.id) === cid
          ? {
              ...c,
              option,
              chartType,
              rows: rows || c?.rows || [],
              fields: fields ?? c?.fields,
              dsl: dsl ?? c?.dsl,
            }
          : c
      ),
    };
  });
}

export function patchChartConditions(groups, chartId, conditions) {
  const cid = normalizeId(chartId);
  if (!cid) return groups;

  return groups.map((g) => {
    if (!g || !Array.isArray(g.charts)) return g;

    return {
      ...g,
      charts: g.charts.map((c) =>
        normalizeId(c?.id) === cid
          ? { ...c, option: { ...c.option, __ragchatState: "loading" }, conditions }
          : c
      ),
    };
  });
}

function patchChartConditionsMeta(groups, chartId, conditions) {
  const cid = normalizeId(chartId);
  if (!cid) return groups;

  return groups.map((g) => {
    if (!g || !Array.isArray(g.charts)) return g;
    return {
      ...g,
      charts: g.charts.map((c) =>
        normalizeId(c?.id) === cid
          ? { ...c, conditions: Array.isArray(conditions) ? conditions : [] }
          : c
      ),
    };
  });
}

export function patchMetricTitle(groups, metricId, nextTitle) {
  const mid = normalizeId(metricId);
  const name = String(nextTitle || "").trim();
  if (!mid || !name) return groups;

  return groups.map((g) => {
    const metrics = Array.isArray(g?.metrics) ? g.metrics : [];
    if (!metrics.length) return g;

    return {
      ...g,
      metrics: metrics.map((m) => {
        return normalizeId(m?.id) === mid ? { ...m, name } : m;
      }),
    };
  });
}

export function patchDeleteMetric(groups, metricId) {
  const mid = normalizeId(metricId);
  if (!mid) return groups;

  return groups.map((g) => {
    if (!g) return g;
    const metrics = Array.isArray(g?.metrics) ? g.metrics : [];
    if (!metrics.length) return g;
    const nextMetrics = metrics.filter((m) => normalizeId(m?.id) !== mid);
    return nextMetrics.length === metrics.length ? g : { ...g, metrics: nextMetrics };
  });
}

/* ======================== Dashboard loading ======================== */

export function createDashboardLoader() {
  let abortController = null;
  let loadSeq = 0;

  function abort() {
    abortController?.abort();
  }

  /**
   * @param {string} id
   * @param {(updater: any) => void} setGroups  - React setState or a similar signature: setGroups(next) / setGroups(prev => next)
   */
  async function loadDashboardById(id, setGroups) {
    if (abortController) abortController.abort();
    abortController = new globalThis.AbortController();
    const signal = abortController.signal;
    const seq = ++loadSeq;

    const guard = () => seq === loadSeq && !signal.aborted;

    // 1) Fetch local config
    let detail;
    try {
      detail = await fetchDashboardLocalDetail(id, { signal });
    } catch (e) {
      if (isAbortError(e)) return;
      // If you want to clear the UI: setGroups([]) also works
      setGroups([]);
      return;
    }
    if (!guard()) return;

    const localGroups = Array.isArray(detail?.groups) ? detail.groups : [];

    // 2) First build the "render-state structure" (both charts and metrics start in loading)
    const { renderGroups, tasks } = buildRenderModelAndTasks({
      dashboardId: id,
      localGroups,
      setGroups,
      guard,
      signal,
    });

    // 3) First render the structure (loading)
    setGroups(renderGroups);

    // 4) Run tasks concurrently: fetch chart/metric data and patch it back
    try {
      await runTaskPool(tasks, 4, signal); // concurrency is adjustable
    } catch (e) {
      // taskPool itself may throw on abort depending on your implementation; fall back here
      if (isAbortError(e)) return;
    }
  }

  return { loadDashboardById, abort };
}

/**
 * Map groups into a renderable structure and generate chart/metric fetch tasks
 */
function buildRenderModelAndTasks({ dashboardId, localGroups, setGroups, guard, signal }) {
  const renderGroups = [];
  const tasks = [];
  for (const g of localGroups) {
    const groupTitle = String(g?.title || "").trim();
    const charts = Array.isArray(g?.charts) ? g.charts : [];
    const metrics = Array.isArray(g?.metrics) ? g.metrics : [];

    // charts rendering
    const renderCharts = [];
    for (const c of charts) {
      const chartTitle = String(c?.name || c?.title || "").trim();
      if (!chartTitle) continue;

      const chartType = String(c?.chartType || c?.type || "").trim();
      const conditions = Array.isArray(c?.conditions)
        ? c.conditions
        : Array.isArray(c?.abcProgram?.parameters)
          ? c.abcProgram.parameters
          : null;
      const dataPlan = c?.dataPlan && typeof c.dataPlan === "object" ? c.dataPlan : null;
      const fields = c?.fields && typeof c.fields === "object" ? c.fields : null;
      const chartId = normalizeId(c?.id);
      const dsl = c?.dsl && typeof c.dsl === "object" && !Array.isArray(c.dsl) ? c.dsl : null;
      const abcProgram =
        c?.abcProgram && typeof c.abcProgram === "object" && !Array.isArray(c.abcProgram)
          ? c.abcProgram
          : null;
      const source = c?.source && typeof c.source === "object" ? c.source : null;
      if (!chartId || (!dsl && !abcProgram)) continue;

      renderCharts.push({
        id: chartId,
        title: chartTitle,
        chartType,
        dataPlan,
        fields,
        conditions,
        layout: c?.layout && typeof c.layout === "object" ? c.layout : { colSpan: 12, rowSpan: 1 },
        option: { __ragchatState: "loading" },
        dsl: dsl || {},
        abcProgram,
        source,
      });

      // one task per chart
      tasks.push(async () => {
        if (!guard()) return;

        try {
          let effectiveConditions = Array.isArray(conditions) ? conditions : [];
          if (!effectiveConditions.length && dsl) {
            try {
              const fetchedConditions = await getConditionsFromDsl(dsl);
              if (!guard()) return;
              if (Array.isArray(fetchedConditions) && fetchedConditions.length) {
                effectiveConditions = fetchedConditions;
                setGroups((prev) => patchChartConditionsMeta(prev, chartId, fetchedConditions));
              }
            } catch {
              // Don't block chart data loading when the condition API fails
            }
          }

          const {
            data: rows,
            rawData,
            fields: mappedFields,
            dsl: nextDsl,
          } = await getAnswerByDslConditionParam({
            dsl,
            abcProgram,
            conditions: effectiveConditions,
            chartType,
            chartTitle,
            fields,
            dataPlan,
            timeoutMs: abcProgram ? 300000 : 30000,
          });
          if (!guard()) return;

          const chartRows = applyDataPlan(rawData, dataPlan);
          const usedFields = mappedFields || fields || {};

          if (!chartRows.length) {
            setGroups((prev) =>
              patchChartOption(
                prev,
                chartId,
                { __ragchatState: "empty" },
                chartType,
                [],
                usedFields,
                nextDsl || dsl || {}
              )
            );
            return;
          }

          const { option, health } = echartsGenerator.generateWithHealth(
            chartType || "bar",
            chartTitle,
            usedFields,
            chartRows
          );

          if (!health.ok) {
            setGroups((prev) =>
              patchChartOption(
                prev,
                chartId,
                { ...option, __ragchatState: "error" },
                chartType,
                rows,
                usedFields,
                nextDsl || dsl || {}
              )
            );
            return;
          }

          setGroups((prev) =>
            patchChartOption(
              prev,
              chartId,
              option,
              chartType,
              rows,
              usedFields,
              nextDsl || dsl || {}
            )
          );
        } catch (e) {
          if (isAbortError(e)) return;
          setGroups((prev) =>
            patchChartOption(prev, chartId, { __ragchatState: "error" }, chartType)
          );
        }
      });
    }

    // metrics rendering
    const renderMetrics = [];
    for (const m of metrics) {
      const name = String(m?.name || "").trim();
      if (!name) continue;

      const unit = String(m?.unit || "").trim();
      const dataPlan = m?.dataPlan && typeof m.dataPlan === "object" ? m.dataPlan : null;
      const metricId = normalizeId(m?.id);
      const dsl = m?.dsl && typeof m.dsl === "object" && !Array.isArray(m.dsl) ? m.dsl : null;
      const abcProgram =
        m?.abcProgram && typeof m.abcProgram === "object" && !Array.isArray(m.abcProgram)
          ? m.abcProgram
          : null;
      const source = m?.source && typeof m.source === "object" ? m.source : null;
      if (!metricId || (!dsl && !abcProgram)) continue;

      renderMetrics.push({
        ...m,
        id: metricId,
        name,
        unit,
        value: null,
        state: "loading",
        layout: m?.layout && typeof m.layout === "object" ? m.layout : { colSpan: 3, rowSpan: 1 },
        dsl: dsl || {},
        abcProgram,
        source,
      });

      tasks.push(async () => {
        if (!guard()) return;

        try {
          const inputValueField = typeof m?.valueField === "string" ? m.valueField.trim() : "";
          const args = {
            id: dashboardId,
            chartId: metricId,
            chartTitle: name,
            chartType: "metric",
            dataPlan,
            dsl: dsl || {},
            abcProgram,
            source,
          };
          if (inputValueField) args.fields = { value: inputValueField };

          const {
            rawData,
            fields: mappedFields,
            dsl: nextDsl,
          } = await getAnswerByDslConditionParam(args, { signal });
          if (!guard()) return;

          const metricRows = applyDataPlan(rawData, dataPlan);

          const valueField =
            typeof mappedFields?.value === "string" && mappedFields.value.trim()
              ? mappedFields.value.trim()
              : inputValueField;
          const value = computeMetricValue(metricRows, {
            agg: m?.agg,
            valueField,
          });

          setGroups((prev) =>
            patchMetricValue(prev, metricId, value, "ready", nextDsl || dsl, valueField)
          );
        } catch (e) {
          if (isAbortError(e)) return;
          setGroups((prev) => patchMetricValue(prev, metricId, null, "error"));
        }
      });
    }

    const groupId = normalizeId(g?.id);

    renderGroups.push({
      title: groupTitle,
      id: groupId,
      charts: renderCharts,
      metrics: renderMetrics,
    });
  }

  return { renderGroups, tasks };
}

/**
 * Backfill metric value/state
 * Locating by the three keys dimensionId + resultSetId + name is more robust (the same resultSet may have multiple metric fields)
 */
function patchMetricValue(prevGroups, metricId, value, state, dsl, valueField) {
  if (!Array.isArray(prevGroups)) return prevGroups;
  const mid = normalizeId(metricId);
  if (!mid) return prevGroups;

  return prevGroups.map((g) => {
    if (!g || !Array.isArray(g.metrics)) return g;

    let changed = false;
    const nextMetrics = g.metrics.map((m) => {
      if (normalizeId(m?.id) !== mid) return m;
      changed = true;
      const next = { ...m, value, state, dsl: dsl ?? m?.dsl };
      if (typeof valueField === "string" && valueField && valueField !== m?.valueField)
        next.valueField = valueField;
      return next;
    });

    return changed ? { ...g, metrics: nextMetrics } : g;
  });
}

export function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

export function parseGridColumns(el) {
  if (!el) return { colCount: 1, colWidth: el?.clientWidth || 1, gap: 0 };
  const cs = globalThis.getComputedStyle(el);
  const cols = (cs.gridTemplateColumns || "").split(" ").filter(Boolean);
  const gap = parseFloat(cs.columnGap || cs.gap || "0") || 0;

  const colCount = Math.max(1, cols.length || 1);
  const total = el.clientWidth;
  const colWidth = colCount > 0 ? (total - gap * (colCount - 1)) / colCount : total;
  return { colCount, colWidth, gap };
}
