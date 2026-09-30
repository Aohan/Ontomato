const LIGHT_THEME = {
  // bgColor: "#ffffff",

  textColor: "#1F2329",
  textColorRegular: "#4E5969",

  borderColor: "#E5E6EB",
  splitLineColor: "#F0F2F5",

  tooltipBg: "rgba(17, 24, 39, 0.92)",
  tooltipBorder: "#5B3FFF",
  tooltipText: "#ffffff",

  primaryColor: "#5B3FFF",

  colors: [
    "#5B3FFF", // primary purple
    "#36CFC9", // cyan
    "#FF9F43", // orange
    "#06B6D4", // blue-cyan
    "#F56C6C", // red
    "#7C66FF", // light purple
    "#00B894", // green
    "#FFD93D", // yellow
    "#6C5CE7", // blue-purple
    "#FD79A8", // pink
  ],

  visualMapColor: ["#E8F5FF", "#7FD3FF", "#36CFC9", "#5B3FFF", "#7C66FF", "#4328D9"],
};

const DARK_THEME = {
  // bgColor: "#0F1117",

  textColor: "#F5F7FA",
  textColorRegular: "#C9CDD4",

  borderColor: "#2B2F36",
  splitLineColor: "#23262F",

  tooltipBg: "rgba(255,255,255,0.96)",
  tooltipBorder: "#5B3FFF",
  tooltipText: "#1F2329",

  primaryColor: "#7C66FF",

  colors: [
    "#7C66FF", // light purple
    "#36CFC9", // cyan
    "#FFB65C", // orange
    "#22D3EE", // blue-cyan
    "#FF7875", // red
    "#A48CFF", // lighter purple
    "#00D9B3", // green
    "#FFE168", // yellow
    "#897FFC", // blue-purple
    "#FF99C8", // pink
  ],

  visualMapColor: ["#1A2D3D", "#2D6B8C", "#36CFC9", "#7C66FF", "#A48CFF", "#D9D0FF"],
};

function wrapLabel(text, maxCharsPerLine = 6, maxLines = 2) {
  const str = String(text ?? "").trim();
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

function clampNumber(value, min, max) {
  const n = toFiniteNumber(value, min);
  return Math.min(max, Math.max(min, n));
}

function computeBarCategoryAxisLayout(categories) {
  const labels = Array.isArray(categories) ? categories : [];
  const count = Math.max(1, labels.length);
  const maxWidth = 900;
  const approxPerLabelWidth = Math.floor(maxWidth / count);
  const width = clampNumber(approxPerLabelWidth, 50, 140);
  const hasLongLabel = labels.some((v) => String(v ?? "").trim().length > 10);
  const overflow = hasLongLabel && count <= 6 ? "breakAll" : "truncate";
  const rotate = overflow === "truncate" && (count > 6 || width < 80) ? 30 : 0;
  const gridBottom = overflow === "breakAll" ? 95 : rotate ? 85 : 60;

  return {
    gridBottom,
    axisLabel: {
      interval: 0,
      width,
      overflow,
      ellipsis: "…",
      hideOverlap: true,
      rotate,
      lineHeight: 14,
      margin: 12,
    },
  };
}

function toFiniteNumber(value, fallback = 0) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isNumericChartValue(value) {
  return (
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))
  );
}

function isNumericYField(data, yField) {
  if (!Array.isArray(data) || typeof yField !== "string" || !yField.trim()) return false;
  const values = data
    .map((row) => row?.[yField])
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== "");
  return values.length > 0 && values.every(isNumericChartValue);
}

function createAreaGradient(primaryColor, isDark = false) {
  const map = {
    "#5B3FFF": ["rgba(91,63,255,0.42)", "rgba(91,63,255,0.12)", "rgba(91,63,255,0.02)"],

    "#7C66FF": ["rgba(124,102,255,0.46)", "rgba(124,102,255,0.14)", "rgba(124,102,255,0.02)"],

    "#36CFC9": ["rgba(54,207,201,0.40)", "rgba(54,207,201,0.10)", "rgba(54,207,201,0.02)"],
  };

  const colors = map[primaryColor] || [
    "rgba(91,63,255,0.42)",
    "rgba(91,63,255,0.12)",
    "rgba(91,63,255,0.02)",
  ];

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

function createBarGradient(color, isDark = false) {
  const presets = {
    "#5B3FFF": ["#a79cf7", "#5B3FFF"],
    "#7C66FF": ["#A48CFF", "#7C66FF"],
    "#36CFC9": ["#8aeae4", "#36CFC9"],
    "#FF9F43": ["#ffd294", "#FF9F43"],
    "#F56C6C": ["#FF9C9C", "#F56C6C"],
  };

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

function simplifyTimeLabel(text) {
  if (typeof text !== "string") return null;
  const s = text.trim();
  const match = s.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?)?(?:\s*(?:Z|[+-]\d{2}:\d{2}))?$/
  );
  if (!match) return null;
  const yyyy = match[1];
  const month = match[2].padStart(2, "0");
  const day = match[3].padStart(2, "0");
  const datePart = `${yyyy}-${month}-${day}`;
  const hh = match[4];
  const mm = match[5];
  const ss = match[6];
  const fractional = match[7];

  if (!hh || !mm || !ss) return datePart;

  const fractionalIsZero = !fractional || /^0+$/.test(fractional);
  const hour = hh.padStart(2, "0");
  if (hour === "00" && mm === "00" && ss === "00" && fractionalIsZero) return datePart;

  return `${datePart} ${hour}:${mm}:${ss}`;
}

function normalizeTimeText(value) {
  if (typeof value !== "string") return value;
  const simplified = simplifyTimeLabel(value);
  return simplified || value;
}

function generateBasicChartOption(chartType, title, xField, yField, seriesField, data, theme) {
  const baseOption = {
    backgroundColor: theme.bgColor,

    animation: true,
    animationDuration: 800,
    animationEasing: "cubicOut",

    title: {
      text: title,
      left: "center",
      top: 12,
      textStyle: {
        color: theme.textColor,
        fontSize: 16,
        fontWeight: 600,
      },
    },

    tooltip: {
      trigger: chartType === "pie" ? "item" : "axis",
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      borderWidth: 1,
      padding: 12,
      extraCssText: `
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      backdrop-filter: blur(8px);
    `,
      textStyle: {
        color: theme.tooltipText,
        fontSize: 12,
      },
    },

    legend: {
      top: 36,
      textStyle: {
        color: theme.textColorRegular,
        fontSize: 12,
      },
    },

    grid: {
      left: 24,
      right: 24,
      bottom: 32,
      top: title ? 72 : 24,
      containLabel: true,
    },

    xAxis: {
      type: "category",

      axisLine: {
        lineStyle: {
          color: theme.borderColor,
        },
      },

      axisTick: {
        show: false,
      },

      axisLabel: {
        color: theme.textColorRegular,
        fontSize: 12,
      },
    },

    yAxis: {
      type: "value",

      axisLine: {
        show: false,
      },

      axisTick: {
        show: false,
      },

      axisLabel: {
        color: theme.textColorRegular,
        fontSize: 12,
      },

      splitLine: {
        lineStyle: {
          color: theme.splitLineColor,
          type: "dashed",
        },
      },
    },
  };

  if (chartType === "pie") {
    return {
      ...baseOption,
      legend: { ...baseOption.legend, orient: "horizontal", left: "center", bottom: 20 },
      series: [
        {
          type: "pie",
          radius: ["35%", "60%"],
          center: ["50%", "50%"],
          itemStyle: {
            borderRadius: 10,
            borderColor: theme.bgColor,
            borderWidth: 3,
          },
          roseType: "radius",
          label: { show: true, color: theme.textColorRegular },
          data: data.map((d, i) => ({
            name: d[xField] ?? "",
            value: d[yField] ?? 0,
            itemStyle: { color: theme.colors[i % theme.colors.length] },
          })),
        },
      ],
    };
  }

  if (chartType === "area") {
    return {
      ...baseOption,
      xAxis: {
        ...baseOption.xAxis,
        data: data.map((d) => d?.[xField] ?? ""),
        axisLabel: { ...baseOption.xAxis.axisLabel, rotate: data.length > 6 ? 25 : 0 },
      },
      series: [
        {
          type: "line",
          data: data.map((d) => d[yField] ?? 0),
          smooth: true,
          symbol: "circle",
          symbolSize: 8,
          showSymbol: true,
          animationDuration: 1200,
          animationEasing: "cubicOut",
          lineStyle: {
            width: 4,
            color: theme.primaryColor,
            shadowBlur: 12,
            shadowColor:
              theme.bgColor === "#ffffff" ? "rgba(91,63,255,0.25)" : "rgba(91,63,255,0.5)",
          },
          areaStyle: {
            color: createAreaGradient(theme.primaryColor),
          },
          itemStyle: {
            color: theme.primaryColor,
            borderColor: theme.bgColor,
            borderWidth: 2,
          },
        },
      ],
    };
  }

  const normalizedSeriesField = typeof seriesField === "string" ? seriesField.trim() : "";
  if (normalizedSeriesField && (chartType === "bar" || chartType === "line")) {
    const rawCategories = [...new Set(data.map((d) => d?.[xField] ?? ""))];
    const series = [...new Set(data.map((d) => d?.[normalizedSeriesField]))].filter(
      (value) => value !== undefined && value !== null && String(value).trim() !== ""
    );
    const hasMultiSeriesPerCategory = rawCategories.some((cat) => {
      const categorySeries = new Set(
        data
          .filter((d) => d?.[xField] === cat)
          .map((d) => d?.[normalizedSeriesField])
          .filter((value) => value !== undefined && value !== null && String(value).trim() !== "")
      );
      return categorySeries.size > 1;
    });

    if (normalizedSeriesField !== xField && series.length > 1 && hasMultiSeriesPerCategory) {
      const barLayout = chartType === "bar" ? computeBarCategoryAxisLayout(rawCategories) : null;
      return {
        ...baseOption,
        legend: { ...baseOption.legend, orient: "horizontal", left: "center", bottom: 15 },
        grid: { ...baseOption.grid, bottom: barLayout?.gridBottom ?? 60 },
        xAxis: {
          ...baseOption.xAxis,
          data: rawCategories,
          axisLabel: {
            ...baseOption.xAxis.axisLabel,
            ...(barLayout?.axisLabel ?? {}),
            rotate:
              chartType === "bar"
                ? (barLayout?.axisLabel?.rotate ?? 0)
                : rawCategories.length > 6
                  ? 25
                  : 0,
          },
        },
        series: series.map((s, i) => {
          const color = theme.colors[i % theme.colors.length];

          return {
            name: s,

            type: chartType === "line" ? "line" : "bar",

            data: rawCategories.map((cat) => {
              const item = data.find(
                (d) => d?.[xField] === cat && d?.[normalizedSeriesField] === s
              );
              return item ? item[yField] : 0;
            }),

            smooth: chartType === "line",

            areaStyle:
              chartType === "line"
                ? {
                    color: createAreaGradient(color),
                  }
                : undefined,

            lineStyle:
              chartType === "line"
                ? {
                    width: 3,
                    color,
                    shadowBlur: 10,
                    shadowColor: color + "66",
                  }
                : undefined,

            itemStyle: {
              color: chartType === "bar" ? createBarGradient(color) : color,

              borderRadius: chartType === "bar" ? [6, 6, 0, 0] : undefined,
            },
          };
        }),
      };
    }
  }

  const chartTypeToSeriesType = { bar: "bar", line: "line", scatter: "scatter" };
  const finalChartType = chartTypeToSeriesType[chartType] || "bar";
  const xAxisDataRaw = data.map((d) => d?.[xField] ?? "");
  const barLayout = finalChartType === "bar" ? computeBarCategoryAxisLayout(xAxisDataRaw) : null;
  return {
    ...baseOption,
    grid:
      finalChartType === "bar"
        ? { ...baseOption.grid, bottom: barLayout?.gridBottom ?? 60 }
        : baseOption.grid,
    xAxis: {
      ...baseOption.xAxis,
      data: xAxisDataRaw,
      axisLabel: {
        ...baseOption.xAxis.axisLabel,
        ...(barLayout?.axisLabel ?? {}),
        rotate:
          finalChartType === "bar" ? (barLayout?.axisLabel?.rotate ?? 0) : data.length > 6 ? 25 : 0,
      },
    },
    series: [
      {
        type: finalChartType,
        data: data.map((d) => d[yField] ?? 0),
        barMaxWidth: 48,
        smooth: finalChartType === "line",
        itemStyle: {
          color: createBarGradient(theme.primaryColor),

          borderRadius: [8, 8, 0, 0],
        },

        emphasis: {
          itemStyle: {
            shadowBlur: 12,
            shadowColor: "rgba(91,63,255,0.35)",
          },
        },

        areaStyle:
          finalChartType === "line"
            ? {
                color: createAreaGradient(theme.primaryColor),
              }
            : undefined,

        lineStyle:
          finalChartType === "line"
            ? {
                width: 3,
                color: theme.primaryColor,

                shadowBlur: 12,

                shadowColor:
                  theme.bgColor === "#ffffff" ? "rgba(91,63,255,0.25)" : "rgba(91,63,255,0.45)",
              }
            : undefined,
      },
    ],
  };
}

function generateRadarOption(data, title, theme, indicatorsInput, seriesField, xField, yField) {
  const baseOption = {
    backgroundColor: theme.bgColor,
    title: {
      text: title,
      left: "center",
      top: 10,
      textStyle: { color: theme.textColor, fontSize: 16 },
    },
    tooltip: {
      trigger: "item",
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      textStyle: { color: theme.tooltipText },
    },
  };

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return {
        ...baseOption,
        series: [],
      };
    }

    const rows = data.filter((row) => row && typeof row === "object");
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];

    let indicators = Array.isArray(indicatorsInput) ? indicatorsInput : [];

    const buildMax = (name) => {
      let max = 0;
      for (const r of rows) {
        const v = r?.[name];
        const n = typeof v === "number" && Number.isFinite(v) ? v : Number(v);
        if (Number.isFinite(n)) max = Math.max(max, n);
      }
      const padded = max > 0 ? Math.ceil(max * 1.1) : 1;
      return padded;
    };

    const isValidCategory = (value) =>
      value !== undefined && value !== null && String(value).trim() !== "";
    const toFiniteNumber = (value) => {
      const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const rowHasStringValue = (items, key) =>
      items.some((row) => typeof row?.[key] === "string" && row[key].trim() !== "");

    const numericKeys = keys.filter((key) =>
      rows.some((row) => toFiniteNumber(row?.[key]) !== null)
    );

    const shouldUseSimpleXYMode =
      xField &&
      yField &&
      numericKeys.includes(yField) &&
      (!indicators.length || indicators.every((indicator) => indicator?.name === undefined));

    if (shouldUseSimpleXYMode) {
      const validRows = rows.filter(
        (row) => isValidCategory(row?.[xField]) && toFiniteNumber(row?.[yField]) !== null
      );

      if (validRows.length > 0) {
        const maxValue = validRows.reduce(
          (max, row) => Math.max(max, toFiniteNumber(row?.[yField]) ?? 0),
          0
        );
        const axisMax = maxValue > 0 ? Math.ceil(maxValue * 1.1) : 1;

        return {
          ...baseOption,
          radar: {
            indicator: validRows.map((row) => ({
              name: String(row[xField]),
              max: axisMax,
            })),
            axisName: { color: theme.textColorRegular },
            splitLine: { lineStyle: { color: theme.splitLineColor } },
          },
          series: [
            {
              type: "radar",
              data: [
                {
                  name: yField || title || "Value",
                  value: validRows.map((row) => toFiniteNumber(row?.[yField]) ?? 0),
                  areaStyle: { color: theme.colors[0] + "40" },
                  lineStyle: { color: theme.colors[0] },
                  itemStyle: { color: theme.colors[0] },
                },
              ],
            },
          ],
        };
      }
    }

    const categoryField =
      seriesField ||
      keys.find((key) => rowHasStringValue(rows, key)) ||
      keys.find((key) => key === "name") ||
      "";

    if (indicators.length === 0) {
      const metricKeys = numericKeys.filter((key) => key !== categoryField);
      indicators = metricKeys.map((field) => ({ field, name: field, max: buildMax(field) }));
    } else {
      indicators = indicators.map((ind) => ({
        field: ind?.field ?? ind?.name,
        name: ind?.name ?? ind?.field,
        max:
          typeof ind?.max === "number" && Number.isFinite(ind.max)
            ? ind.max
            : buildMax(ind?.field ?? ind?.name),
      }));
    }

    const indicatorFields = indicators.map((i) => i.field ?? i.name).filter(Boolean);
    const values = rows
      .filter((row) => !categoryField || isValidCategory(row?.[categoryField]))
      .map((r) => {
        const name = categoryField ? r?.[categoryField] : undefined;
        return {
          name: name === undefined || name === null ? "" : String(name),
          value: indicatorFields.map((field) => toFiniteNumber(r?.[field]) ?? 0),
        };
      });

    return {
      ...baseOption,
      radar: {
        indicator: indicators,
        axisName: { color: theme.textColorRegular },
        splitLine: { lineStyle: { color: theme.splitLineColor } },
      },
      series: [
        {
          type: "radar",
          data: values.map((v, i) => ({
            name: v.name,
            value: v.value,
            areaStyle: { color: theme.colors[i % theme.colors.length] + "40" },
            lineStyle: { color: theme.colors[i % theme.colors.length] },
            itemStyle: { color: theme.colors[i % theme.colors.length] },
          })),
        },
      ],
    };
  }

  const indicators = data?.indicators || (Array.isArray(indicatorsInput) ? indicatorsInput : []);
  const values = data?.values || [];
  return {
    ...baseOption,
    radar: {
      indicator: indicators,
      axisName: { color: theme.textColorRegular },
      splitLine: { lineStyle: { color: theme.splitLineColor } },
    },
    series: [
      {
        type: "radar",
        data: values.map((v, i) => ({
          name: v.name,
          value: v.value,
          areaStyle: { color: theme.colors[i % theme.colors.length] + "40" },
          lineStyle: { color: theme.colors[i % theme.colors.length] },
          itemStyle: { color: theme.colors[i % theme.colors.length] },
        })),
      },
    ],
  };
}

function validateRadarInput(data, indicatorsInput) {
  if (!Array.isArray(data)) return null;

  const rows = data.filter((row) => row && typeof row === "object" && !Array.isArray(row));
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const toFiniteNumber = (value) => {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const indicatorFields = Array.isArray(indicatorsInput)
    ? indicatorsInput.map((indicator) => indicator?.field ?? indicator?.name)
    : keys.filter((key) => rows.some((row) => toFiniteNumber(row?.[key]) !== null));
  const missingFields = indicatorFields.filter(
    (field) => typeof field !== "string" || !field.trim() || !keys.includes(field)
  );
  if (missingFields.length > 0) {
    return {
      reason: "radar_indicator_field_not_found",
      message: `Invalid radar indicators: fields do not exist (${missingFields.join(", ")})`,
      details: { missingFields },
    };
  }

  if (
    !rows.some((row) => indicatorFields.some((field) => toFiniteNumber(row?.[field]) !== null))
  ) {
    return {
      reason: "radar_no_numeric_indicator_values",
      message: "Invalid radar data: no indicator value can be converted to a finite number",
    };
  }

  return null;
}

function generateGaugeOption(data, title, theme) {
  const value = data.value || 0;
  const max = data.max || 100;
  const name = data.name || "Metric";
  return {
    backgroundColor: theme.bgColor,
    title: {
      text: title,
      left: "center",
      top: 10,
      textStyle: { color: theme.textColor, fontSize: 16 },
    },
    series: [
      {
        type: "gauge",
        center: ["50%", "60%"],
        radius: "70%",
        min: 0,
        max,
        progress: {
          show: true,
          width: 18,
          roundCap: true,
        },
        axisLine: { lineStyle: { width: 18, color: [[1, theme.splitLineColor]] } },
        axisTick: { show: false },
        splitLine: { length: 15, lineStyle: { width: 2, color: theme.borderColor } },
        axisLabel: { distance: 25, color: theme.textColorRegular },
        pointer: {
          itemStyle: {
            color: theme.primaryColor,
          },
        },
        anchor: {
          show: true,
          size: 12,
          itemStyle: {
            color: theme.primaryColor,
          },
        },
        detail: {
          valueAnimation: true,
          formatter: "{value}",
          color: theme.textColor,
          fontSize: 24,
          offsetCenter: [0, "70%"],
        },
        data: [{ value, name }],
      },
    ],
  };
}

function generateHeatmapOption(data, title, theme, xField, yField) {
  let xAxisData = data.xAxis || [];
  let yAxisData = data.yAxis || [];
  let seriesData = data.data || [];
  if (
    Array.isArray(data) &&
    data.length > 0 &&
    data[0].x !== undefined &&
    data[0].y !== undefined &&
    data[0].value !== undefined
  ) {
    xAxisData = [...new Set(data.map((item) => item[xField || "x"]))];
    yAxisData = [...new Set(data.map((item) => item[yField || "y"]))];
    const xIndexMap = new Map(xAxisData.map((label, idx) => [label, idx]));
    const yIndexMap = new Map(yAxisData.map((label, idx) => [label, idx]));
    seriesData = data.map((item) => [
      xIndexMap.get(item[xField || "x"]),
      yIndexMap.get(item[yField || "y"]),
      item.value,
    ]);
  }
  xAxisData = xAxisData.map(normalizeTimeText);
  yAxisData = yAxisData.map(normalizeTimeText);
  return {
    backgroundColor: theme.bgColor,
    title: {
      text: title,
      left: "center",
      top: 10,
      textStyle: { color: theme.textColor, fontSize: 16 },
    },
    tooltip: {
      position: "top",
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      textStyle: { color: theme.tooltipText },
    },
    grid: { top: 60, right: 50, bottom: 60, left: 60 },
    xAxis: {
      type: "category",
      data: xAxisData,
      splitArea: { show: true },
      axisLine: { lineStyle: { color: theme.borderColor } },
      axisLabel: {
        color: theme.textColorRegular,
      },
    },
    yAxis: {
      type: "category",
      data: yAxisData,
      splitArea: { show: true },
      axisLine: { lineStyle: { color: theme.borderColor } },
      axisLabel: {
        color: theme.textColorRegular,
      },
    },
    visualMap: {
      min: Math.min(...seriesData.map((d) => d[2])),
      max: Math.max(...seriesData.map((d) => d[2])),
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 10,
      inRange: {
        color: theme.visualMapColor,
      },
      textStyle: { color: theme.textColorRegular },
    },
    series: [{ type: "heatmap", data: seriesData, label: { show: false } }],
  };
}

function generateFunnelOption(data, title, theme, xField, yField) {
  const funnelData = data.map((d, i) => ({
    name: d[xField] ?? "",
    value: d[yField] ?? 0,
    itemStyle: { color: theme.colors[i % theme.colors.length] },
  }));
  return {
    backgroundColor: theme.bgColor,
    title: {
      text: title,
      left: "center",
      top: 10,
      textStyle: { color: theme.textColor, fontSize: 16 },
    },
    tooltip: {
      trigger: "item",
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      textStyle: { color: theme.tooltipText },
    },
    series: [
      {
        type: "funnel",
        left: "10%",
        width: "80%",
        minSize: "0%",
        maxSize: "100%",
        sort: "descending",
        gap: 2,
        label: { show: true, position: "inside", color: theme.textColor },
        itemStyle: { borderColor: theme.bgColor, borderWidth: 1 },
        data: funnelData,
      },
    ],
  };
}

function buildTreeData(data, theme, xField = "name", yField = "value") {
  if (Array.isArray(data.children)) {
    return data.children.map((child, i) => ({
      name: child.name ?? child[xField] ?? "",
      value: child.value ?? child[yField] ?? 0,
      children: child.children ? buildTreeData(child, theme, xField, yField) : undefined,
      itemStyle: { color: theme.colors[i % theme.colors.length] },
    }));
  }
  if (Array.isArray(data)) {
    return data.map((item, i) => ({
      name: item.name ?? item[xField] ?? "",
      value: item.value ?? item[yField] ?? 0,
      children: item.children ? buildTreeData(item, theme, xField, yField) : undefined,
      itemStyle: { color: theme.colors[i % theme.colors.length] },
    }));
  }
  return [];
}

function generateTreemapOption(data, title, theme, xField, yField) {
  const treeData = buildTreeData(data, theme, xField, yField);
  const treemapTextColor = "#ffffff";
  return {
    backgroundColor: theme.bgColor,
    title: {
      text: title,
      left: "center",
      top: 10,
      textStyle: { color: treemapTextColor, fontSize: 16 },
    },
    tooltip: {
      trigger: "item",
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      textStyle: { color: theme.tooltipText },
    },
    series: [
      {
        type: "treemap",
        width: "90%",
        height: "80%",
        top: "10%",
        roam: false,
        breadcrumb: {
          show: true,
          itemStyle: { color: theme.colors[0], borderColor: theme.borderColor },
          textStyle: { color: treemapTextColor },
        },
        label: { show: true, formatter: "{b}", color: treemapTextColor },
        upperLabel: { show: true, color: treemapTextColor },
        itemStyle: { borderColor: theme.borderColor, borderWidth: 1, gapWidth: 1 },
        data: treeData,
      },
    ],
  };
}

function generateSunburstOption(data, title, theme, xField, yField) {
  const treeData = buildTreeData(data, theme, xField, yField);
  const total = (function sumTree(nodes) {
    if (!Array.isArray(nodes)) return 0;
    return nodes.reduce((sum, node) => {
      const selfValue = toFiniteNumber(node?.value, 0);
      const childValue = sumTree(node?.children);
      return sum + Math.max(selfValue, childValue);
    }, 0);
  })(treeData);
  const leafCount = (function countLeaves(nodes) {
    if (!Array.isArray(nodes)) return 0;
    return nodes.reduce((sum, node) => {
      if (Array.isArray(node?.children) && node.children.length > 0) {
        return sum + countLeaves(node.children);
      }
      return sum + 1;
    }, 0);
  })(treeData);
  const maxDepth = (function getDepth(nodes, depth = 1) {
    if (!Array.isArray(nodes) || nodes.length === 0) return depth - 1;
    return nodes.reduce((max, node) => {
      const childDepth =
        Array.isArray(node?.children) && node.children.length > 0
          ? getDepth(node.children, depth + 1)
          : depth;
      return Math.max(max, childDepth);
    }, depth);
  })(treeData);
  const innerRadius = 10;
  const outerRadius = 88;
  const safeDepth = Math.max(1, maxDepth);
  const ringWidth = (outerRadius - innerRadius) / safeDepth;
  const nameCharsPerLine = leafCount > 28 ? 5 : leafCount > 18 ? 6 : 8;
  const maxLabelLines = leafCount > 28 ? 2 : 3;
  const hideRatio = leafCount > 30 ? 0.03 : leafCount > 20 ? 0.02 : 0.012;

  return {
    backgroundColor: theme.bgColor,
    title: {
      text: title,
      left: "center",
      top: 10,
      textStyle: { color: theme.textColor, fontSize: 16 },
    },
    tooltip: {
      trigger: "item",
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      textStyle: { color: theme.tooltipText },
      formatter: (params) => {
        const path = (params.treePathInfo || [])
          .slice(1)
          .map((item) => item.name)
          .join(" / ");
        const value = toFiniteNumber(params.value ?? params.data?.value, 0);
        const percent =
          total > 0 ? ((value / total) * 100).toFixed(value / total < 0.01 ? 2 : 1) : "0.0";
        const valueLabel = yField || "value";
        return `${path || params.name}<br/>${valueLabel}: ${value}<br/>Share: ${percent}%`;
      },
    },
    series: [
      {
        type: "sunburst",
        data: treeData,
        radius: [`${innerRadius}%`, `${outerRadius}%`],
        nodeClick: false,
        sort: null,
        minAngle: leafCount > 24 ? 2 : 1,
        emphasis: { focus: "ancestor" },
        label: {
          show: true,
          color: theme.textColor,
          rotate: "tangential",
          minMargin: 3,
          align: "center",
          lineHeight: 12,
          fontSize: leafCount > 24 ? 10 : 11,
          overflow: "break",
          formatter: (params) => {
            const value = toFiniteNumber(params.value ?? params.data?.value, 0);
            const depth = Math.max((params.treePathInfo || []).length - 1, 1);
            const ratio = total > 0 ? value / total : 0;
            const isLeaf =
              !Array.isArray(params.data?.children) || params.data.children.length === 0;

            if (isLeaf && leafCount > 14 && ratio < hideRatio) return "";

            const wrappedName = wrapLabel(
              params.name,
              depth === 1 ? nameCharsPerLine : Math.max(4, nameCharsPerLine - 1),
              isLeaf ? maxLabelLines : 2
            );

            if (!wrappedName) return "";
            if (isLeaf && ratio >= 0.08) return `${wrappedName}\n${value}`;
            return wrappedName;
          },
        },
        labelLayout: {
          hideOverlap: true,
        },
        itemStyle: { borderRadius: 7, borderColor: theme.bgColor, borderWidth: 2 },
        levels: Array.from({ length: safeDepth }, (_, idx) => {
          const depth = idx + 1;
          const isLeafLevel = depth === safeDepth;
          return {
            r0: `${innerRadius + ringWidth * idx}%`,
            r: `${innerRadius + ringWidth * (idx + 1)}%`,
            itemStyle: {
              borderColor: theme.bgColor,
              borderWidth: 2,
            },
            label: {
              color: theme.textColor,
              rotate: isLeafLevel ? "tangential" : "radial",
              align: "center",
            },
          };
        }),
      },
    ],
  };
}

function generateSankeyOption(data, title, theme) {
  const rawNodes = Array.isArray(data?.nodes) ? data.nodes : [];
  const rawLinks = Array.isArray(data) ? data : Array.isArray(data?.links) ? data.links : [];

  const formattedLinks = rawLinks
    .map((link) => {
      const source = link?.source ?? link?.from ?? link?.src;
      const target = link?.target ?? link?.to ?? link?.dst;
      const value = link?.value ?? link?.count ?? link?.weight ?? 1;
      return {
        source: source === undefined || source === null ? "" : String(source),
        target: target === undefined || target === null ? "" : String(target),
        value: typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 1,
      };
    })
    .filter((l) => l.source && l.target);

  const nodeNameSet = new Set();
  for (const l of formattedLinks) {
    nodeNameSet.add(l.source);
    nodeNameSet.add(l.target);
  }

  const formattedNodes = [];
  const addNode = (name) => {
    if (!name) return;
    if (nodeNameSet.has(name)) {
      formattedNodes.push(name);
      nodeNameSet.delete(name);
    }
  };

  for (const node of rawNodes) {
    const name = node?.name ?? node;
    addNode(name === undefined || name === null ? "" : String(name));
  }

  for (const name of Array.from(nodeNameSet)) {
    formattedNodes.push(name);
  }

  const nodeObjects = formattedNodes.map((name, i) => ({
    name,
    itemStyle: { color: theme.colors[i % theme.colors.length] },
  }));

  return {
    backgroundColor: theme.bgColor,
    title: {
      text: title,
      left: "center",
      top: 10,
      textStyle: { color: theme.textColor, fontSize: 16 },
    },
    tooltip: {
      trigger: "item",
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      textStyle: { color: theme.tooltipText },
    },
    series: [
      {
        type: "sankey",
        layout: "none",
        emphasis: { focus: "adjacency" },
        data: nodeObjects,
        links: formattedLinks,
        lineStyle: { color: "gradient", curveness: 0.5, opacity: 0.6 },
        label: { color: theme.textColor, fontSize: 12 },
      },
    ],
  };
}

function renderEcharts(data, config, theme) {
  const { chartType, title, xField, yField, seriesField, indicators } = config;
  const renderers = {
    bar: () => generateBasicChartOption("bar", title, xField, yField, seriesField, data, theme),
    line: () => generateBasicChartOption("line", title, xField, yField, seriesField, data, theme),
    pie: () => generateBasicChartOption("pie", title, xField, yField, seriesField, data, theme),
    scatter: () =>
      generateBasicChartOption("scatter", title, xField, yField, seriesField, data, theme),
    area: () => generateBasicChartOption("area", title, xField, yField, seriesField, data, theme),
    radar: () => generateRadarOption(data, title, theme, indicators, seriesField, xField, yField),
    gauge: () => generateGaugeOption(data, title, theme),
    heatmap: () => generateHeatmapOption(data, title, theme, xField, yField),
    funnel: () => generateFunnelOption(data, title, theme, xField, yField),
    treemap: () => generateTreemapOption(data, title, theme, xField, yField),
    sunburst: () => generateSunburstOption(data, title, theme, xField, yField),
    sankey: () => generateSankeyOption(data, title, theme),
  };
  const renderer = renderers[chartType];
  if (!renderer) throw new Error(`Unsupported chart type: ${chartType}`);
  return renderer();
}

function generateHTML(lightOption, darkOption) {
  const lightOptionJson = JSON.stringify(lightOption, null, 2);
  const darkOptionJson = JSON.stringify(darkOption, null, 2);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="/api/echart/echarts.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root { --bg-color: color-mix(in srgb, #FFFFFF 30%, #F4F7FE 70%); --text-color: #303133; --border-color: #DCDFE6; }
    @media (prefers-color-scheme: dark) { :root { --bg-color: color-mix(in srgb, #111322 30%, #0A0B16 70%);--text-color: #E5EAF3; --border-color: #4C4D4F; } }
    html.dark { --bg-color: color-mix(in srgb, #111322 30%, #0A0B16 70%); --text-color: #E5EAF3; --border-color: #4C4D4F; }
    body {
  font-family:
    Inter,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    sans-serif;

  background-color: var(--bg-color);

  display: flex;
  justify-content: center;
  align-items: center;

  margin: 0;
  padding: 0;

  overflow: hidden;
}
   .chart-container {
  width: 100%;
  height: 100vh;
  max-width: 1000px;

  background:
    radial-gradient(circle at top left, rgba(91,63,255,0.08), transparent 30%),
    radial-gradient(circle at top right, rgba(54,207,201,0.06), transparent 28%),
    var(--card-bg);

  display: flex;
  align-items: center;
  justify-content: center;
}
    #chart { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div class="chart-container"><div id="chart"></div></div>
  <script>
    const chartDom = document.getElementById('chart');
    const chart = echarts.init(chartDom, null, {
  renderer: "canvas",
  useDirtyRect: true,
});
    function getIsDark() {
      try { if (parent && parent.document && parent.document.documentElement) return parent.document.documentElement.classList.contains('dark'); } catch (e) {}
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    const lightOption = ${lightOptionJson};
    const darkOption = ${darkOptionJson};
    chart.setOption(getIsDark() ? darkOption : lightOption);
    chart.resize({
  animation: {
    duration: 300,
  },
});
    try { if (parent && parent.document) { new MutationObserver(() => chart.setOption(getIsDark() ? darkOption : lightOption, true)).observe(parent.document.documentElement, { attributes: true, attributeFilter: ['class'] }); } } catch (e) {}
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => { if (!parent || !parent.document) chart.setOption(e.matches ? darkOption : lightOption, true); });
    window.addEventListener('resize', () => chart.resize());
  </script>
</body>
</html>`;
}

export async function execute(input) {
  const {
    data,
    chartType,
    xField,
    yField,
    title,
    seriesField,
    sortBy,
    sortOrder,
    topN,
    indicators,
    excludeCategoryValues: requestedExcludedCategoryValues = [],
  } = input;

  if (!chartType || !title) {
    return {
      html: "<div style='padding:20px;text-align:center;color:#666;'>Missing required parameters: chartType, title</div>",
      meta: { error: true, missingParams: { chartType, title } },
    };
  }

  if (!["sankey", "radar", "gauge"].includes(chartType) && (!xField || !yField)) {
    return {
      html: "<div style='padding:20px;text-align:center;color:#666;'>Missing required parameters: xField, yField</div>",
      meta: { error: true, missingParams: { xField, yField } },
    };
  }

  let processedData = data;
  const configuredSankeyLinks = Array.isArray(input?.links) ? input.links : null;
  const configuredSankeyNodes = Array.isArray(input?.nodes) ? input.nodes : [];

  if (chartType === "sankey" && configuredSankeyLinks) {
    processedData = { nodes: configuredSankeyNodes, links: configuredSankeyLinks };
  }
  let excludedCategoryRows = 0;
  let excludedCategoryValues = [];
  const isArrayData = Array.isArray(data);
  const isObjectData = !!data && typeof data === "object" && !Array.isArray(data);

  if (chartType === "gauge") {
    if (!isObjectData) {
      return {
        html: "<div style='padding:20px;text-align:center;color:#666;'>Data format error: gauge requires object data</div>",
        meta: { error: true },
      };
    }
  } else if (chartType === "radar") {
    if (!isArrayData && !isObjectData) {
      return {
        html: "<div style='padding:20px;text-align:center;color:#666;'>Data format error: radar requires array or object data</div>",
        meta: { error: true },
      };
    }
    if (isArrayData && data.length === 0) {
      return {
        html: "<div style='padding:20px;text-align:center;color:#666;'>Data is empty</div>",
        meta: { error: true },
      };
    }
    const radarValidationError = validateRadarInput(data, indicators);
    if (radarValidationError) {
      return {
        html: `<div style='padding:20px;text-align:center;color:#666;'>${radarValidationError.message}</div>`,
        meta: { error: true, ...radarValidationError },
      };
    }
  } else if (chartType === "sankey") {
    if (!isArrayData && !isObjectData) {
      return {
        html: "<div style='padding:20px;text-align:center;color:#666;'>Data format error: sankey requires a links array or a {nodes, links} object</div>",
        meta: { error: true },
      };
    }
    if (isArrayData && data.length === 0) {
      return {
        html: "<div style='padding:20px;text-align:center;color:#666;'>Data is empty</div>",
        meta: { error: true },
      };
    }

    const sankeyLinks = Array.isArray(processedData)
      ? processedData
      : Array.isArray(processedData?.links)
        ? processedData.links
        : [];
    // Extract and validate the source and target nodes of sankey links, filtering invalid links
    const validSankeyLinks = sankeyLinks.filter((link) => {
      const source = link?.source ?? link?.from ?? link?.src;
      const target = link?.target ?? link?.to ?? link?.dst;
      return [source, target].every((val) => {
        return val != null && String(val).trim() !== "";
      });
    });

    if (validSankeyLinks.length === 0) {
      return {
        html: "<div style='padding:20px;text-align:center;color:#666;'>Data format error: sankey requires at least one valid link with source and target</div>",
        meta: { error: true, reason: "no_valid_sankey_links" },
      };
    }
  } else {
    if (!isArrayData || data.length === 0) {
      return {
        html: "<div style='padding:20px;text-align:center;color:#666;'>Data is empty</div>",
        meta: { error: true },
      };
    }
    processedData = [...data];
  }

  if (
    !["sankey", "radar", "gauge", "heatmap"].includes(chartType) &&
    !isNumericYField(processedData, yField)
  ) {
    return {
      html: "<div style='padding:20px;text-align:center;color:#666;'>Invalid yField: a numeric measure is required</div>",
      meta: { error: true, reason: "non_numeric_y_field", yField },
    };
  }

  if (isArrayData && !["sankey", "radar", "gauge"].includes(chartType)) {
    if (
      xField &&
      Array.isArray(requestedExcludedCategoryValues) &&
      requestedExcludedCategoryValues.length > 0
    ) {
      const excludedValueSet = new Set(requestedExcludedCategoryValues);
      const matchedValueSet = new Set();
      processedData = processedData.filter((row) => {
        const categoryValue = row?.[xField];
        if (!excludedValueSet.has(categoryValue)) return true;

        excludedCategoryRows += 1;
        matchedValueSet.add(categoryValue);
        return false;
      });
      excludedCategoryValues = [...matchedValueSet];
    }

    if (sortBy === "yField" && yField) {
      processedData.sort((a, b) =>
        sortOrder === "asc"
          ? (a[yField] || 0) - (b[yField] || 0)
          : (b[yField] || 0) - (a[yField] || 0)
      );
    }
    if (sortBy === "xField" && xField) {
      processedData.sort((a, b) =>
        sortOrder === "asc"
          ? String(a[xField] || "").localeCompare(String(b[xField] || ""))
          : String(b[xField] || "").localeCompare(String(a[xField] || ""))
      );
    }
    if (topN && processedData.length > topN) {
      processedData = processedData.slice(0, topN);
    }
  }

  if (!["sankey", "radar", "gauge"].includes(chartType)) {
    if (Array.isArray(processedData) && xField) {
      processedData = processedData.map((row) => {
        if (!row || typeof row !== "object") return row;
        const rawX = row[xField];
        if (typeof rawX !== "string") return row;
        const nextX = normalizeTimeText(rawX);
        if (nextX === rawX) return row;
        return { ...row, [xField]: nextX };
      });
    }

    if (chartType === "heatmap" && Array.isArray(processedData) && yField) {
      processedData = processedData.map((row) => {
        if (!row || typeof row !== "object") return row;
        const rawY = row[yField];
        if (typeof rawY !== "string") return row;
        const nextY = normalizeTimeText(rawY);
        if (nextY === rawY) return row;
        return { ...row, [yField]: nextY };
      });
    }
  }

  const config = { chartType, title, xField, yField, seriesField, indicators };

  const lightOption = renderEcharts(processedData, config, LIGHT_THEME);
  const darkOption = renderEcharts(processedData, config, DARK_THEME);
  const html = generateHTML(lightOption, darkOption);

  console.log(`[echarts] chartType=${chartType}, x=${xField}, y=${yField}, title=${title}`);

  return {
    html,
    meta: {
      skillId: "echarts",
      chartType,
      title,
      dataRows: Array.isArray(processedData)
        ? processedData.length
        : processedData?.links?.length || 0,
      originalRows: Array.isArray(data) ? data.length : data?.links?.length || 0,
      excludedCategoryRows,
      excludedCategoryValues,
    },
  };
}
