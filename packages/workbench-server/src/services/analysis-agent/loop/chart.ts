import type {
  AnalysisChartDiagnostic,
  AnalysisChartResult,
} from "@ontomato/contracts/analysis-charts";
import type { AnalysisActivity } from "@ontomato/contracts/analysis-presentation";
/**
 * Chart capability of the loop form.
 *
 * Charts are generated from the **raw-value** data of evidence already collected: raw values flow only inside this tool while the loop agent
 * still sees display values only. The tool reuses the existing chart planning and visualization skill execution and returns chartIds that the
 * body references by the existing marker rules. Chart failure never interrupts the loop or blocks the body; failures are recorded in the trajectory.
 *
 * This tool is registered only when the agent's visualization skill selection is non-empty; an empty selection means no chart capability.
 */

import type { AgentTool, AgentToolResult } from "../../../core/agent-loop/types";
import { createLogger } from "../../../logging/logger";
import { generateChartsFromCandidates } from "../../charts/chart-generator";
import { attachChartMarkers, buildChartMarker } from "../report/chart-marker";
import type { ChartDatasetCandidate } from "../../charts/chart-generator";
import type { DeepAnalysisArtifactStore } from "../task/artifacts";
import { tApp } from "../../../i18n";


const logger = createLogger("analysis-loop-chart");

const GENERATE_CHART_TOOL_NAME = "generate_chart";

/** Maximum number of charts one chart request may produce. */
const MAX_CHARTS_PER_REQUEST = 3;

function buildChartCapabilityPrompt(reportDeliverableEnabled: boolean): string {
  return [
    tApp("analysis.loop.chart.215", { value: reportDeliverableEnabled ? tApp("analysis.loop.chart.216") : tApp("analysis.loop.chart.217") }),
    "",
    tApp("analysis.loop.chart.218"),
    tApp("analysis.loop.chart.219", { value: reportDeliverableEnabled ? tApp("analysis.loop.chart.220") : tApp("analysis.loop.chart.221") }),
    tApp("analysis.loop.chart.222"),
    tApp("analysis.loop.chart.223"),
    "",
  ].join("\n");
}

export interface LoopChartDeps {
  domainId: string;
  userQuestion: string;
  /** Visualization skills already selected by the agent; the caller guarantees non-empty */
  visualizationSkillIds: string[];
  /** Fetches the raw-value dataset of this evidence by query question identity */
  resolveCandidates: (questionIds: string[]) => ChartDatasetCandidate[];
  /** Registers chart outputs into task artifacts and the page */
  onCharts: (
    charts: Array<AnalysisChartResult & { marker: string }>,
    diagnostics: AnalysisChartDiagnostic[]
  ) => void;
}

/** Assembles the chart tool, prompts, trajectory, and task chart events, gated by visualization skill selection. */
export function assembleLoopChartCapability(params: {
  domainId: string;
  userQuestion: string;
  visualizationSkillIds: string[];
  reportDeliverableEnabled: boolean;
  resolveCandidates: (questionIds: string[]) => ChartDatasetCandidate[];
  trajectory: DeepAnalysisArtifactStore;
}) {
  const tools =
    params.visualizationSkillIds.length > 0
      ? [
          createGenerateChartTool({
            deps: {
              domainId: params.domainId,
              userQuestion: params.userQuestion,
              visualizationSkillIds: params.visualizationSkillIds,
              resolveCandidates: params.resolveCandidates,
              onCharts: (charts, diagnostics) =>
                params.trajectory.charts("report", charts, diagnostics),
            },
            onAccepted: () => params.trajectory.start("chart"),
            onSettled: (activityId, status, fields) =>
              params.trajectory.settle(activityId, status, fields),
          }),
        ]
      : [];

  return {
    prompt:
      params.visualizationSkillIds.length > 0
        ? buildChartCapabilityPrompt(params.reportDeliverableEnabled)
        : "",
    supervisorTools: tools,
  };
}

function parseQuestionIds(params: Record<string, unknown>): string[] {
  const raw = params.questionIds;
  if (!Array.isArray(raw)) {
    throw new Error(tApp("analysis.loop.chart.224"));
  }
  const questionIds = raw.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (questionIds.length === 0) {
    throw new Error(tApp("analysis.loop.chart.225"));
  }
  return questionIds;
}

function describeCharts(charts: Array<AnalysisChartResult & { marker: string }>): string {
  return charts
    .map((chart) => tApp("analysis.loop.chart.226", { chartId: chart.chartId, title: chart.title, marker: chart.marker }))
    .join("\n");
}

export function createGenerateChartTool(params: {
  deps: LoopChartDeps;
  /** Invoked when a chart request is accepted, to register the trajectory activity */
  onAccepted: () => string;
  /** Invoked when a chart request settles, to finalize the trajectory activity */
  onSettled: (
    activityId: string,
    status: "completed" | "failed",
    fields: { charts?: AnalysisActivity["charts"]; error?: string }
  ) => void;
}): AgentTool {
  const { deps } = params;
  // Chart identifiers must be unique within one analysis: each request uses its own scoped sequence number.
  let requestSeq = 0;

  return {
    name: GENERATE_CHART_TOOL_NAME,
    description:
      tApp("analysis.loop.chart.227"),
    parameters: {
      type: "object",
      properties: {
        questionIds: {
          type: "array",
          items: { type: "string" },
          description: tApp("analysis.loop.chart.228"),
        },
        focus: {
          type: "string",
          description: tApp("analysis.loop.chart.229"),
        },
      },
      required: ["questionIds"],
    },
    async execute(_toolCallId: string, toolParams: Record<string, unknown>) {
      const questionIds = parseQuestionIds(toolParams);
      const focus = typeof toolParams.focus === "string" ? toolParams.focus.trim() : "";
      const activityId = params.onAccepted();

      const candidates = deps.resolveCandidates(questionIds);
      if (candidates.length === 0) {
        const message = tApp("analysis.loop.chart.230");
        deps.onCharts(
          [],
          [{ scopeId: "report", reason: "no_data_candidates", message, severity: "info" }]
        );
        params.onSettled(activityId, "failed", { error: message });
        return {
          content: [{ type: "text", text: tApp("analysis.loop.chart.231", { message: message }) }],
        } satisfies AgentToolResult;
      }

      requestSeq += 1;
      try {
        const generation = await generateChartsFromCandidates({
          domainId: deps.domainId,
          userQuestion: focus || deps.userQuestion,
          scopeId: "report",
          candidates,
          enabledVisualizationSkillIds: deps.visualizationSkillIds,
          maxCharts: Math.min(MAX_CHARTS_PER_REQUEST, candidates.length),
          failurePolicy: "diagnostic",
        });

        const charts = attachChartMarkers(
          generation.charts.map((chart) => ({
            ...chart,
            chartId: `${chart.chartId}-${requestSeq}`,
          })),
          "summary"
        );
        deps.onCharts(charts, generation.diagnostics);

        if (charts.length === 0) {
          const message = generation.diagnostics[0]?.message || tApp("analysis.loop.chart.232");
          params.onSettled(activityId, "failed", { error: message });
          return {
            content: [{ type: "text", text: tApp("analysis.loop.chart.233", { message: message }) }],
          } satisfies AgentToolResult;
        }

        params.onSettled(activityId, "completed", {
          charts: charts.map((chart) => ({ chartId: chart.chartId, title: chart.title })),
        });

        return {
          content: [
            {
              type: "text",
              text: [
                tApp("analysis.loop.chart.234", { length: charts.length }),
                describeCharts(charts),
                tApp("analysis.loop.chart.235", { buildChartMarker: buildChartMarker("summary", "<chartId>") }),
              ].join("\n"),
            },
          ],
        } satisfies AgentToolResult;
      } catch (error: unknown) {
        // Chart failure neither interrupts the loop nor blocks the body.
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(tApp("analysis.loop.chart.236"), { activityId, error: message });
        params.onSettled(activityId, "failed", { error: message });
        return {
          content: [{ type: "text", text: tApp("analysis.loop.chart.237", { message: message }) }],
        } satisfies AgentToolResult;
      }
    },
  };
}
