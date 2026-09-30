import type { AnalysisChartResult } from "@ontomato/contracts/analysis-charts";
import { createLogger } from "../../../logging/logger";
import { tApp } from "../../../i18n";


const logger = createLogger("chart-marker");

export type ChartMarkerScope = "dimension" | "summary";

export interface ChartMarkerReference {
  scope: ChartMarkerScope;
  chartId: string;
}

interface ReplaceChartMarkersOptions {
  onUnmatched?: (markers: ChartMarkerReference[]) => void;
}

const CHART_MARKER_LINE_REGEX =
  /^[ \t]*(?:>[ \t]*)?`?\[chart:(dimension|summary):([^\]\r\n]+)\]`?[ \t]*\r?$/gm;
const PARTIAL_CHART_MARKER_LINE_REGEX =
  /^[ \t]*(?:>[ \t]*)?`?\[chart:(dimension|summary):[^\]\r\n]*\r?$/gm;

export function buildChartMarker(scope: ChartMarkerScope, chartId: string): string {
  return `[chart:${scope}:${chartId}]`;
}

export function attachChartMarkers<T extends AnalysisChartResult>(
  charts: T[],
  scope: ChartMarkerScope
): Array<T & { marker: string }> {
  return charts.map((chart) => ({
    ...chart,
    marker: buildChartMarker(scope, chart.chartId),
  }));
}

export function replaceChartMarkers(
  markdown: string,
  resolveReplacement: (marker: ChartMarkerReference) => string | undefined,
  options: ReplaceChartMarkersOptions = {}
): string {
  let result = String(markdown || "");
  result = result.replace(PARTIAL_CHART_MARKER_LINE_REGEX, "");

  const unmatchedMarkers = new Map<string, ChartMarkerReference>();
  result = result.replace(CHART_MARKER_LINE_REGEX, (_match, scope, chartId) => {
    const marker: ChartMarkerReference = {
      scope: scope as ChartMarkerScope,
      chartId: String(chartId).trim(),
    };
    const replacement = resolveReplacement(marker);
    if (replacement) {
      return replacement;
    }

    unmatchedMarkers.set(`${marker.scope}:${marker.chartId}`, marker);
    return "";
  });

  if (unmatchedMarkers.size > 0) {
    options.onUnmatched?.(Array.from(unmatchedMarkers.values()));
  }

  return result;
}

/** Replaces markers with chart HTML before the report body is delivered; unmatched markers are removed with a warning. */
export function replaceChartMarkersWithHtml(markdown: string, chartMap: Map<string, string>) {
  const availableChartIds = Array.from(chartMap.keys());
  return replaceChartMarkers(
    markdown,
    ({ chartId }) => {
      const html = chartMap.get(chartId);
      return html ? `\n\n\`\`\`html\n${html}\n\`\`\`\n\n` : undefined;
    },
    {
      onUnmatched: (markers) => {
        logger.warn(tApp("analysis.report.chart-marker.387"), {
          unmatchedMarkers: markers.map((marker) => `${marker.scope}:${marker.chartId}`),
          availableChartIds,
        });
      },
    }
  );
}
