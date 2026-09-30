import type { DimensionReportItem, DimensionSummaryInput } from "./execute";
/**
 * Comprehensive summary stage of the dimension form: merges the dimension reports into one summary and adds summary-level charts from evidence.
 *
 * Skipped entirely when no dimension report succeeded — the summary is not a mandatory artifact and skipping is not a failure.
 */

import { t } from "../../../i18n";
import { createLogger } from "../../../logging/logger";
import { generateChartsFromCandidates } from "../../charts/chart-generator";
import { attachChartMarkers } from "../report/chart-marker";
import { expandQueryResultDatasetEntries } from "../runtime/query-result";
import { ReportGenerator } from "./report-generator";
import { analysisSkillExecutor } from "./skill-executor";
import type { AnalysisEvidence } from "../runtime/evidence-types";
import type { DeepAnalysisArtifactStore } from "../task/artifacts";
import type { DimensionRunContext, DimensionStageError } from "./context";
import { tApp } from "../../../i18n";


const logger = createLogger("deep-analysis-summary");

/** The summary's evidence takes every sub-question's raw-value dataset; empty datasets are excluded. */
function buildSummaryEvidence(plannedDimensions: any[]): AnalysisEvidence[] {
  return plannedDimensions
    .flatMap((dimension) => dimension.subQuestions || [])
    .flatMap((question: any) => {
      const datasetEntries = expandQueryResultDatasetEntries({
        data: question.data,
        dsl: question.dsl,
        datasets: question.datasets,
        datasetPreviews: question.datasetPreviews,
        baseTitle: question.subQuestion,
      });
      return datasetEntries.map((entry) => ({
        questionId: `${question.id}#${entry.index}`,
        questionText:
          datasetEntries.length > 1
            ? tApp("analysis.dimension.evidence.98", { subQuestion: question.subQuestion, title: entry.title })
            : question.subQuestion,
        dimensionId: question.dimensionId,
        dimensionName: question.dimensionName,
        status: "completed" as const,
        data: entry.data,
        dataCount: entry.dataCount,
        markdownTable:
          entry.markdownTable || (datasetEntries.length === 1 ? question.markdownTable : undefined),
        abcSubQuestions: question.abcSubQuestions,
      }));
    })
    .filter((item) => item.data.length > 0);
}

function buildSummarySkillInput(
  ctx: DimensionRunContext,
  plannedDimensions: any[],
  successfulReports: DimensionReportItem[]
) {
  const expand = (question: any) =>
    expandQueryResultDatasetEntries({
      data: question.data,
      dsl: question.dsl,
      datasets: question.datasets,
      datasetPreviews: question.datasetPreviews,
      baseTitle: question.subQuestion,
    });
  const questions = plannedDimensions.flatMap((dimension) => dimension.subQuestions || []);

  return {
    query: ctx.userQuestion,
    dimensionReport: successfulReports
      .map(
        (report) =>
          `${report.dimensionName}${report.dimensionValue ? tApp("analysis.dimension.summary.190", { dimensionValue: report.dimensionValue }) : ""}:\n${report.report}`
      )
      .join("\n\n"),
    data: questions.flatMap((question: any) => expand(question).map((entry) => entry.data)),
    datasets: questions.flatMap((question: any) =>
      expand(question).map((entry) => ({
        title: entry.title,
        data: entry.data,
        dsl: entry.dsl,
        dimensionId: question.dimensionId,
        dimensionName: question.dimensionName,
        subQuestion: question.subQuestion,
      }))
    ),
    dimensions: successfulReports.map((report) => ({
      name: report.dimensionName,
      value: report.dimensionValue,
    })),
  };
}

export async function runSummaryStage(
  ctx: DimensionRunContext,
  store: DeepAnalysisArtifactStore,
  input: DimensionSummaryInput
): Promise<{ errors: DimensionStageError[] }> {
  logger.info(tApp("analysis.dimension.summary.191"));

  try {
    const { dimensionReports, plannedDimensions } = input;
    logger.info(tApp("analysis.dimension.summary.192"), {
      totalReportCount: dimensionReports.length,
      successReportCount: dimensionReports.filter((report) => report.success).length,
      failedReportCount: dimensionReports.filter((report) => !report.success).length,
    });

    const successfulReports = dimensionReports.filter((report) => report.success);
    if (successfulReports.length === 0) {
      logger.warn(tApp("analysis.dimension.summary.193"));
      return { errors: [] };
    }

    logger.info(tApp("analysis.dimension.summary.194", { length: successfulReports.length }));

    const visualizationSkillIds = ctx.enabledVisualizationSkillIds || [];
    let summaryCharts: any[] = [];

    const chartActivityId = store.start("chart");
    if (visualizationSkillIds.length > 0 && ctx.domainId) {
      const evidence = buildSummaryEvidence(plannedDimensions);
      const summaryChartGeneration = await generateChartsFromCandidates({
        domainId: ctx.domainId,
        userQuestion: ctx.userQuestion,
        scopeId: "summary",
        candidates: evidence.map((item) => ({
          sourceSubQuestion: `${item.dimensionName}: ${item.questionText}`,
          sourceQuestionId: item.questionId,
          data: item.data,
        })),
        maxCharts: Math.min(4, Math.max(2, evidence.length)),
        failurePolicy: "diagnostic",
        signal: ctx.signal,
        enabledVisualizationSkillIds: visualizationSkillIds,
      });

      summaryCharts = attachChartMarkers(summaryChartGeneration.charts, "summary");
      store.charts("summary", summaryCharts, summaryChartGeneration.diagnostics);
      store.settle(
        chartActivityId,
        summaryChartGeneration.diagnostics.length && !summaryCharts.length ? "failed" : "completed",
        {
          charts: summaryCharts.map(({ chartId, title }) => ({ chartId, title })),
          error: summaryChartGeneration.diagnostics[0]?.message,
        }
      );
    } else {
      store.settle(chartActivityId, "completed");
    }

    let summarySkillResults: any[] = [];
    if (ctx.enabledSkillIds.length > 0 && ctx.domainId) {
      const activityId = store.start("skill", {
        skills: ctx.enabledSkillIds.map((skillId) => ({
          skillId,
          action: "run",
          status: "running",
        })),
      });

      const skillExecutionResults = await analysisSkillExecutor.executeMultipleSkills(
        ctx.domainId,
        ctx.enabledSkillIds,
        buildSummarySkillInput(ctx, plannedDimensions, successfulReports)
      );
      summarySkillResults = skillExecutionResults
        .filter((item) => item.success)
        .map((item) => item.result);

      store.settle(
        activityId,
        skillExecutionResults.some((r) => r.success) ? "completed" : "failed",
        {
          skills: ctx.enabledSkillIds.map((skillId, i) => ({
            skillId,
            action: "run",
            status: skillExecutionResults[i]?.success ? "completed" : "failed",
            error: skillExecutionResults[i]?.error,
          })),
        }
      );
    }

    const reportGenerator = new ReportGenerator({ temperature: 0.7 });
    let summary = "";

    const chapterId = store.start("chapter", { chapter: t("response.comprehensiveSummary") });
    store.section({
      sectionId: "summary",
      title: t("response.comprehensiveSummary"),
      titleLevel: 1,
      order: plannedDimensions.length,
      markdown: "",
      mode: "replace",
    });

    for await (const chunk of reportGenerator.generateMultiDimensionSummaryStream({
      dimensionReports: successfulReports,
      originalQuestion: ctx.userQuestion,
      conclusionMakerPrompt: ctx.conclusionMakerPrompt,
      skillResults: summarySkillResults,
      charts: summaryCharts,
      signal: ctx.signal,
    })) {
      if (ctx.signal?.aborted) throw new Error(t("analysis.cancelled"));
      summary += chunk;
      store.section({ sectionId: "summary", markdown: chunk, mode: "append" });
    }

    logger.info(tApp("analysis.dimension.summary.195"), { summaryLength: summary.length });

    store.settle(chapterId, "completed");
    store.section({ sectionId: "summary", markdown: summary, mode: "replace", status: "success" });

    return { errors: [] };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(tApp("analysis.dimension.summary.196"), errorMessage);
    const section = store.current().sections.find((item) => item.sectionId === "summary");
    if (section)
      store.section({ ...section, mode: "replace", status: "failed", error: errorMessage });

    return { errors: [{ node: "analysis", message: errorMessage, timestamp: Date.now() }] };
  }
}
