import type { AnalysisTaskStatus } from "@ontomato/contracts/analysis-task";
import type {
  DeepAnalysisTaskPayload,
  AnalysisSection,
} from "@ontomato/contracts/analysis-presentation";
import { replaceChartMarkersWithHtml } from "../report/chart-marker";

function sectionMarkdown(section: AnalysisSection): string {
  return section.title
    ? `${"#".repeat(section.titleLevel || 2)} ${section.title}\n\n${section.markdown}`
    : section.markdown;
}

/** Email, PDF, and MCP all take their deliverable content from the same ordered sections and existing charts. */
export function buildDeepAnalysisTaskResult(artifacts?: DeepAnalysisTaskPayload): {
  resultSummary: string;
  resultReport: string;
  chartHtmls: Record<string, string>;
} {
  if (!artifacts) return { resultSummary: "", resultReport: "", chartHtmls: {} };
  return {
    resultSummary:
      artifacts.sections.find((s) => s.sectionId === "summary" || s.sectionId === "report")
        ?.markdown || "",
    resultReport: artifacts.sections
      .filter((s) => s.markdown && s.status !== "failed")
      .sort((a, b) => a.order - b.order)
      .map(sectionMarkdown)
      .join("\n\n---\n\n"),
    chartHtmls: Object.fromEntries(
      artifacts.charts.filter((c) => c.chartId && c.html).map((c) => [c.chartId, c.html])
    ),
  };
}

export function buildDeepAnalysisMarkdown(artifacts: DeepAnalysisTaskPayload): string {
  const charts = new Map(artifacts.charts.map((c) => [c.chartId, c.html]));
  return artifacts.sections
    .filter((s) => s.markdown && s.status !== "failed")
    .sort((a, b) => a.order - b.order)
    .map((s) => replaceChartMarkersWithHtml(sectionMarkdown(s), charts))
    .join("\n\n");
}

export function buildDeepAnalysisTaskSnapshot(input: {
  taskId: string;
  threadId?: string;
  requestSeq?: number;
  status: AnalysisTaskStatus;
  payload: DeepAnalysisTaskPayload;
  fallbackText?: string;
}) {
  return {
    mode: "deep-analysis" as const,
    status:
      input.payload.runState.status === "running"
        ? ("streaming" as const)
        : input.payload.runState.status === "completed"
          ? ("completed" as const)
          : ("failed" as const),
    source: "analysis-task" as const,
    taskId: input.taskId,
    threadId: input.threadId,
    requestSeq: input.requestSeq,
    primaryText:
      buildDeepAnalysisMarkdown(input.payload) ||
      input.payload.finalAnswer ||
      input.fallbackText ||
      "",
    deepAnalysis: input.payload,
  };
}
