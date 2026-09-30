// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
/* =============================================================================
 * EchartsGenerator.js - a more polished / more robust option generator (adapted to your echartsTheme)
 * ============================================================================= */

import { t } from "../../../../i18n";
import { workbenchContent } from "../../../../content";

const chartColors = () => workbenchContent().dashboard.chartColors;
const reasonText = () => workbenchContent().dashboard.healthReasons;


function isNil(v) {
  return v === null || v === undefined;
}

function isNumberLike(v) {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s) return false;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n);
}

function toNumber(v, fallback = 0) {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string") {
    const s = v.trim().replace(/,/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function pickFirstKey(row) {
  if (!row || typeof row !== "object") return null;
  const keys = Object.keys(row);
  return keys[0] || null;
}

function pickSecondKey(row, firstKey) {
  if (!row || typeof row !== "object") return null;
  const keys = Object.keys(row);
  return keys.find((k) => k !== firstKey) || null;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function mergeDeep(target, src) {
  const t = target && typeof target === "object" ? target : {};
  const s = src && typeof src === "object" ? src : {};
  const out = Array.isArray(t) ? [...t] : { ...t };

  for (const [k, v] of Object.entries(s)) {
    if (Array.isArray(v)) {
      out[k] = v.slice();
    } else if (v && typeof v === "object") {
      out[k] = mergeDeep(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function defaultFormatter(v) {
  if (isNil(v)) return "-";
  if (typeof v === "number") return String(v);
  if (isNumberLike(v)) return String(toNumber(v));
  return String(v);
}

function formatPercent(v) {
  const n = toNumber(v, 0);
  // n may be 0-1 or 0-100
  const p = n <= 1 ? n * 100 : n;
  return `${p.toFixed(0)}%`;
}

function truncateLabel(s, maxLen = 10) {
  const str = String(s ?? "");
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "…";
}

function wrapLabel(s, maxCharsPerLine = 6, maxLines = 2) {
  const str = String(s ?? "").trim();
  if (!str) return "";

  const safeChars = Math.max(1, maxCharsPerLine);
  const safeLines = Math.max(1, maxLines);
  const maxLen = safeChars * safeLines;
  const clipped = str.length > maxLen ? str.slice(0, Math.max(maxLen - 1, 1)) + "…" : str;
  const lines = [];

  for (let i = 0; i < clipped.length; i += safeChars) {
    lines.push(clipped.slice(i, i + safeChars));
  }
  return lines.join("\n");
}

function createBarGradient(color) {
  const presets = workbenchContent().dashboard.barGradients;

  const pair = presets[color] || [color, color];

  return {
    type: "linear",
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      {
        offset: 0,
        color: pair[0],
      },
      {
        offset: 1,
        color: pair[1],
      },
    ],
  };
}

function createAreaGradient(color) {
  const dashboard = workbenchContent().dashboard;
  const map = dashboard.areaGradients;

  const colors = map[color] || dashboard.defaultAreaGradient;

  return {
    type: "linear",
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      {
        offset: 0,
        color: colors[0],
      },
      {
        offset: 0.65,
        color: colors[1],
      },
      {
        offset: 1,
        color: colors[2],
      },
    ],
  };
}

function getThemeColor(index) {
  const colors = workbenchContent().dashboard.series;
  return colors[index % colors.length];
}

function buildTopNWithOthers(items, valueKey, nameKey, topN = 10, othersName = t("common.others")) {
  const arr = (items || []).map((d) => ({
    raw: d,
    name: d?.[nameKey] || "",
    value: toNumber(d?.[valueKey], 0),
  }));

  arr.sort((a, b) => b.value - a.value);

  const head = arr.slice(0, topN);
  const tail = arr.slice(topN);

  if (!tail.length) return head;

  const othersValue = tail.reduce((sum, x) => sum + x.value, 0);
  return [...head, { name: othersName, value: othersValue, raw: null }];
}

function guessXY(fields, data) {
  let x = fields?.xAxis || fields?.category || fields?.name;
  let y = fields?.yAxis || fields?.value;

  if ((!x || !y) && data?.length) {
    const k1 = pickFirstKey(data[0]);
    const k2 = pickSecondKey(data[0], k1);
    x = x || k1;
    y = y || k2;
  }
  return { x, y };
}

function baseOption() {
  return {
    animation: false, // more stable for dashboards
    tooltip: {
      confine: true,
      appendToBody: true,
      borderWidth: 0,
    },
    grid: {
      left: 20,
      right: 20,
      top: 20,
      bottom: 20,
      containLabel: true,
    },
    legend: {
      show: false,
    },
  };
}

/* =============================================================================
 * Option Health Check & Sanitize
 * ============================================================================= */

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function deepSanitize(obj) {
  // Purpose: remove undefined / NaN / Infinity to avoid echarts silently hanging or rendering blank
  if (obj === undefined) return null;
  if (obj === null) return null;

  if (typeof obj === "function") return obj;

  if (typeof obj === "number") {
    return Number.isFinite(obj) ? obj : null;
  }

  if (typeof obj === "string" || typeof obj === "boolean") return obj;

  if (Array.isArray(obj)) {
    return obj.map(deepSanitize).filter((v) => v !== undefined);
  }

  if (typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const sv = deepSanitize(v);
      // Keep null (sometimes meaningful), but drop undefined
      if (sv !== undefined) out[k] = sv;
    }
    return out;
  }

  return null;
}

function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

function makeHealth(ok, chartType, code = "OK", reasons = []) {
  return { ok, chartType, code, reasons };
}

/**
 * "Minimum renderable condition" check for each chart type
 * - Only hard validation (missing fields / empty data / wrong data shape / illegal values)
 * - No "does it look good" validation
 */
const ChartValidators = {
  "bar-line"({ option }) {
    const reasons = [];

    const xData = ensureArray(option?.xAxis?.data);
    if (!xData.length) reasons.push(reasonText().xAxisDataEmpty("bar-line"));

    const series = ensureArray(option?.series);
    const bars = series.filter((s) => s?.type === "bar");
    const lines = series.filter((s) => s?.type === "line");

    if (!bars.length) reasons.push(reasonText().barSeriesMissing);
    if (!lines.length) reasons.push(reasonText().lineSeriesMissing);

    const badLen = series.filter(
      (s) => Array.isArray(s?.data) && xData.length && s.data.length !== xData.length
    );
    if (badLen.length) reasons.push(reasonText().barLineLengthMismatch);

    return reasons.length
      ? makeHealth(false, "bar-line", "BARLINE_INVALID", reasons)
      : makeHealth(true, "bar-line");
  },
  "area-line"({ option }) {
    const reasons = [];

    const xData = ensureArray(option?.xAxis?.data);
    const s0 = ensureArray(option?.series)?.[0];
    const yData = ensureArray(s0?.data);
    if (!xData.length) reasons.push(reasonText().xAxisDataEmpty("area-line"));
    if (!yData.length) reasons.push(reasonText().seriesDataEmpty("area-line"));
    const finiteY = yData.filter((v) => isFiniteNumber(v));
    if (finiteY.every((v) => v === 0)) {
      reasons.push(reasonText().areaLineAllZero);
    }

    if (xData.length && yData.length && xData.length !== yData.length) {
      reasons.push(
        reasonText().areaLineLengthMismatch(xData.length, yData.length)
      );
    }
    return reasons.length
      ? makeHealth(false, "area-line", "AREALINE_INVALID", reasons)
      : makeHealth(true, "area-line");
  },

  scatter({ option }) {
    const reasons = [];

    const s0 = ensureArray(option?.series)?.[0];
    const d = ensureArray(s0?.data);
    if (!d.length) reasons.push(reasonText().seriesDataEmpty("scatter"));

    // Valid shapes: [[x,y], ...] or [y,y,y] (when xAxis is category and data only passes y)
    // Your current implementation produces both shapes, so we allow both, but must prevent mixed shapes / illegal items
    const bad = d.filter((p) => {
      if (Array.isArray(p))
        return p.length < 2 || !isFiniteNumber(p[1]) || p[0] === null || p[0] === undefined;
      return !(p === null || p === undefined || isFiniteNumber(p));
    });
    if (bad.length)
      reasons.push(
        reasonText().scatterIllegalPoints(bad.length)
      );

    return reasons.length
      ? makeHealth(false, "scatter", "SCATTER_INVALID", reasons)
      : makeHealth(true, "scatter");
  },

  radar({ option }) {
    const reasons = [];
    const indicators = ensureArray(option?.radar?.indicator);
    if (!indicators.length) reasons.push(reasonText().radarIndicatorEmpty);

    const s0 = ensureArray(option?.series)?.[0];
    const v0 = ensureArray(s0?.data)?.[0]?.value;
    const values = ensureArray(v0);
    if (!values.length) reasons.push(reasonText().radarValueEmpty);
    if (values.length <= 2)
      reasons.push(
        reasonText().radarTooFewDimensions
      );

    if (indicators.length && values.length && indicators.length !== values.length) {
      reasons.push(
        reasonText().radarLengthMismatch(indicators.length, values.length)
      );
    }

    // max <= 0 can make radar proportions abnormal or even invisible
    const badMax = indicators.filter((i) => !isFiniteNumber(i?.max) || i.max <= 0);
    if (badMax.length)
      reasons.push(reasonText().radarIllegalMax);

    return reasons.length
      ? makeHealth(false, "radar", "RADAR_INVALID", reasons)
      : makeHealth(true, "radar");
  },

  sankey({ option, fields }) {
    const reasons = [];

    if (!fields?.source || !fields?.target || !fields?.value) {
      reasons.push(reasonText().sankeyFieldsMissing);
    }

    const s0 = ensureArray(option?.series)?.[0];
    const nodes = ensureArray(s0?.data);
    const links = ensureArray(s0?.links);

    if (nodes.length <= 1) reasons.push(reasonText().sankeyNodesEmpty);
    if (links.length <= 1) reasons.push(reasonText().sankeyLinksEmpty);

    const nodeSet = new Set(nodes.map((n) => n?.name).filter(Boolean));
    const badLinks = links.filter((l) => !nodeSet.has(l?.source) || !nodeSet.has(l?.target));
    if (badLinks.length)
      reasons.push(reasonText().sankeyLinksOutsideNodes(badLinks.length));

    const values = links.map((l) => l?.value).filter((v) => v !== null && v !== undefined);
    const finiteVals = values.filter((v) => Number.isFinite(v));
    const positiveCount = finiteVals.filter((v) => v > 0).length;

    // All zeros / all non-positive: judged as unrenderable
    if (links.length && positiveCount === 0) {
      reasons.push(
        reasonText().sankeyAllZero
      );
      return makeHealth(false, "sankey", "SANKEY_ALL_ZERO", reasons);
    }

    // Illegal values also cause problems
    const badVal = links.filter((l) => !Number.isFinite(l?.value));
    if (badVal.length)
      reasons.push(reasonText().sankeyIllegalValues(badVal.length));

    // Duplicate edge hint (not fatal)
    const dupKey = (l) => `${String(l?.source)}->${String(l?.target)}`;
    const seen = new Set();
    let dup = 0;
    for (const l of links) {
      const k = dupKey(l);
      if (seen.has(k)) dup++;
      else seen.add(k);
    }
    if (dup)
      reasons.push(
        reasonText().sankeyDuplicateEdges(dup)
      );

    return reasons.length
      ? makeHealth(false, "sankey", "SANKEY_INVALID", reasons)
      : makeHealth(true, "sankey");
  },

  treemap({ option }) {
    const reasons = [];
    const s0 = ensureArray(option?.series)?.[0];
    const d = ensureArray(s0?.data);
    if (!d.length) reasons.push(reasonText().seriesDataEmpty("treemap"));
    const bad = d.filter((x) => !isFiniteNumber(x?.value));
    if (bad.length) reasons.push(reasonText().illegalValues("treemap", bad.length));
    return reasons.length
      ? makeHealth(false, "treemap", "TREEMAP_INVALID", reasons)
      : makeHealth(true, "treemap");
  },

  sunburst({ option }) {
    const reasons = [];
    const s0 = ensureArray(option?.series)?.[0];
    const d = ensureArray(s0?.data);
    if (!d.length) reasons.push(reasonText().seriesDataEmpty("sunburst"));
    return reasons.length
      ? makeHealth(false, "sunburst", "SUNBURST_INVALID", reasons)
      : makeHealth(true, "sunburst");
  },

  boxplot({ option }) {
    const reasons = [];

    const s0 = ensureArray(option?.series)?.[0];
    const d = ensureArray(s0?.data);
    if (!d.length) reasons.push(reasonText().seriesDataEmpty("boxplot"));
    // Each item should be [min, q1, median, q3, max]
    const bad = d.filter(
      (x) => !Array.isArray(x) || x.length !== 5 || x.some((v) => !isFiniteNumber(v))
    );
    if (bad.length)
      reasons.push(
        reasonText().boxplotIllegalItems(bad.length)
      );
    return reasons.length
      ? makeHealth(false, "boxplot", "BOXPLOT_INVALID", reasons)
      : makeHealth(true, "boxplot");
  },

  funnel({ option }) {
    const reasons = [];

    const s0 = ensureArray(option?.series)?.[0];
    const d = ensureArray(s0?.data);
    if (!d.length) reasons.push(reasonText().seriesDataEmpty("funnel"));
    const bad = d.filter((x) => !isFiniteNumber(x?.value));
    if (bad.length) reasons.push(reasonText().illegalValues("funnel", bad.length));
    return reasons.length
      ? makeHealth(false, "funnel", "FUNNEL_INVALID", reasons)
      : makeHealth(true, "funnel");
  },

  gauge({ option }) {
    const reasons = [];

    const s0 = ensureArray(option?.series)?.[0];
    const v = ensureArray(s0?.data)?.[0]?.value;
    if (!isFiniteNumber(v))
      reasons.push(reasonText().gaugeIllegalValue);
    return reasons.length
      ? makeHealth(false, "gauge", "GAUGE_INVALID", reasons)
      : makeHealth(true, "gauge");
  },

  "nightingale-rose"({ option }) {
    const reasons = [];

    const s0 = ensureArray(option?.series)?.[0];
    const d = ensureArray(s0?.data);
    if (!d.length) reasons.push(reasonText().seriesDataEmpty("nightingale-rose"));
    const bad = d.filter((x) => !isFiniteNumber(x?.value));
    if (bad.length) reasons.push(reasonText().illegalValues("nightingale-rose", bad.length));
    return reasons.length
      ? makeHealth(false, "nightingale-rose", "ROSE_INVALID", reasons)
      : makeHealth(true, "nightingale-rose");
  },

  pie({ option }) {
    const reasons = [];

    const s0 = ensureArray(option?.series)?.[0];
    const d = ensureArray(s0?.data);
    if (!d.length) reasons.push(reasonText().seriesDataEmpty("pie"));
    const bad = d.filter((x) => !isFiniteNumber(x?.value));
    if (bad.length) reasons.push(reasonText().illegalValues("pie", bad.length));

    return reasons.length
      ? makeHealth(false, "pie", "PIE_INVALID", reasons)
      : makeHealth(true, "pie");
  },

  "liquid-fill"({ option }) {
    const reasons = [];

    const s0 = ensureArray(option?.series)?.[0];
    const d = ensureArray(s0?.data);
    if (!d.length) reasons.push(reasonText().seriesDataEmpty("liquid-fill"));
    const bad = d.filter((v) => !isFiniteNumber(v));
    if (bad.length) reasons.push(reasonText().liquidFillIllegalValues(bad.length));

    return reasons.length
      ? makeHealth(false, "liquid-fill", "LIQUID_INVALID", reasons)
      : makeHealth(true, "liquid-fill");
  },
};

function validateOption(chartType, option, fields, data) {
  const key = String(chartType || "bar").replace(/\s+/g, "");
  const fn = ChartValidators[key];
  if (!fn) return makeHealth(true, key); // uncovered type: allow by default
  return fn({ option, fields, data });
}

function axisCategoryBase() {
  return {
    type: "category",
    axisTick: { alignWithLabel: true },
    axisLabel: {
      interval: 0,
      rotate: 30,
      width: 80,
      overflow: "truncate",
      hideOverlap: true,
      formatter: (v) => truncateLabel(v, 10),
    },
  };
}

function axisValueBase() {
  return {
    type: "value",
    axisLabel: {
      formatter: (v) => defaultFormatter(v),
    },
  };
}

export class EchartsGenerator {
  generate(type, title, fields, data) {
    return EchartsGenerator.generate(type, title, fields, data);
  }

  static generate(type, title, fields, data) {
    const map = {
      "bar-line": this.makeBarLine,
      "nightingale-rose": this.makeNightingaleRose,
      pie: this.makePie,
      "liquid-fill": this.makeLiquidFill,
      "pictorial-bar": this.makePictorialBar,
      scatter: this.makeScatter,
      sankey: this.makeSankey,
      radar: this.makeRadar,
      treemap: this.makeTreeMap,
      sunburst: this.makeSunburst,
      boxplot: this.makeBoxplot,
      funnel: this.makeFunnel,
      "area-line": this.makeAreaLine,
      gauge: this.makeGauge,
      bar: this.makeBar,
    };

    const chartType = String(type || "bar").replace(/\s+/g, "");
    const handler = map[chartType] || this.makeBar;
    const safeData = Array.isArray(data) ? data : [];

    // Merge the unified baseOption + per-type option
    const opt = handler.call(this, title, fields || {}, safeData) || {};
    const merged = mergeDeep(baseOption(title), opt);

    return deepSanitize(merged);
  }

  generateWithHealth(type, title, fields, data) {
    const option = EchartsGenerator.generate(type, title, fields, data);
    const chartType = String(type || "bar").replace(/\s+/g, "");
    const health = validateOption(chartType, option, fields || {}, Array.isArray(data) ? data : []);
    return { option, health };
  }

  /* ========= Basic bar chart (enhanced: tooltip / label / truncation / sortable) ========= */
  static makeBar(title, fields, data) {
    const { x, y } = guessXY(fields, data);
    if (!x || !y) return { series: [] };

    const rows = data.map((d) => ({ name: d?.[x] || "", value: toNumber(d?.[y], 0), raw: d }));

    const sort = String(fields?.sort || "").toLowerCase();
    if (sort === "desc") rows.sort((a, b) => b.value - a.value);
    else if (sort === "asc") rows.sort((a, b) => a.value - b.value);

    const xData = rows.map((r) => r.name);
    const yData = rows.map((r) => r.value);

    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: mergeDeep(axisCategoryBase(xData), { data: xData }),
      yAxis: axisValueBase(),
      series: [
        {
          type: "bar",
          name: String(title || y),
          label: {
            show: xData.length <= 12,
            position: "top",
            formatter: (p) => defaultFormatter(p.value),
          },
          emphasis: {
            focus: "series",
            itemStyle: {
              shadowBlur: 12,
              shadowColor: `rgba(${chartColors().primaryRgb},0.35)`,
            },
          },
          itemStyle: {
            color: createBarGradient(getThemeColor(0)),
            borderRadius: [8, 8, 0, 0],
          },
          barMaxWidth: 48,
          data: yData,
        },
      ],
    };
  }

  /* ========= Bar + line combo (supports dual axes) ========= */
  static makeBarLine(title, fields, data) {
    const xKey = fields?.xAxis || fields?.category || fields?.x;

    let barKeys = fields?.bar ?? fields?.bars ?? fields?.yAxis;
    if (typeof barKeys === "string") barKeys = [barKeys];
    if (!Array.isArray(barKeys)) barKeys = [];
    barKeys = barKeys.map((k) => String(k || "").trim()).filter(Boolean);

    let lineKey = String(fields?.line ?? fields?.yAxis2 ?? fields?.lineAxis ?? "").trim();
    if (!lineKey && barKeys.length >= 2) {
      lineKey = barKeys[1];
      barKeys = [barKeys[0]];
    }

    if (!xKey || !barKeys.length || !lineKey) return { series: [] };

    const safeRows = (Array.isArray(data) ? data : []).filter((d) => !isNil(d?.[xKey]));
    const xData = safeRows.map((d) => d?.[xKey]);

    const barSeries = barKeys.map((k, idx) => {
      const color = getThemeColor(idx);
      return {
        type: "bar",
        name: String(fields?.barNames?.[idx] || k),
        yAxisIndex: 0,
        emphasis: {
          focus: "series",
          itemStyle: {
            shadowBlur: 12,
            shadowColor: `rgba(${chartColors().primaryRgb},0.35)`,
          },
        },
        barMaxWidth: 32,
        itemStyle: {
          color: createBarGradient(color),
          borderRadius: [6, 6, 0, 0],
        },
        data: safeRows.map((d) => toNumber(d?.[k], 0)),
      };
    });

    const lineColor = getThemeColor(barKeys.length);
    const lineName = String(fields?.lineName || lineKey || title || "").trim() || lineKey;
    const lineSeries = {
      type: "line",
      name: lineName,
      yAxisIndex: 1,
      smooth: true,
      showSymbol: xData.length <= 24,
      symbolSize: 8,
      emphasis: { focus: "series" },
      lineStyle: {
        width: 2.5,
        color: lineColor,
        shadowBlur: 8,
        shadowColor: lineColor + "66",
      },
      itemStyle: {
        color: lineColor,
        borderColor: "#fff",
        borderWidth: 2,
      },
      areaStyle: {
        color: createAreaGradient(lineColor),
      },
      data: safeRows.map((d) => toNumber(d?.[lineKey], 0)),
    };

    return {
      tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
      legend: { show: true, top: 0, type: "scroll" },
      grid: { left: 20, right: 20, top: 36, bottom: 20, containLabel: true },
      xAxis: mergeDeep(axisCategoryBase(xData), { data: xData }),
      yAxis: [
        mergeDeep(axisValueBase(), { name: String(fields?.barAxisName || "").trim() || undefined }),
        mergeDeep(axisValueBase(), {
          name: String(fields?.lineAxisName || "").trim() || undefined,
        }),
      ],
      series: [...barSeries, lineSeries],
    };
  }

  /* ========= Nightingale rose chart (enhanced: TopN + others, legend, label) ========= */
  static makeNightingaleRose(title, fields, data) {
    const nameKey = fields.category || fields.name || "name";
    const valueKey = fields.value || "value";

    const topN = clamp(toNumber(fields.topN, 10), 3, 20);
    const items = buildTopNWithOthers(
      data,
      valueKey,
      nameKey,
      topN,
      fields.othersName || t("common.others")
    );

    return {
      tooltip: { trigger: "item", formatter: (p) => `${p.name}<br/>${defaultFormatter(p.value)}` },
      series: [
        {
          type: "pie",
          roseType: "radius",
          radius: ["35%", "60%"],
          center: ["50%", "50%"],
          itemStyle: {
            borderRadius: 10,
            borderColor: "#fff",
            borderWidth: 3,
          },
          label: {
            show: true,
            color: chartColors().labelSecondary,
            formatter: (p) => `${truncateLabel(p.name, 10)}  ${defaultFormatter(p.value)}`,
          },
          data: items.map((d, i) => ({
            name: d.name,
            value: d.value,
            itemStyle: { color: getThemeColor(i) },
          })),
        },
      ],
    };
  }

  static makePie(title, fields, data) {
    const nameKey = fields.category || fields.name || fields.xAxis || "name";
    const valueKey = fields.value || fields.yAxis || "value";

    const topN = clamp(toNumber(fields.topN, 12), 3, 30);
    const items = buildTopNWithOthers(
      data,
      valueKey,
      nameKey,
      topN,
      fields.othersName || t("common.others")
    );

    const donut = String(fields?.donut ?? "").toLowerCase();
    const useDonut = donut === "1" || donut === "true" || donut === "yes" || donut === "y";

    return {
      tooltip: {
        trigger: "item",
        formatter: (p) =>
          `${p.name}<br/>${workbenchContent().dashboard.chartTooltips.valueWithPercent(defaultFormatter(p.value), defaultFormatter(p.percent))}`,
      },
      series: [
        {
          type: "pie",
          radius: useDonut ? ["35%", "60%"] : "60%",
          center: ["50%", "50%"],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 10,
            borderColor: "#fff",
            borderWidth: 3,
          },
          label: {
            show: true,
            color: chartColors().labelSecondary,
            formatter: (p) => `${truncateLabel(p.name, 10)}  ${defaultFormatter(p.value)}`,
          },
          labelLine: { length: 20, length2: 10 },
          data: items.map((d, i) => ({
            name: d.name,
            value: d.value,
            itemStyle: { color: getThemeColor(i) },
          })),
        },
      ],
    };
  }

  /* ========= Liquid-fill chart (enhanced: auto-detect %, label) ========= */
  static makeLiquidFill(title, fields, data) {
    if (!data?.length) return { series: [] };
    const vRaw = data?.[0]?.[fields.value];
    let v = toNumber(vRaw, 0);
    if (v > 1) v = v / 100;
    v = clamp(v, 0, 1);

    return {
      tooltip: { show: false },
      series: [
        {
          type: "liquidFill",
          radius: "75%",
          center: ["50%", "56%"],
          outline: { show: true, borderDistance: 4 },
          label: {
            show: true,
            fontSize: 28,
            fontWeight: 700,
            formatter: () => formatPercent(v),
          },
          data: [v, v * 0.66, v * 0.33],
        },
      ],
    };
  }

  /* ========= Pictorial bar (enhanced: label / tooltip / size) ========= */
  static makePictorialBar(title, fields, data) {
    const { x, y } = guessXY(fields, data);
    if (!x || !y) return { series: [] };

    const xData = data.map((d) => d?.[x] || "");
    const yData = data.map((d) => toNumber(d?.[y], 0));

    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: mergeDeep(axisCategoryBase(xData), { data: xData }),
      yAxis: axisValueBase(),
      series: [
        {
          type: "bar",
          symbolRepeat: false,
          label: {
            show: xData.length <= 12,
            position: "top",
            formatter: (p) => defaultFormatter(p.value),
          },
          emphasis: {
            focus: "series",
            itemStyle: {
              shadowBlur: 12,
              shadowColor: `rgba(${chartColors().primaryRgb},0.35)`,
            },
          },
          itemStyle: {
            color: createBarGradient(getThemeColor(0)),
            borderRadius: [8, 8, 0, 0],
          },
          barMaxWidth: 48,
          data: yData,
        },
      ],
    };
  }

  /* ========= Scatter (enhanced: auto-detect numeric axis, tooltip) ========= */
  static makeScatter(title, fields, data) {
    const xKey = fields.xAxis || fields.x;
    const yKey = fields.yAxis || fields.y;
    if (!xKey || !yKey) return { series: [] };

    const xVals = data.map((d) => d?.[xKey]);
    const xIsNumber = xVals.every((v) => isNumberLike(v));

    const seriesData = data
      .map((d) => {
        const xv = xIsNumber ? toNumber(d?.[xKey], null) : d?.[xKey];
        const yv = toNumber(d?.[yKey], null);
        if (isNil(xv) || isNil(yv)) return null;
        return xIsNumber ? [xv, yv] : yv;
      })
      .filter(Boolean);

    return {
      tooltip: {
        trigger: "item",
        formatter: (p) => {
          if (Array.isArray(p.value)) return `${xKey}: ${p.value[0]}<br/>${yKey}: ${p.value[1]}`;
          return `${yKey}: ${p.value}`;
        },
      },
      xAxis: xIsNumber ? axisValueBase() : mergeDeep(axisCategoryBase(xVals), { data: xVals }),
      yAxis: axisValueBase(),
      series: [
        {
          type: "scatter",
          symbol: "circle",
          symbolSize: 10,
          emphasis: {
            focus: "series",
            itemStyle: {
              shadowBlur: 10,
              shadowColor: `rgba(${chartColors().primaryRgb},0.3)`,
            },
          },
          itemStyle: {
            color: getThemeColor(0),
            borderColor: "#fff",
            borderWidth: 2,
          },
          data: seriesData,
        },
      ],
    };
  }

  /* ========= Sankey (enhanced: label / tooltip) ========= */
  static makeSankey(title, fields, data) {
    const sKey = fields.source;
    const tKey = fields.target;
    const vKey = fields.value;
    if (!sKey || !tKey || !vKey) return { series: [] };

    const nodes = Array.from(
      new Set(data.flatMap((d) => [d?.[sKey], d?.[tKey]]).filter(Boolean))
    ).map((name) => ({ name }));

    return {
      tooltip: { trigger: "item" },
      series: [
        {
          type: "sankey",
          nodeAlign: "justify",
          emphasis: { focus: "adjacency" },
          label: {
            formatter: (p) => truncateLabel(p.name, 12),
            color: chartColors().labelSecondary,
          },
          data: nodes.map((node, i) => ({
            ...node,
            itemStyle: { color: getThemeColor(i) },
          })),
          links: data
            .map((d) => ({
              source: d?.[sKey],
              target: d?.[tKey],
              value: toNumber(d?.[vKey], 0),
            }))
            .filter((l) => l.source && l.target),
          lineStyle: {
            color: "gradient",
            curveness: 0.5,
            opacity: 0.6,
          },
        },
      ],
    };
  }

  /* ========= Radar (enhanced: max headroom, name truncation) ========= */
  static makeRadar(title, fields, data) {
    const cKey = fields.category || fields.name;
    const vKey = fields.value;
    if (!cKey || !vKey) return { series: [] };

    const vals = data.map((d) => toNumber(d?.[vKey], 0));
    const maxV = Math.max(1, ...vals);
    const paddedMax = Math.ceil(maxV * 1.15);

    const primaryColor = getThemeColor(0);

    return {
      tooltip: { trigger: "item" },
      radar: {
        radius: "68%",
        indicator: data.map((d) => ({
          name: truncateLabel(d?.[cKey], 10),
          max: paddedMax,
        })),
        axisName: {
          color: chartColors().labelSecondary,
        },
        splitLine: {
          lineStyle: {
            color: chartColors().radarSplitLine,
          },
        },
      },
      series: [
        {
          type: "radar",
          symbol: "circle",
          symbolSize: 6,
          areaStyle: {
            color: createAreaGradient(primaryColor),
          },
          lineStyle: {
            width: 2.5,
            color: primaryColor,
            shadowBlur: 8,
            shadowColor: primaryColor + "66",
          },
          itemStyle: {
            color: primaryColor,
            borderColor: "#fff",
            borderWidth: 2,
          },
          emphasis: {
            focus: "series",
            itemStyle: {
              shadowBlur: 10,
              shadowColor: `rgba(${chartColors().primaryRgb},0.3)`,
            },
          },
          data: [
            {
              name: String(title || vKey),
              value: vals,
            },
          ],
        },
      ],
    };
  }

  /* ========= Sunburst (enhanced: hierarchy / label / tooltip) ========= */
  static makeSunburst(title, fields, data) {
    const levels = Array.isArray(fields.levels) ? fields.levels : [];
    const vKey = fields.value;
    if (!levels.length || !vKey) return { series: [] };

    const build = (rows, lvls, valueField) => {
      const root = [];
      rows.forEach((row) => {
        let cur = root;
        lvls.forEach((lv, i) => {
          const name = row?.[lv];
          if (isNil(name)) return;
          let node = cur.find((n) => n.name === name);
          if (!node) {
            node = { name };
            if (i < lvls.length - 1) node.children = [];
            else node.value = 0;
            cur.push(node);
          }
          if (i === lvls.length - 1) node.value += toNumber(row?.[valueField], 0);
          else cur = node.children;
        });
      });
      return root;
    };

    const treeData = build(data, levels, vKey);
    const total = data.reduce((sum, row) => sum + toNumber(row?.[vKey], 0), 0);
    const leafCount = data.length;
    const innerRadius = 10;
    const outerRadius = 88;
    const ringWidth = (outerRadius - innerRadius) / levels.length;
    const nameCharsPerLine = leafCount > 28 ? 5 : leafCount > 18 ? 6 : 8;
    const maxLabelLines = leafCount > 28 ? 2 : 3;
    const hideRatio = leafCount > 30 ? 0.03 : leafCount > 20 ? 0.02 : 0.012;

    const assignColors = (nodes) => {
      if (!Array.isArray(nodes)) return;
      nodes.forEach((node, i) => {
        node.itemStyle = { color: getThemeColor(i) };
        if (Array.isArray(node.children)) {
          assignColors(node.children);
        }
      });
    };
    assignColors(treeData);

    const formatTooltip = (p) => {
      const path = (p.treePathInfo || [])
        .slice(1)
        .map((item) => item.name)
        .join(" / ");
      const value = toNumber(p.value ?? p.data?.value, 0);
      const percent =
        total > 0 ? ((value / total) * 100).toFixed(value / total < 0.01 ? 2 : 1) : "0.0";
      return `${path || p.name}<br/>${workbenchContent().dashboard.chartTooltips.valueWithShare(vKey, defaultFormatter(value), percent)}`;
    };

    const formatLabel = (p) => {
      const value = toNumber(p.value ?? p.data?.value, 0);
      const depth = Math.max((p.treePathInfo || []).length - 1, 1);
      const ratio = total > 0 ? value / total : 0;
      const isLeaf = depth >= levels.length;

      if (isLeaf && leafCount > 14 && ratio < hideRatio) return "";

      const wrappedName = wrapLabel(
        p.name,
        depth === 1 ? nameCharsPerLine : Math.max(4, nameCharsPerLine - 1),
        isLeaf ? maxLabelLines : 2
      );

      if (!wrappedName) return "";
      if (isLeaf && ratio >= 0.08) return `${wrappedName}\n${defaultFormatter(value)}`;
      return wrappedName;
    };

    return {
      tooltip: { trigger: "item", formatter: formatTooltip },
      series: [
        {
          type: "sunburst",
          nodeClick: false,
          sort: null,
          radius: [`${innerRadius}%`, `${outerRadius}%`],
          minAngle: leafCount > 24 ? 2 : 1,
          emphasis: { focus: "ancestor" },
          itemStyle: {
            borderColor: "#fff",
            borderWidth: 2,
          },
          label: {
            show: true,
            rotate: "tangential",
            minMargin: 3,
            align: "center",
            lineHeight: 12,
            fontSize: leafCount > 24 ? 10 : 11,
            overflow: "break",
            formatter: formatLabel,
          },
          labelLayout: {
            hideOverlap: true,
          },
          levels: levels.map((_, idx) => {
            const depth = idx + 1;
            const isLeaf = depth === levels.length;
            return {
              r0: `${innerRadius + ringWidth * idx}%`,
              r: `${innerRadius + ringWidth * (idx + 1)}%`,
              itemStyle: {
                borderColor: "#fff",
                borderWidth: 2,
              },
              label: {
                rotate: isLeaf ? "tangential" : "radial",
                align: "center",
              },
            };
          }),
          data: treeData,
        },
      ],
    };
  }

  /* ========= Treemap (enhanced: label / breadcrumb / tooltip) ========= */
  static makeTreeMap(title, fields, data) {
    const nKey = fields.name || fields.category;
    const vKey = fields.value;
    if (!nKey || !vKey) return { series: [] };

    const topN = clamp(toNumber(fields.topN, 20), 5, 60);
    const items = buildTopNWithOthers(
      data,
      vKey,
      nKey,
      topN,
      fields.othersName || t("common.others")
    );

    return {
      tooltip: { trigger: "item", formatter: (p) => `${p.name}<br/>${defaultFormatter(p.value)}` },
      series: [
        {
          type: "treemap",
          breadcrumb: { show: false },
          roam: false,
          nodeClick: false,
          label: {
            show: true,
            formatter: (p) => truncateLabel(p.name, 10),
            color: "#ffffff",
          },
          itemStyle: {
            gapWidth: 2,
            borderColor: "#ffffff",
            borderWidth: 1,
          },
          data: items.map((d, i) => ({
            name: d.name,
            value: d.value,
            itemStyle: { color: getThemeColor(i) },
          })),
        },
      ],
    };
  }

  /* ========= Boxplot (enhanced: more reasonable quantiles, tooltip) ========= */
  static makeBoxplot(title, fields, data) {
    const cKey = fields.category;
    const vKey = fields.value;
    if (!cKey || !vKey) return { series: [] };

    const groups = {};
    data.forEach((d) => {
      const k = d?.[cKey];
      if (isNil(k)) return;
      groups[k] ||= [];
      const v = toNumber(d?.[vKey], NaN);
      if (Number.isFinite(v)) groups[k].push(v);
    });

    const cats = Object.keys(groups);
    const quantile = (arr, p) => {
      if (!arr.length) return 0;
      const idx = (arr.length - 1) * p;
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      if (lo === hi) return arr[lo];
      return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
    };

    const box = cats.map((k) => {
      const arr = groups[k].slice().sort((a, b) => a - b);
      const q1 = quantile(arr, 0.25);
      const q2 = quantile(arr, 0.5);
      const q3 = quantile(arr, 0.75);
      return [arr[0], q1, q2, q3, arr[arr.length - 1]];
    });

    return {
      tooltip: { trigger: "item" },
      xAxis: mergeDeep(axisCategoryBase(cats), { data: cats }),
      yAxis: axisValueBase(),
      series: [{ type: "boxplot", data: box }],
    };
  }

  /* ========= Area line (enhanced: area, symbol, tooltip) ========= */
  static makeAreaLine(title, fields, data) {
    const xKey = fields.xAxis;
    const yKey = fields.yAxis;
    if (!xKey || !yKey) return { series: [] };

    const xData = data.map((d) => d?.[xKey] || "");
    const yData = data.map((d) => toNumber(d?.[yKey], 0));

    const primaryColor = getThemeColor(0);

    return {
      tooltip: { trigger: "axis" },
      xAxis: mergeDeep(axisCategoryBase(xData), { data: xData, boundaryGap: false }),
      yAxis: axisValueBase(),
      series: [
        {
          type: "line",
          name: String(title || yKey),
          smooth: true,
          symbol: "circle",
          symbolSize: 8,
          showSymbol: xData.length <= 24,
          emphasis: { focus: "series" },
          lineStyle: {
            width: 2.5,
            color: primaryColor,
            shadowBlur: 10,
            shadowColor: `rgba(${chartColors().primaryRgb},0.2)`,
          },
          itemStyle: {
            color: primaryColor,
            borderColor: "#fff",
            borderWidth: 2,
          },
          areaStyle: {
            color: createAreaGradient(primaryColor),
          },
          data: yData,
        },
      ],
    };
  }

  /* ========= Funnel (enhanced: outside label + numeric format) ========= */
  static makeFunnel(title, fields, data) {
    const nKey = fields.name;
    const vKey = fields.value;
    if (!nKey || !vKey) return { series: [] };

    const rows = data
      .map((d) => ({ name: d?.[nKey] || "", value: toNumber(d?.[vKey], 0) }))
      .sort((a, b) => b.value - a.value);

    return {
      tooltip: { trigger: "item", formatter: (p) => `${p.name}<br/>${defaultFormatter(p.value)}` },
      series: [
        {
          type: "funnel",
          left: "8%",
          top: 64,
          width: "84%",
          minSize: "15%",
          maxSize: "100%",
          sort: "descending",
          gap: 6,
          label: {
            show: true,
            position: "outside",
            formatter: (p) => `${truncateLabel(p.name, 12)}  ${defaultFormatter(p.value)}`,
            color: chartColors().labelSecondary,
          },
          labelLine: { length: 12, length2: 10 },
          itemStyle: {
            borderWidth: 1,
            borderColor: "#fff",
          },
          data: rows.map((d, i) => ({
            name: d.name,
            value: d.value,
            itemStyle: { color: getThemeColor(i) },
          })),
        },
      ],
    };
  }

  /* ========= Gauge (enhanced: progress ring + percentage display) ========= */
  static makeGauge(title, fields, data) {
    const vKey = fields.value;
    const raw = data?.[0]?.[vKey];
    let v = toNumber(raw, 0);

    const percent = v <= 1 ? v : v / 100;
    const p = clamp(percent, 0, 1);

    const primaryColor = getThemeColor(0);

    return {
      tooltip: { show: false },
      series: [
        {
          type: "gauge",
          startAngle: 90,
          endAngle: -270,
          radius: "75%",
          progress: {
            show: true,
            roundCap: true,
            width: 18,
            itemStyle: { color: primaryColor },
          },
          axisLine: {
            roundCap: true,
            lineStyle: {
              width: 18,
              color: [[1, chartColors().gaugeTrack]],
            },
          },
          axisTick: { show: false },
          splitLine: {
            length: 15,
            lineStyle: {
              width: 2,
              color: chartColors().gaugeTrack,
            },
          },
          axisLabel: { show: false },
          pointer: {
            show: false,
            itemStyle: { color: primaryColor },
          },
          anchor: {
            show: true,
            size: 12,
            itemStyle: { color: primaryColor },
          },
          detail: {
            valueAnimation: true,
            fontSize: 34,
            fontWeight: 700,
            color: chartColors().label,
            offsetCenter: [0, "70%"],
            formatter: () => formatPercent(p),
          },
          data: [{ value: p * 100, name: String(title || "") }],
        },
      ],
    };
  }
}

export default new EchartsGenerator();
