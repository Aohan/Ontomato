import { z } from "zod";
import type {
  AnalysisChartDiagnostic,
  AnalysisChartResult,
} from "@ontomato/contracts/analysis-charts";
import { createModel } from "../../config/model-factory";
import { modelAgentName } from "../../logging/model-agents";
import { renderPrompt } from "../../core/prompts/loader";
import { SkillCategory, SkillType } from "../../core/skills/constants";
import { loadSkillContent } from "../../core/skills/discovery/loader";
import { skillRuntime } from "../../core/skills/execution/runtime";
import { skillRegistryManager } from "../../core/skills/registry/manager";
import type { SkillMeta } from "../../core/skills/types";
import { t, tApp } from "../../i18n";
import { createLogger } from "../../logging/logger";
import { buildModelDataView } from "../../utils/model-data-view";

const logger = createLogger("chart-generator");

const chartPlanSchema = z.object({
  title: z.string().min(1),
  chartType: z.string().min(1),
  sourceSubQuestion: z.string().min(1),
  skillId: z.string().min(1),
  reason: z.string().optional(),
  xField: z.string().min(1).optional(),
  yField: z.string().min(1).optional(),
  seriesField: z.string().min(1).optional(),
  sortBy: z.enum(["xField", "yField", "none"]).default("none"),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  topN: z.number().optional(),
  excludeCategoryValues: z.array(z.union([z.string(), z.number()])).default([]),
  config: z.record(z.unknown()).optional(),
});
type ChartPlan = z.infer<typeof chartPlanSchema>;

export interface ChartDatasetCandidate {
  sourceSubQuestion: string;
  sourceQuestionId?: string;
  data: Record<string, unknown>[];
}

function isNumeric(value: unknown): boolean {
  return (
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))
  );
}

function hasValidFields(plan: ChartPlan, data: ChartDatasetCandidate["data"]): boolean {
  const fields = new Set(data.flatMap((row) => Object.keys(row)));
  if ([plan.xField, plan.yField, plan.seriesField].some((field) => field && !fields.has(field))) {
    return false;
  }
  const requiresAxes = [
    "bar",
    "line",
    "pie",
    "scatter",
    "area",
    "heatmap",
    "funnel",
    "treemap",
    "sunburst",
  ].includes(plan.chartType);
  if (requiresAxes && (!plan.xField || !plan.yField)) return false;
  if (
    plan.yField &&
    plan.chartType !== "heatmap" &&
    !data.some((row) => isNumeric(row[plan.yField!]))
  ) {
    return false;
  }
  return plan.excludeCategoryValues.every(
    (value) => plan.xField && data.some((row) => row[plan.xField!] === value)
  );
}

/** The planning, hard-validation, and skill rendering chain shared by query and reports; ownership fields keep the existing presentation contract. */
export async function generateChartsFromCandidates(params: {
  domainId: string;
  userQuestion: string;
  scopeId: string;
  candidates: ChartDatasetCandidate[];
  /** When unspecified, all skills available in the domain are used; an explicit empty array means no charts. */
  enabledVisualizationSkillIds?: string[];
  maxCharts: number;
  failurePolicy: "error" | "diagnostic";
  signal?: AbortSignal;
  onProgress?: (
    progress:
      | { stage: "planning"; skills: SkillMeta[] }
      | { stage: "rendering"; plan: ChartPlan; skill: SkillMeta }
  ) => void;
}): Promise<{
  charts: AnalysisChartResult[];
  diagnostics: AnalysisChartDiagnostic[];
  error?: string;
}> {
  const { scopeId, candidates, signal } = params;
  signal?.throwIfAborted();
  const charts: AnalysisChartResult[] = [];
  const diagnostics: AnalysisChartDiagnostic[] = [];
  const diagnose = (
    reason: AnalysisChartDiagnostic["reason"],
    message: string,
    severity: AnalysisChartDiagnostic["severity"] = "info"
  ) =>
    diagnostics.push({
      scopeId,
      reason,
      message,
      severity,
    });

  const skillScope = {
    type: SkillType.EXECUTABLE,
    category: SkillCategory.VISUALIZATION,
    selectedSkillIds: params.enabledVisualizationSkillIds,
  };
  try {
    const registry = await skillRegistryManager.forDomain(params.domainId);
    signal?.throwIfAborted();
    const availableSkills = registry.getSkills(skillScope).flatMap((skill) => {
      const content = loadSkillContent(skill);
      return content ? [{ skill, content }] : [];
    });
    if (availableSkills.length === 0) {
      diagnose("no_visualization_skill", tApp("queryFixed.5"), "warning");
    } else if (!candidates.some((candidate) => candidate.data.length > 0)) {
      diagnose("no_data_candidates", tApp("queryFixed.6"));
    } else {
      const availableSkillsInfo = availableSkills
        .map(
          ({ skill, content }) =>
            `### ${skill.id}\ntitle: ${skill.manifest.title || skill.id}\n${content}`
        )
        .join("\n\n");
      const candidatesInfo = candidates
        .map((candidate) => {
          const fields = [...new Set(candidate.data.flatMap((row) => Object.keys(row)))];
          return `sourceSubQuestion: ${candidate.sourceSubQuestion}\nfields: ${fields.join(", ")}\ndataEvidence: ${JSON.stringify(buildModelDataView(candidate.data))}`;
        })
        .join("\n\n");
      params.onProgress?.({ stage: "planning", skills: availableSkills.map(({ skill }) => skill) });
      const model = await createModel({ agentName: modelAgentName("chartPlanner") });
      const response = await model.invoke(
        renderPrompt("charts.chart-planner.user", {
          userQuestion: params.userQuestion,
          availableSkillsInfo,
          candidatesInfo,
          maxCharts: String(params.maxCharts),
        }),
        { signal }
      );
      signal?.throwIfAborted();
      const content = String(response.content || "").trim();
      const json = content.replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1");
      const plans = z.array(z.unknown()).parse(JSON.parse(json));
      if (plans.length === 0) diagnose("no_viable_plan", tApp("queryFixed.7"));
      for (const rawPlan of plans) {
        if (charts.length >= params.maxCharts) break;
        const parsed = chartPlanSchema.safeParse(rawPlan);
        if (!parsed.success) {
          diagnose("invalid_plan", tApp("queryFixed.8"));
          continue;
        }
        const plan = parsed.data;
        const source = candidates.find(
          (candidate) => candidate.sourceSubQuestion === plan.sourceSubQuestion
        );
        const skill = availableSkills.find(
          ({ skill: candidate }) => candidate.id === plan.skillId
        )?.skill;
        if (!source?.data.length || !skill || !hasValidFields(plan, source.data)) {
          diagnose("invalid_plan", tApp("queryFixed.1", { v0: (plan.title) }));
          continue;
        }
        signal?.throwIfAborted();
        params.onProgress?.({ stage: "rendering", plan, skill });
        try {
          const rendered = await skillRuntime.execute(
            params.domainId,
            skill.id,
            {
              ...plan.config,
              data: source.data,
              query: params.userQuestion,
              title: plan.title,
              chartType: plan.chartType,
              xField: plan.xField,
              yField: plan.yField,
              seriesField: plan.seriesField,
              sortBy: plan.sortBy,
              sortOrder: plan.sortOrder,
              topN: plan.topN,
              excludeCategoryValues: plan.excludeCategoryValues,
            },
            skillScope
          );
          signal?.throwIfAborted();
          if (rendered.meta?.error || !rendered.html?.trim()) {
            diagnose(
              "invalid_render_output",
              tApp("queryFixed.2", { v0: (skill.id) }),
              "warning"
            );
            continue;
          }
          charts.push({
            ...plan,
            chartId: `${scopeId}-${charts.length + 1}`,
            title: rendered.meta?.title || plan.title,
            chartType: rendered.meta?.chartType || plan.chartType,
            scopeId,
            html: rendered.html,
            dataCount: source.data.length,
            provenance: {
              sourceQuestionIds: [source.sourceQuestionId || plan.sourceSubQuestion],
              generatedAt: Date.now(),
              generator: "skill",
            },
            evidenceSummary:
              plan.xField && plan.yField
                ? `${plan.xField} vs ${plan.yField}`
                : plan.reason || plan.chartType,
          });
        } catch (error) {
          signal?.throwIfAborted();
          const cause = error instanceof Error ? error : new Error(String(error));
          diagnose("skill_execution_failed", tApp("queryFixed.3", { v0: (cause.message) }), "warning");
          logger.warn(tApp("queryFixed.9"), { scopeId, skillId: skill.id, error: cause.message });
        }
      }
    }
  } catch (error) {
    signal?.throwIfAborted();
    const cause = error instanceof Error ? error : new Error(String(error));
    diagnose("no_viable_plan", tApp("queryFixed.4", { v0: (cause.message) }), "warning");
    logger.warn(tApp("queryFixed.10"), { scopeId, error: cause.message });
  }

  if (params.failurePolicy === "error" && charts.length === 0) {
    const reason = diagnostics[0]?.reason;
    const key =
      reason === "no_visualization_skill"
        ? "viz.noRenderSkillsAvailableCheck"
        : reason === "no_data_candidates"
          ? "viz.missingData"
          : reason === "invalid_plan"
            ? "viz.missingChartConfig"
            : reason === "no_viable_plan"
              ? "viz.noValidConfigJson"
              : "viz.generationFailedNoHtml";
    return { charts, diagnostics, error: t(key) };
  }
  return { charts, diagnostics };
}
