import type { AnalysisChartResult, ProvenanceInfo } from "@ontomato/contracts/analysis-charts";
import { createModel } from "../../../config/model-factory";
import { modelAgentName } from "../../../logging/model-agents";
import { renderPrompt } from "../../../core/prompts/loader";
import { createLogger } from "../../../logging/logger";

import type { AnalysisEvidence } from "../runtime/evidence-types";
import type {
  DimensionReportParams,
  MultiDimensionSummaryParams,
  DimensionReportGenerationResult,
  MultiDimensionSummaryGenerationResult,
} from "../report/report-types";
import { estimateTextSize, truncateText } from "../../../utils/prompt-context";
import { buildChartMarker } from "../report/chart-marker";
import { applyFieldDisplayPlan } from "../../data-query/adapter";
import { buildModelDataView } from "../../../utils/model-data-view";
import { tApp } from "../../../i18n";


const logger = createLogger("report-generator");

const RETRY_MAX_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 2000;

function buildSkillResultsContext(skillResults?: any[]): string {
  if (!skillResults?.length) return "";

  let context = tApp("analysis.dimension.report-generator.159");
  for (const result of skillResults) {
    if (result?.type === "knowledge" && result?.methodology) {
      context += tApp("analysis.dimension.report-generator.160");
      context += truncateText(
        result.methodology.map((item: string) => `- ${item}`).join("\n"),
        1500
      );
      context += "\n";
    } else if (result?.type === "executable" && result?.outputs) {
      context += tApp("analysis.dimension.report-generator.161", { value: result.skillId || "" });
      context += truncateText(JSON.stringify(result.outputs, null, 2), 2500);
      context += "\n";
    }
  }
  return context;
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate.?limit|quota|exceeded/i.test(message);
}

async function* streamWithRetry<T>(
  streamFn: () => Promise<AsyncIterable<T>>,
  maxAttempts = RETRY_MAX_ATTEMPTS,
  baseDelayMs = RETRY_BASE_DELAY_MS
): AsyncGenerator<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let yielded = false;
    try {
      const stream = await streamFn();
      for await (const chunk of stream) {
        yielded = true;
        yield chunk;
      }
      return;
    } catch (error: unknown) {
      if (!yielded && attempt < maxAttempts - 1 && isRateLimitError(error)) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        logger.warn(
          tApp("analysis.dimension.report-generator.162", { delay: delay, value: attempt + 1, maxAttempts: maxAttempts })
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

function buildInlineChartRules(
  charts?: AnalysisChartResult[],
  _scope: "dimension" | "summary" = "dimension"
) {
  if (!charts?.length) {
    return "";
  }

  const chartList = charts
    .map(
      (chart, index) =>
        tApp("analysis.dimension.report-generator.163", { value: index + 1, chartId: chart.chartId, title: chart.title, chartType: chart.chartType, value2: chart.reason || chart.evidenceSummary || tApp("analysis.dimension.report-generator.164") })
    )
    .join("\n");

  return tApp("analysis.dimension.report-generator.165", { chartList: chartList, buildChartMarker: buildChartMarker(_scope, "<chartId>") });
}

function getDefaultDimensionReportRules(): string {
  return renderPrompt("analysis-agent.shared.summarizer.user");
}

function getDefaultMultiDimSummaryRules(): string {
  return renderPrompt("analysis-agent.shared.conclusion-maker.user");
}

/**
 * Report generator service
 */
export class ReportGenerator {
  private modelOptions: Record<string, any>;

  constructor(modelOptions?: Record<string, any>) {
    this.modelOptions = modelOptions || { temperature: 0.7 };
  }

  /**
   * Generates a dimension report (with source tracing)
   */
  async generateDimensionReport(
    params: DimensionReportParams
  ): Promise<DimensionReportGenerationResult> {
    const {
      dimensionName,
      dimensionValue,
      evidence,
      datasetSchema,
      summarizerPrompt,
      analysisDimensionPrompt,
      skillResults,
      priorDimensionReports,
      charts,
      locale,
    } = params;

    logger.info(
      tApp("analysis.dimension.report-generator.166", { dimensionName: dimensionName, dimensionValue: dimensionValue, length: evidence.length })
    );

    const prompt = this.buildDimensionReportPrompt(
      dimensionName,
      dimensionValue,
      evidence,
      datasetSchema,
      summarizerPrompt || getDefaultDimensionReportRules(),
      skillResults,
      analysisDimensionPrompt,
      priorDimensionReports,
      charts,
      locale
    );

    try {
      const model = await createModel({ ...this.modelOptions, agentName: modelAgentName("analysisReport") });
      logger.info(tApp("analysis.dimension.report-generator.167"), {
        promptLength: estimateTextSize(prompt),
        evidenceCount: evidence.length,
      });
      const response = await model.invoke(prompt);
      const report = typeof response === "string" ? response : response.content;

      const provenance: ProvenanceInfo = {
        sourceQuestionIds: evidence.map((e) => e.questionId),
        sourceChartIds: (charts || []).map((chart) => chart.chartId),
        generatedAt: Date.now(),
        generator: "llm",
      };

      logger.info(tApp("analysis.dimension.report-generator.168"));
      return { report: report as string, provenance };
    } catch (error) {
      logger.error(tApp("analysis.dimension.report-generator.169"), error);
      throw error;
    }
  }

  /**
   * Generates the multi-dimension summary (with source tracing)
   */
  async generateMultiDimensionSummary(
    params: MultiDimensionSummaryParams
  ): Promise<MultiDimensionSummaryGenerationResult> {
    const { dimensionReports, originalQuestion, conclusionMakerPrompt, skillResults, charts } =
      params;

    logger.info(tApp("analysis.dimension.report-generator.170", { length: dimensionReports.length }));

    const prompt = this.buildMultiDimensionSummaryPrompt(
      dimensionReports,
      originalQuestion,
      conclusionMakerPrompt || getDefaultMultiDimSummaryRules(),
      skillResults,
      charts
    );

    try {
      const model = await createModel({ ...this.modelOptions, agentName: modelAgentName("analysisReport") });
      logger.info(tApp("analysis.dimension.report-generator.171"), {
        promptLength: estimateTextSize(prompt),
        reportCount: dimensionReports.length,
      });
      const response = await model.invoke(prompt);
      const summary = typeof response === "string" ? response : response.content;

      const provenance: ProvenanceInfo = {
        sourceQuestionIds: [],
        sourceChartIds: (charts || []).map((chart) => chart.chartId),
        sourceDatasetRefs: dimensionReports.map((r) => `${r.dimensionName}-${r.dimensionValue}`),
        generatedAt: Date.now(),
        generator: "llm",
      };

      logger.info(tApp("analysis.dimension.report-generator.172"));
      return { summary: summary as string, provenance };
    } catch (error) {
      logger.error(tApp("analysis.dimension.report-generator.173"), error);
      throw error;
    }
  }

  /**
   * Builds the dimension report prompt
   */
  private buildDimensionReportPrompt(
    dimensionName: string,
    dimensionValue: string,
    evidence: AnalysisEvidence[],
    datasetSchema: string,
    rules: string,
    skillResults?: any[],
    analysisDimensionPrompt?: string,
    priorDimensionReports?: Array<{
      dimensionName: string;
      dimensionValue: string;
      report: string;
    }>,
    charts?: AnalysisChartResult[],
    locale?: string
  ): string {
    const questionsContext = evidence
      .map((e, index) => {
        const parts = [tApp("analysis.dimension.report-generator.174", { value: index + 1, questionText: e.questionText })];

        if (e.status === "failed") {
          parts.push(tApp("analysis.dimension.report-generator.175", { value: e.error || tApp("analysis.dimension.report-generator.176") }));
        } else if (e.data && e.data.length > 0) {
          const displayRows = e.fieldDisplayPlan
            ? applyFieldDisplayPlan(e.data, e.fieldDisplayPlan, locale)
            : e.data;
          parts.push(
            tApp("analysis.dimension.report-generator.177", { value: e.dataCount || e.data.length, value2: e.fieldDisplayPlan ? `fieldDisplayPlan=${JSON.stringify(e.fieldDisplayPlan)}\n` : "", stringify: JSON.stringify(buildModelDataView(displayRows)) })
          );
        } else if (e.markdownTable) {
          parts.push(tApp("analysis.dimension.report-generator.178", { truncateText: truncateText(e.markdownTable, 1500) }));
        } else {
          parts.push(tApp("analysis.dimension.report-generator.179"));
        }

        if (e.keyFindings && e.keyFindings.length > 0) {
          parts.push(tApp("analysis.dimension.report-generator.180", { join: e.keyFindings.map((f) => `- ${f}`).join("\n") }));
        }

        return parts.join("\n");
      })
      .join("\n\n");

    // Builds the analysis dimension prompt (guides report generation)
    let analysisDimensionContext = "";
    if (analysisDimensionPrompt && analysisDimensionPrompt.trim()) {
      analysisDimensionContext = tApp("analysis.dimension.report-generator.181", { truncateText: truncateText(analysisDimensionPrompt, 2500) });
    }

    // Builds the skill results context
    const skillContext = buildSkillResultsContext(skillResults);

    let priorReportsContext = "";
    if (priorDimensionReports && priorDimensionReports.length > 0) {
      priorReportsContext = tApp("analysis.dimension.report-generator.182", { join: priorDimensionReports
        .map(
          (item, index) =>
            tApp("analysis.dimension.report-generator.183", { value: index + 1, dimensionName: item.dimensionName, value2: item.dimensionValue ? ` - ${item.dimensionValue}` : "", truncateText: truncateText(item.report, 1800) })
        )
        .join("\n\n") });
    }

    const chartContext = buildInlineChartRules(charts, "dimension");

    return renderPrompt("analysis-agent.report-generator.dimension.user", {
      dimensionName,
      dimensionValue,
      datasetSchema,
      questionsContext,
      priorReportsContext,
      skillContext,
      analysisDimensionContext,
      chartContext,
      rules,
    });
  }

  /**
   * Builds the multi-dimension summary prompt
   */
  private buildMultiDimensionSummaryPrompt(
    dimensionReports: Array<{
      dimensionName: string;
      dimensionValue: string;
      report: string;
    }>,
    originalQuestion: string,
    rules: string,
    skillResults?: any[],
    charts?: AnalysisChartResult[]
  ): string {
    const reportsContext = dimensionReports
      .slice(0, 8)
      .map((item, index) => {
        return tApp("analysis.dimension.report-generator.184", { value: index + 1, dimensionName: item.dimensionName, dimensionValue: item.dimensionValue, truncateText: truncateText(item.report, 2000) });
      })
      .join("\n\n");

    const chartContext = buildInlineChartRules(charts, "summary");

    const skillContext = buildSkillResultsContext(skillResults);

    return renderPrompt("analysis-agent.report-generator.summary.user", {
      originalQuestion,
      reportsContext,
      skillContext,
      chartContext,
      rules,
    });
  }

  /**
   * Streams the dimension report generation
   */
  async *generateDimensionReportStream(params: DimensionReportParams): AsyncGenerator<string> {
    const {
      dimensionName,
      dimensionValue,
      evidence,
      datasetSchema,
      summarizerPrompt,
      skillResults,
      analysisDimensionPrompt,
      priorDimensionReports,
      charts,
      signal,
      locale,
    } = params;

    const prompt = this.buildDimensionReportPrompt(
      dimensionName,
      dimensionValue,
      evidence,
      datasetSchema,
      summarizerPrompt || getDefaultDimensionReportRules(),
      skillResults,
      analysisDimensionPrompt,
      priorDimensionReports,
      charts,
      locale
    );

    for await (const chunk of streamWithRetry(async () => {
      const model = await createModel({
        ...this.modelOptions,
        stream: true,
        agentName: modelAgentName("analysisReport"),
      });
      return await model.stream(prompt, { signal });
    })) {
      const text = typeof chunk === "string" ? chunk : (chunk as any).content;
      if (text) yield text as string;
    }
  }

  /**
   * Streams the multi-dimension summary generation
   */
  async *generateMultiDimensionSummaryStream(
    params: MultiDimensionSummaryParams
  ): AsyncGenerator<string> {
    const {
      dimensionReports,
      originalQuestion,
      conclusionMakerPrompt,
      skillResults,
      charts,
      signal,
    } = params;

    const prompt = this.buildMultiDimensionSummaryPrompt(
      dimensionReports,
      originalQuestion,
      conclusionMakerPrompt || getDefaultMultiDimSummaryRules(),
      skillResults,
      charts
    );

    for await (const chunk of streamWithRetry(async () => {
      const model = await createModel({
        ...this.modelOptions,
        stream: true,
        agentName: modelAgentName("analysisReport"),
      });
      return await model.stream(prompt, { signal });
    })) {
      const text = typeof chunk === "string" ? chunk : (chunk as any).content;
      if (text) yield text as string;
    }
  }
}

export const reportGenerator = new ReportGenerator();
