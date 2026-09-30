import type { QueryThinkingState, ThinkingAbcStep } from "@ontomato/contracts/query-thinking";
import { GraphState, GraphUpdate, VisualizationResult } from "../state";
import { createLogger } from "../../../../logging/logger";
import { t, tApp } from "../../../../i18n";
import { generateChartsFromCandidates } from "../../../charts/chart-generator";
import { resolveVisualizationData } from "../utils/data-resolver";
import {
  createRuntimeArtifactRef,
  getQueryArtifactCache,
  resolveAnalysisData,
} from "../utils/query-artifact-cache";
import { noDataVisualization } from "./visualization-no-data";

const logger = createLogger("visualization-node");

const VIS_STEP_KEYS = ["data", "skill", "analyze", "render"] as const;
type VisStepKey = (typeof VIS_STEP_KEYS)[number];

const VIS_STEP_META: Record<VisStepKey, { label: string; detail?: string }> = {
  data: { label: t("viz.preparingData") },
  skill: { label: t("viz.matchingSkills") },
  analyze: { label: t("viz.analyzingData") },
  render: { label: t("viz.generatingChart") },
};

function buildInitialVisThinkingState(): QueryThinkingState {
  return {
    summary: "",
    headline: t("viz.preparingVisualization"),
    status: "running",
    winner: null,
    branches: [],
    tailLines: [],
    abc: {
      status: "running",
      steps: VIS_STEP_KEYS.map((key, i) => ({
        key,
        label: VIS_STEP_META[key].label,
        text: "",
        done: false,
        timestamp: Date.now() + i,
        active: false,
        status: (i === 0 ? "running" : "waiting") as ThinkingAbcStep["status"],
      })),
    },
  };
}

function updateVisStep(
  state: QueryThinkingState,
  stepKey: VisStepKey,
  update: Partial<ThinkingAbcStep>,
  headline?: string
): QueryThinkingState {
  if (!state.abc) return state;
  const nextSteps = state.abc.steps.map((step) =>
    step.key === stepKey ? { ...step, ...update } : step
  );
  return {
    ...state,
    headline: headline || state.headline,
    abc: { ...state.abc, steps: nextSteps },
  };
}

function markVisStepDone(
  state: QueryThinkingState,
  stepKey: VisStepKey,
  detail?: string,
  headline?: string
): QueryThinkingState {
  return updateVisStep(
    state,
    stepKey,
    {
      status: "done",
      done: true,
      active: false,
      detail: detail || VIS_STEP_META[stepKey].detail,
    },
    headline
  );
}

function activateVisStep(
  state: QueryThinkingState,
  stepKey: VisStepKey,
  headline?: string
): QueryThinkingState {
  return updateVisStep(state, stepKey, { status: "running", active: true }, headline);
}

function failVisStep(
  state: QueryThinkingState,
  stepKey: VisStepKey,
  detail?: string,
  headline?: string
): QueryThinkingState {
  return updateVisStep(state, stepKey, { status: "failed", active: false, detail }, headline);
}

function buildVisThinkingSummary(state: QueryThinkingState): string {
  const lines: string[] = [];
  if (state.headline) lines.push(`🧭 ${state.headline}`);
  if (state.abc?.steps) {
    for (const step of state.abc.steps) {
      const icon =
        step.status === "done"
          ? "✅"
          : step.status === "running"
            ? "🔄"
            : step.status === "failed"
              ? "❌"
              : "○";
      lines.push(`${icon} ${step.label}${step.detail ? ` ${step.detail}` : ""}`.trim());
    }
  }
  if (state.tailLines?.length) {
    lines.push("");
    lines.push(...state.tailLines);
  }
  return lines.join("\n").trim();
}

function sendVisThinkingState(state: QueryThinkingState, sendEvent: (event: any) => void) {
  const summary = buildVisThinkingSummary(state);
  const snapshot: QueryThinkingState = { ...state, summary };
  sendEvent({
    type: "thinking_state",
    node: "visualization",
    content: { thinking: summary, mode: "replace", thinkingState: snapshot },
    timestamp: Date.now(),
  });
}

function createErrorReturn(errorMsg: string): GraphUpdate {
  return {
    events: [
      {
        type: "thinking" as const,
        node: "visualization" as const,
        content: t("viz.generationFailed", { error: errorMsg }),
        timestamp: Date.now(),
      },
      {
        type: "error" as const,
        node: "visualization" as const,
        content: errorMsg,
        timestamp: Date.now(),
      },
    ],
    errors: [{ node: "visualization", message: errorMsg, timestamp: Date.now() }],
  };
}

export async function visualizationNode(state: GraphState, config?: any): Promise<GraphUpdate> {
  const visualizationStep = state.plan?.steps.find((step) => step.type === "visualization");
  const visualizationInstruction =
    visualizationStep?.type === "visualization" ? visualizationStep.instruction : undefined;
  logger.info(tApp("queryFixed.84", { v0: (visualizationInstruction || tApp("queryFixed.89")) }));

  const onEvent = config?.configurable?.onEvent;
  const domainId = config?.configurable?.domainId as string | undefined;
  const requestSeq = config?.configurable?.requestSeq ?? 0;
  const queryArtifactCache = getQueryArtifactCache(config);

  const sendEvent = (event: any) => {
    if (onEvent) onEvent(event);
  };

  if (!visualizationInstruction) {
    return createErrorReturn(tApp("queryFixed.90"));
  }

  // Initialize the visualization thinking state
  let visThinking: QueryThinkingState = buildInitialVisThinkingState();
  sendVisThinkingState(visThinking, sendEvent);

  if (!domainId) {
    visThinking = failVisStep(
      visThinking,
      "data",
      t("viz.noRenderSkillsAvailable"),
      t("viz.initializationFailed")
    );
    sendVisThinkingState(visThinking, sendEvent);
    return createErrorReturn(t("viz.noRenderSkillsAvailableCheck"));
  }

  // Fetch data
  try {
    sendEvent({
      type: "progress" as const,
      node: "visualization" as const,
      content: t("viz.fetchingData"),
      timestamp: Date.now(),
    });

    const artifactData = await resolveAnalysisData(state, config);
    const dataSourceResult = artifactData
      ? {
          success: true,
          data: artifactData.data,
          source: artifactData.source,
        }
      : await resolveVisualizationData(state.userQuestion, undefined, state.mockData);

    if (!dataSourceResult.success || !dataSourceResult.data) {
      logger.error(tApp("queryFixed.91"), dataSourceResult.error);
      visThinking = failVisStep(
        visThinking,
        "data",
        dataSourceResult.error || t("viz.missingData")
      );
      sendVisThinkingState(visThinking, sendEvent);
      return createErrorReturn(dataSourceResult.error || t("viz.missingData"));
    }

    const data = dataSourceResult.data;
    const dataSource = dataSourceResult.source;
    logger.info(tApp("queryFixed.85", { v0: (dataSource), v1: (data.length) }));

    const noDataChart = noDataVisualization();
    if (data.length === 0 && noDataChart) {
      const { title, message, html } = noDataChart();
      visThinking = {
        ...visThinking,
        status: "completed",
        headline: title,
        summary: `${title}\n${message}`,
        abc: undefined,
        tailLines: [],
      };
      sendVisThinkingState(visThinking, sendEvent);

      const visualizationResult: VisualizationResult = {
        thinking: visThinking.summary,
        thinkingState: visThinking,
        result: { html, chartType: "none", title },
      };

      if (queryArtifactCache) {
        const visualizationArtifactRef = createRuntimeArtifactRef(
          "visualization",
          state.threadId,
          requestSeq
        );
        queryArtifactCache.setVisualizationResult(visualizationArtifactRef, visualizationResult);
        return { visualizationArtifactRef, events: [] };
      }

      logger.warn(
        "QueryArtifactCache is not initialized; no-data visualization cannot be persisted",
        {
          threadId: state.threadId,
          requestSeq,
        }
      );
      return { events: [] };
    }

    visThinking = markVisStepDone(
      visThinking,
      "data",
      tApp("queryFixed.86", { v0: (dataSource), v1: (data.length) }),
      t("viz.dataReady")
    );
    visThinking = activateVisStep(visThinking, "skill", t("viz.matchingVisSkills"));
    sendVisThinkingState(visThinking, sendEvent);

    const generation = await generateChartsFromCandidates({
      domainId,
      userQuestion: visualizationInstruction,
      scopeId: `visualization-${requestSeq}`,
      candidates: [{ sourceSubQuestion: visualizationInstruction, data }],
      maxCharts: 1,
      failurePolicy: "error",
      signal: config?.configurable?.signal,
      onProgress(progress) {
        if (progress.stage === "planning") {
          visThinking = markVisStepDone(
            visThinking,
            "skill",
            progress.skills.map((skill) => skill.manifest.title || skill.id).join(tApp("queryFixed.92")),
            t("viz.skillMatchComplete")
          );
          visThinking = activateVisStep(visThinking, "analyze", t("viz.analyzingDataStructure"));
          sendVisThinkingState(visThinking, sendEvent);
          return;
        }
        const { plan, skill } = progress;
        visThinking = markVisStepDone(visThinking, "skill", skill.manifest.title || skill.id);
        visThinking = markVisStepDone(
          visThinking,
          "analyze",
          plan.xField && plan.yField
            ? tApp("queryFixed.87", { v0: (plan.xField), v1: (plan.yField) })
            : tApp("queryFixed.88", { v0: (skill.manifest.title || skill.id), v1: (plan.title) }),
          t("viz.dataAnalysisComplete")
        );
        const generating = t("viz.generating", {
          type: t("viz.chart"),
        });
        visThinking = activateVisStep(visThinking, "render", generating);
        sendVisThinkingState(visThinking, sendEvent);
        sendEvent({
          type: "progress",
          node: "visualization",
          content: generating,
          skillId: skill.id,
          timestamp: Date.now(),
        });
      },
    });
    const chart = generation.charts[0];
    if (!chart) {
      const errorMsg = generation.error!;
      const reason = generation.diagnostics[0]?.reason;
      visThinking = failVisStep(
        visThinking,
        reason === "no_visualization_skill"
          ? "skill"
          : reason === "invalid_render_output" || reason === "skill_execution_failed"
            ? "render"
            : "analyze",
        errorMsg,
        t("viz.chartGenerationFailed")
      );
      visThinking = { ...visThinking, status: "failed" };
      sendVisThinkingState(visThinking, sendEvent);
      return createErrorReturn(errorMsg);
    }
    const { chartType, title, skillId, html } = chart;
    const usedSkills = [skillId];

    visThinking = markVisStepDone(
      visThinking,
      "render",
      tApp("queryFixed.88", { v0: (chartType), v1: (title) }),
      t("viz.chartGenerationComplete")
    );
    visThinking = {
      ...visThinking,
      status: "completed",
      headline: t("viz.visualizationComplete"),
      abc: visThinking.abc ? { ...visThinking.abc, status: "success" } : undefined,
      tailLines: [
        t("viz.generatedViz", { type: chartType, title }),
      ],
    };
    sendVisThinkingState(visThinking, sendEvent);

    const visualizationResult: VisualizationResult = {
      thinking: buildVisThinkingSummary(visThinking),
      thinkingState: visThinking,
      result: { html, chartType, title },
    };

    const resultEvent = {
      type: "result" as const,
      node: "visualization" as const,
      content: { chartType, title },
      skills: usedSkills,
      timestamp: Date.now(),
    };

    sendEvent(resultEvent);

    logger.debug(tApp("queryFixed.93"));

    if (queryArtifactCache) {
      const visualizationArtifactRef = createRuntimeArtifactRef(
        "visualization",
        state.threadId,
        requestSeq
      );
      queryArtifactCache.setVisualizationResult(visualizationArtifactRef, visualizationResult);
      return {
        visualizationArtifactRef,
        events: [],
      };
    }

    logger.warn(tApp("queryFixed.94"), {
      threadId: state.threadId,
      requestSeq,
    });
    return {
      events: [resultEvent],
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(tApp("queryFixed.95"), {
      error: errorMsg,
      threadId: config?.configurable?.thread_id,
    });

    visThinking = {
      ...visThinking,
      status: "failed",
      headline: t("viz.visualizationFailed"),
      tailLines: [`❌ ${errorMsg}`],
    };
    sendVisThinkingState(visThinking, sendEvent);

    return {
      events: [],
      errors: [{ node: "visualization", message: errorMsg, timestamp: Date.now() }],
    };
  }
}
