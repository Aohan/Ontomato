import type {
  AnalysisChartDiagnostic,
  AnalysisChartResult,
} from "@ontomato/contracts/analysis-charts";
import type { AnalysisActivity } from "@ontomato/contracts/analysis-presentation";
/**
 * 循环形态的图表能力。
 *
 * 图表基于已取得证据的**原始值**数据生成：原始值只在本工具内部流转，循环 Agent
 * 仍然只见展示值。工具复用既有的图表规划与可视化技能执行，返回 chartId 供正文按
 * 既有 marker 规则引用。图表失败不中断循环、不阻断正文，失败记入轨迹。
 *
 * 本工具只在智能体的可视化技能选择非空时注册；空选择表示不提供图表能力。
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

/** 一次图表请求最多产出的图表数量。 */
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
  /** 智能体已选择的可视化技能；调用方保证非空 */
  visualizationSkillIds: string[];
  /** 按问数问题身份取回本次证据的原始值数据集 */
  resolveCandidates: (questionIds: string[]) => ChartDatasetCandidate[];
  /** 图表产出登记到任务产物与页面 */
  onCharts: (
    charts: Array<AnalysisChartResult & { marker: string }>,
    diagnostics: AnalysisChartDiagnostic[]
  ) => void;
}

/** 按可视化技能门控装配图表工具、提示词、轨迹和任务图表事件。 */
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
  /** 受理一次图表请求时回调，用于登记轨迹活动 */
  onAccepted: () => string;
  /** 图表请求结算时回调，用于结算轨迹活动 */
  onSettled: (
    activityId: string,
    status: "completed" | "failed",
    fields: { charts?: AnalysisActivity["charts"]; error?: string }
  ) => void;
}): AgentTool {
  const { deps } = params;
  // 图表标识在一次分析内必须唯一：每次请求使用独立的作用域序号。
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
        // 图表失败不中断循环，也不阻断正文。
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
