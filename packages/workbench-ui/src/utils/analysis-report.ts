import type { AnalysisChartResult } from "@ontomato/contracts/analysis-charts";
import type { AnalysisReportSummaryPosition } from "@ontomato/contracts/analysis-agent";
import type { ResponseSnapshot } from "../types/chat";
import type { DeepAnalysisTaskPayload } from "@ontomato/contracts/analysis-presentation";
import { workbenchContent } from "../content";

const CHART_MARKER_LINE_REGEX =
  /^[ \t]*(?:>[ \t]*)?`?\[chart:(dimension|summary):([^\]\r\n]+)\]`?[ \t]*\r?$/gm;
const PARTIAL_CHART_MARKER_LINE_REGEX =
  /^[ \t]*(?:>[ \t]*)?`?\[chart:(dimension|summary):[^\]\r\n]*\r?$/gm;
const CHART_BLOCK_REGEX_SOURCE = "```html\\s*\\n([\\s\\S]*?)\\n```";

type ChartHtmlMarker = Pick<AnalysisChartResult, "chartId" | "html">;

export interface ReportSection {
  id: string;
  content: string;
}

function isComprehensiveSummaryHeading(title: string): boolean {
  return workbenchContent().comprehensiveSummaryTitles.includes(title.trim());
}

/** Move the comprehensive summary to the front in a historical report already merged into a single Markdown block. */
export function moveSummaryMarkdownToTop(markdown: string): string {
  const separator = "\n\n---\n\n";
  const parts = markdown.split(separator);
  const summaryIndex = parts.findIndex((part) => {
    const heading = part.trimStart().match(/^#{1,6}[ \t]+([^\r\n]+)(?:\r?\n|$)/);
    return heading ? isComprehensiveSummaryHeading(heading[1]) : false;
  });
  if (summaryIndex <= 0) return markdown;
  return [
    parts[summaryIndex],
    ...parts.slice(0, summaryIndex),
    ...parts.slice(summaryIndex + 1),
  ].join(separator);
}

/** Adjust the display order of the comprehensive summary according to agent config, without changing report body content or other section order. */
export function orderReportSections(
  sections: readonly ReportSection[],
  summaryPosition: AnalysisReportSummaryPosition = "bottom"
): ReportSection[] {
  if (summaryPosition !== "top") return [...sections];

  const summaryIndex = sections.findIndex((section) => section.id === "summary");
  if (summaryIndex <= 0) {
    return sections.map((section) =>
      section.id.startsWith("run:")
        ? { ...section, content: moveSummaryMarkdownToTop(section.content) }
        : section
    );
  }

  return [
    sections[summaryIndex],
    ...sections.slice(0, summaryIndex),
    ...sections.slice(summaryIndex + 1),
  ];
}

export type ReportContentPart =
  | { type: "text"; id: string; content: string }
  | { type: "chart"; id: string; html: string };

export interface ParsedReportContent {
  content: string;
  isStreaming: boolean;
  parts: ReportContentPart[];
}

interface ChartMarkerReference {
  scope: "dimension" | "summary";
  chartId: string;
}

interface EmbedChartHtmlOptions {
  diagnosticLabel?: string;
}

function replaceChartMarkersWithHtml(
  markdown: string,
  chartMap: ReadonlyMap<string, string>,
  unmatchedMarkers: Map<string, ChartMarkerReference>
): string {
  let result = String(markdown || "");
  result = result.replace(PARTIAL_CHART_MARKER_LINE_REGEX, "");

  result = result.replace(CHART_MARKER_LINE_REGEX, (_match, scope, chartId) => {
    const marker: ChartMarkerReference = {
      scope: scope as ChartMarkerReference["scope"],
      chartId: String(chartId).trim(),
    };
    const html = chartMap.get(marker.chartId);
    if (html) {
      return `\n\n\`\`\`html\n${html}\n\`\`\`\n\n`;
    }

    unmatchedMarkers.set(`${marker.scope}:${marker.chartId}`, marker);
    return "";
  });

  return result;
}

function logUnmatchedMarkers(
  markers: ReadonlyMap<string, ChartMarkerReference>,
  chartMap: ReadonlyMap<string, string>,
  diagnosticLabel: string
): void {
  if (markers.size === 0) return;

  const uniqueMarkers = Array.from(markers.values());
  console.warn(workbenchContent().console.reportChartMarkerUnmatched(diagnosticLabel), {
    unmatchedMarkers: uniqueMarkers.map((marker) => `${marker.scope}:${marker.chartId}`),
    availableChartIds: Array.from(chartMap.keys()),
  });
}

export function embedChartHtml(
  markdown: string,
  charts: ChartHtmlMarker[],
  options: EmbedChartHtmlOptions = {}
): string {
  const chartMap = new Map(charts.map((chart) => [String(chart.chartId), chart.html]));
  const unmatchedMarkers = new Map<string, ChartMarkerReference>();
  const result = replaceChartMarkersWithHtml(markdown, chartMap, unmatchedMarkers);
  logUnmatchedMarkers(unmatchedMarkers, chartMap, options.diagnosticLabel || "DeepAnalysisReport");
  return result;
}

function isChartHtml(html: string): boolean {
  return (
    html.includes("<!DOCTYPE html>") || html.includes("echarts") || html.includes("chart-container")
  );
}

function parseReportContentParts(
  content: string,
  sectionId: string,
  startPartIndex = 0
): ReportContentPart[] {
  const parts: ReportContentPart[] = [];
  const regex = new RegExp(CHART_BLOCK_REGEX_SOURCE, "g");
  let partIndex = startPartIndex;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const html = match[1].trim();
    if (!html || !isChartHtml(html)) continue;

    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        id: `${sectionId}:part-${partIndex++}`,
        content: content.slice(lastIndex, match.index),
      });
    }
    parts.push({ type: "chart", id: `${sectionId}:part-${partIndex++}`, html });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({
      type: "text",
      id: `${sectionId}:part-${partIndex}`,
      content: content.slice(lastIndex),
    });
  }

  return parts;
}

export function updateParsedReportContent(
  previous: ParsedReportContent | undefined,
  content: string,
  sectionId: string,
  isStreaming: boolean
): ParsedReportContent {
  if (previous?.content === content && previous.isStreaming === isStreaming) return previous;

  const canAppend =
    !!previous && previous.isStreaming && isStreaming && content.startsWith(previous.content);
  if (!canAppend) {
    return {
      content,
      isStreaming,
      parts: parseReportContentParts(content, sectionId),
    };
  }

  const preservedParts = [...previous.parts];
  const lastPart = preservedParts.at(-1);
  let reparseStart = previous.content.length;
  if (lastPart?.type === "text") {
    reparseStart -= lastPart.content.length;
    preservedParts.pop();
  }

  return {
    content,
    isStreaming,
    parts: [
      ...preservedParts,
      ...parseReportContentParts(content.slice(reparseStart), sectionId, preservedParts.length),
    ],
  };
}

export function buildReportSectionsFromDeepAnalysis(
  deepAnalysis: DeepAnalysisTaskPayload,
  options: EmbedChartHtmlOptions = {}
): ReportSection[] {
  const chartMap = new Map(deepAnalysis.charts.map((chart) => [String(chart.chartId), chart.html]));
  const unmatchedMarkers = new Map<string, ChartMarkerReference>();
  const sections = [...deepAnalysis.sections]
    .sort((a, b) => a.order - b.order)
    .filter((s) => s.markdown.trim())
    .map((section) => ({
      id: section.sectionId,
      content: replaceChartMarkersWithHtml(
        section.title
          ? `${"#".repeat(section.titleLevel || 2)} ${section.title}\n\n${section.markdown}`
          : section.markdown,
        chartMap,
        unmatchedMarkers
      ),
    }));
  if (!sections.length && deepAnalysis.runState.error)
    sections.push({ id: "failure", content: deepAnalysis.runState.error });
  logUnmatchedMarkers(unmatchedMarkers, chartMap, options.diagnosticLabel || "DeepAnalysisReport");
  return sections;
}

export function joinReportSections(sections: readonly ReportSection[]): string {
  return sections.map((section) => section.content).join("\n\n");
}

export function isDeepAnalysisReportStreaming(
  snapshot: ResponseSnapshot | null | undefined
): boolean {
  return (
    snapshot?.deepAnalysis?.runState.status === "running" &&
    snapshot.deepAnalysis.sections.some((s) => !!s.markdown)
  );
}

export function buildReportFromDeepAnalysis(
  deepAnalysis: DeepAnalysisTaskPayload,
  options: EmbedChartHtmlOptions = {}
): string {
  return joinReportSections(buildReportSectionsFromDeepAnalysis(deepAnalysis, options));
}
