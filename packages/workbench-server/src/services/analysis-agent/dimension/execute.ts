import { dimensionSectionTitle } from "../report/report-assembly";
import type {
  AnalysisChartDiagnostic,
  AnalysisChartResult,
  ProvenanceInfo,
} from "@ontomato/contracts/analysis-charts";
/**
 * Execution stage of the dimension form: per dimension, collects evidence, renders charts, runs skills, and streams dimension reports.
 *
 * Dimensions run concurrently under `dimensionQueryConcurrency` and sub-questions under `subQuestionQueryConcurrency`;
 * a single sub-question or dimension failure is isolated as a local failure, and only cancellation interrupts the whole run.
 * Reports are sorted into plan order before landing in artifacts; events go out in actual completion order.
 */

import type { Dataset } from "../../data-query/adapter";
import { environment } from "../../../config/environment";
import { executeSavedAbcReplay, normalizeSavedAbcDsls } from "./abc-replay";
import {
  executeDslDirectly,
  executeSubQuestionWithBranches,
  type SubQuestionBranchResult,
} from "../runtime/deep-analysis-tool";
import { t } from "../../../i18n";
import { DEFAULT_ANALYSIS_CONCURRENCY, runWithConcurrency } from "../../../utils/concurrency";
import {
  ANALYSIS_SUB_QUESTION_SOURCE_KIND,
  buildAnalysisSubQuestionTurnKey,
  runWithTurnContext,
} from "../../../logging/log-context";
import { buildQueryRunInput, toDisplayFact } from "../../data-query/query-fact";
import { upsertQueryRun } from "../../data-query/query-run-store";
import { createLogger } from "../../../logging/logger";
import { generateChartsFromCandidates } from "../../charts/chart-generator";
import { attachChartMarkers } from "../report/chart-marker";
import { getQueryResultDataCount } from "../runtime/query-result";
import { ReportGenerator } from "./report-generator";
import { analysisSkillExecutor } from "./skill-executor";

import type {
  DimensionalizedQuestion,
  DimensionalizedQuestionWithResult,
  PlannedDimension,
  PlannedDimensionWithResults,
} from "./dimension-types";
import type { AnalysisEvidence, DimensionQueryResult } from "../runtime/evidence-types";
import type { DeepAnalysisArtifactStore } from "../task/artifacts";
import { throwIfAborted, type DimensionRunContext, type DimensionStageError } from "./context";
import {
  buildDimensionEvidence,
  buildSkillDatasets,
  mergePlannedSubQuestionsWithResults,
  resolveDimensionStatus,
} from "./evidence";
import { persistAnalysisHotCard, resolveAnalysisPlan, type AnalysisPlan } from "./plan";
import { tApp } from "../../../i18n";


const logger = createLogger("deep-analysis-execute");

export interface DimensionReportItem {
  dimensionId: string;
  dimensionName: string;
  dimensionValue: string;
  report: string;
  success: boolean;
  error?: string;
  provenance?: ProvenanceInfo;
}

export interface DimensionSummaryInput {
  dimensionReports: DimensionReportItem[];
  plannedDimensions: PlannedDimensionWithResults[];
}

interface DimensionOutput {
  queryResults: DimensionQueryResult[];
  plannedDimensionWithResults: PlannedDimensionWithResults;
  charts: AnalysisChartResult[];
  chartDiagnostics: AnalysisChartDiagnostic[];
}

function runWithAnalysisSubQuestionTurn<T>(
  threadId: string,
  requestSeq: number,
  question: Pick<DimensionalizedQuestion, "id">,
  fn: () => T
): T {
  const sourceRef = question.id.trim();
  return runWithTurnContext(
    {
      threadId,
      requestSeq,
      turnKey: buildAnalysisSubQuestionTurnKey(threadId, requestSeq, sourceRef),
    },
    fn
  );
}

/**
 * Analysis stage of one deep analysis: select the plan, execute per dimension, write artifacts.
 *
 * Equivalent to the pre-split analysisAgent node — expected terminations (cancellation, no deliverable report) return via errors,
 * and unexpected exceptions converge here into the same error shape.
 */
export async function runAnalysisStage(
  ctx: DimensionRunContext,
  store: DeepAnalysisArtifactStore
): Promise<{ errors: DimensionStageError[]; summaryInput?: DimensionSummaryInput }> {
  logger.info(tApp("analysis.dimension.execute.99"), { agentId: ctx.agentId });

  try {
    const plan = await resolveAnalysisPlan(ctx, store);
    return await runDimensionStage(ctx, plan, store);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(tApp("analysis.dimension.execute.100"), errorMessage);
    return { errors: [{ node: "analysis", message: errorMessage, timestamp: Date.now() }] };
  }
}

async function runDimensionStage(
  ctx: DimensionRunContext,
  plan: AnalysisPlan,
  store: DeepAnalysisArtifactStore
): Promise<{ errors: DimensionStageError[]; summaryInput?: DimensionSummaryInput }> {
  const { agent, datasetSchema, plannedDimensions, hotMatchCard } = plan;
  const reportGenerator = new ReportGenerator({ temperature: 0.7 });

  const dimensionReports: DimensionReportItem[] = [];
  const allDimensionResults: DimensionQueryResult[] = [];
  const allPlannedDimensionsWithResults: PlannedDimensionWithResults[] = [];
  const successfulDimensionReportsForContext: Array<{
    dimensionName: string;
    dimensionValue: string;
    report: string;
  }> = [];

  const visualizationSkillIds =
    ctx.enabledVisualizationSkillIds !== undefined
      ? ctx.enabledVisualizationSkillIds
      : agent.enabledVisualizationSkillIds || [];
  const hasVisualizationSkills = visualizationSkillIds.length > 0;

  const dimensionQueryConcurrency = Math.max(
    1,
    Number(
      ctx.analysisConcurrency?.dimensionQueryConcurrency ??
        DEFAULT_ANALYSIS_CONCURRENCY.dimensionQueryConcurrency ??
        1
    )
  );
  const subQuestionQueryConcurrency = Math.max(
    1,
    Number(
      ctx.analysisConcurrency?.subQuestionQueryConcurrency ??
        DEFAULT_ANALYSIS_CONCURRENCY.subQuestionQueryConcurrency ??
        1
    )
  );
  const subQuestionQueryIntervalMs = environment.subQuestionInterval(
    DEFAULT_ANALYSIS_CONCURRENCY.subQuestionQueryIntervalMs
  );
  const reportGenerationCooldownMs = environment.reportCooldown(
    DEFAULT_ANALYSIS_CONCURRENCY.reportGenerationCooldownMs ?? 2000
  );

  logger.info(tApp("analysis.dimension.execute.101"), {
    plannedDimensionCount: plannedDimensions.length,
    dimensionQueryConcurrency,
    subQuestionQueryConcurrency,
    subQuestionQueryIntervalMs,
    reportGenerationCooldownMs,
    mode: hotMatchCard ? "hot_match_dsl_direct" : "abc_pipeline",
  });

  const dimensionOrder = new Map<string, number>();
  plannedDimensions.forEach((dimension, index) => {
    if (!dimensionOrder.has(dimension.dimensionId)) {
      dimensionOrder.set(dimension.dimensionId, index);
    }
  });
  const sortByPlannedDimensionOrder = <T extends { dimensionId: string }>(items: T[]): T[] =>
    [...items].sort(
      (a, b) =>
        (dimensionOrder.get(a.dimensionId) ?? Number.MAX_SAFE_INTEGER) -
        (dimensionOrder.get(b.dimensionId) ?? Number.MAX_SAFE_INTEGER)
    );

  const saveSubQuestionQueryRun = async (result: DimensionQueryResult, datasets: Dataset[]) => {
    try {
      await upsertQueryRun(
        buildQueryRunInput({
          identity: {
            threadId: ctx.threadId,
            requestSeq: ctx.requestSeq,
            sourceKind: ANALYSIS_SUB_QUESTION_SOURCE_KIND,
            sourceRef: result.questionId,
            sourceStage: "analysis",
          },
          question: result.subQuestion,
          status: result.status,
          error: result.error,
          fact: {
            ...result,
            datasets: result.datasets || datasets,
            dataCount: getQueryResultDataCount(result.data),
          },
        })
      );
    } catch (error) {
      logger.error(tApp("analysis.dimension.execute.102"), {
        threadId: ctx.threadId,
        requestSeq: ctx.requestSeq,
        subQuestion: result.subQuestion,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  /** Hot-matched sub-question: re-fetches data with the saved replay plan / harness program / DSL instead of ABC planning. */
  const executeHotQuestion = async (
    question: DimensionalizedQuestion
  ): Promise<SubQuestionBranchResult> => {
    const savedQuestion = question as DimensionalizedQuestionWithResult;
    const replayPlan = savedQuestion.replayPlan;
    const savedDsls = normalizeSavedAbcDsls(savedQuestion.dsl);
    const savedAbcCodes = savedQuestion.abcCodes || [];
    const savedAbcOutKeyRefs = savedQuestion.abcOutKeyRefs || [];
    const hasHarnessProgram = savedAbcCodes.length > 0 && savedAbcOutKeyRefs.length > 0;

    if (!replayPlan && savedDsls.length === 0 && !hasHarnessProgram) {
      logger.warn(tApp("analysis.dimension.execute.103"), {
        dimensionId: question.dimensionId,
        subQuestionId: question.id,
      });
      return { status: "failed", error: tApp("analysis.dimension.execute.104") };
    }

    logger.info(
      hasHarnessProgram
        ? tApp("analysis.dimension.execute.105")
        : replayPlan
          ? tApp("analysis.dimension.execute.106")
          : tApp("analysis.dimension.execute.107"),
      {
        dimensionId: question.dimensionId,
        subQuestionId: question.id,
        dslCount: replayPlan ? replayPlan.steps.length : savedDsls.length,
        abcProgramCount: savedAbcCodes.length,
        afterCalculationCount: replayPlan?.afterCalculations.length || 0,
      }
    );

    return runWithAnalysisSubQuestionTurn(ctx.threadId, ctx.requestSeq, question, () =>
      executeSavedAbcReplay({
        replayPlan,
        savedDsl: savedQuestion.dsl,
        savedAbcTrace: {
          abcSubQuestions: savedQuestion.abcSubQuestions,
          abcDsls: savedQuestion.abcDsls,
          abcCodes: savedQuestion.abcCodes,
          abcOutKeyRefs: savedQuestion.abcOutKeyRefs,
        },
        question,
        token: ctx.token,
        signal: ctx.signal || new AbortController().signal,
        executeDsl: (params) => executeDslDirectly({ ...params, locale: ctx.locale }),
      })
    );
  };

  const executeNormalQuestion = async (
    question: DimensionalizedQuestion
  ): Promise<SubQuestionBranchResult> => {
    const { result, pendingQualityCheck } = await runWithAnalysisSubQuestionTurn(
      ctx.threadId,
      ctx.requestSeq,
      question,
      () =>
        executeSubQuestionWithBranches(
          question,
          ctx.token,
          ctx.userId,
          ctx.signal || new AbortController().signal,
          (thinkingState) => {
            store.thinking({
              thinking: thinkingState.summary,
              mode: "replace",
              thinkingState,
              activityId: `evidence:${question.dimensionId}`,
              questionId: question.id,
            });
          },
          ctx.apiKey,
          ctx.locale,
          agent.classNames,
          {
            threadId: ctx.threadId,
            requestSeq: ctx.requestSeq,
            sourceKind: ANALYSIS_SUB_QUESTION_SOURCE_KIND,
            sourceRef: question.id,
            sourceStage: "analysis",
          }
        )
    );
    // Analysis workflows, reports, and run presentation never consume the quality check; after registering we do not wait for its settlement.
    if (pendingQualityCheck) ctx.lateFacts.register(pendingQualityCheck);
    return result;
  };

  const executeQuestion = async (
    question: DimensionalizedQuestion,
    questionIndex: number
  ): Promise<{ result: DimensionQueryResult; datasets: Dataset[] }> => {
    if (questionIndex > 0 && subQuestionQueryIntervalMs > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, subQuestionQueryIntervalMs * questionIndex)
      );
    }

    store.question(`evidence:${question.dimensionId}`, question.id, {
      status: "running",
      statusText: t("analysis.parallelQueryStarting"),
    });

    let branchResult: SubQuestionBranchResult;
    try {
      branchResult = hotMatchCard
        ? await executeHotQuestion(question)
        : await executeNormalQuestion(question);
    } catch (error: unknown) {
      if (ctx.signal?.aborted) throw error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(tApp("analysis.dimension.execute.108"), {
        dimensionId: question.dimensionId,
        subQuestionId: question.id,
        error: errorMessage,
      });
      branchResult = { status: "failed", error: errorMessage };
    }

    const savedReplayPlan = (question as DimensionalizedQuestionWithResult).replayPlan;
    const dataCount = branchResult.dataCount ?? getQueryResultDataCount(branchResult.data);
    const result: DimensionQueryResult = {
      questionId: question.id,
      dimensionId: question.dimensionId,
      dimensionName: question.dimensionName,
      dimensionValue: question.dimensionValue,
      subQuestion: question.subQuestion,
      status: branchResult.status === "completed" ? "completed" : "failed",
      data: branchResult.data,
      dsl: branchResult.dsl,
      markdownTable: branchResult.markdownTable,
      fullContent: branchResult.fullContent,
      backendSessions: branchResult.backendSessions,
      abcSubQuestions: branchResult.abcSubQuestions,
      abcDsls: branchResult.abcDsls,
      abcCodes: branchResult.abcCodes,
      abcOutKeyRefs: branchResult.abcOutKeyRefs,
      replayPlan: branchResult.replayPlan || savedReplayPlan,
      error: branchResult.error,
      datasets: branchResult.datasets,
      datasetPreviews: branchResult.datasetPreviews,
      dataCount,
      thinkingState: branchResult.thinkingState,
      cards: branchResult.cards,
      winner: branchResult.winner,
    };

    store.question(`evidence:${question.dimensionId}`, question.id, {
      status: result.status === "completed" ? "completed" : "failed",
      dataCount,
      error: result.error,
      statusText:
        result.status === "completed"
          ? t("analysis.queryComplete", { count: dataCount })
          : result.error || t("query.status.queryFailed"),
      execution: { ...toDisplayFact(result), dataCount },
    });

    const datasets = branchResult.datasets || [];
    await saveSubQuestionQueryRun(result, datasets);
    return { result, datasets };
  };

  /** Report generation failure and whole-dimension failure share one failed-report publishing path. */
  const publishFailedReport = (plannedDimension: PlannedDimension, errorMessage: string): void => {
    const failedReport = {
      dimensionId: plannedDimension.dimensionId,
      dimensionName: plannedDimension.dimensionName,
      dimensionValue: plannedDimension.dimensionValue,
      report: t("analysis.reportGenerationFailed", { error: errorMessage }),
      success: false as const,
      error: errorMessage,
    };
    dimensionReports.push(failedReport);
    for (const activity of store
      .current()
      .activities.filter(
        (a) => a.groupId === plannedDimension.dimensionId && a.status === "running"
      )) {
      store.settle(activity.activityId, ctx.signal?.aborted ? "cancelled" : "failed", {
        error: errorMessage,
        questions: activity.questions?.map((q) =>
          q.status === "pending" || q.status === "running"
            ? { ...q, status: ctx.signal?.aborted ? "cancelled" : "failed", error: errorMessage }
            : q
        ),
      });
    }
    const chapterId = `chapter:${plannedDimension.dimensionId}`;
    if (!store.current().activities.some((a) => a.activityId === chapterId))
      store.start("chapter", { activityId: chapterId, groupId: plannedDimension.dimensionId });
    store.settle(chapterId, "failed", { error: errorMessage });
    store.section({
      sectionId: plannedDimension.dimensionId,
      mode: "replace",
      markdown: failedReport.report,
      title: dimensionSectionTitle(failedReport),
      titleLevel: 2,
      order: dimensionOrder.get(plannedDimension.dimensionId),
      status: "failed",
      error: errorMessage,
    });
  };

  const buildFailedDimensionOutput = (
    plannedDimension: PlannedDimension,
    errorMessage: string
  ): DimensionOutput => {
    const failedResults: DimensionQueryResult[] = plannedDimension.subQuestions.map((question) => ({
      questionId: question.id,
      dimensionId: question.dimensionId,
      dimensionName: question.dimensionName,
      dimensionValue: question.dimensionValue,
      subQuestion: question.subQuestion,
      status: "failed",
      data: [],
      error: errorMessage,
    }));

    return {
      queryResults: failedResults,
      plannedDimensionWithResults: {
        dimensionId: plannedDimension.dimensionId,
        dimensionName: plannedDimension.dimensionName,
        dimensionValue: plannedDimension.dimensionValue,
        reason: plannedDimension.reason,
        status: "failed",
        subQuestions: mergePlannedSubQuestionsWithResults(plannedDimension, failedResults),
      },
      charts: [],
      chartDiagnostics: [],
    };
  };

  const generateDimensionChartsFor = async (
    plannedDimension: PlannedDimension,
    evidence: AnalysisEvidence[]
  ): Promise<{ charts: AnalysisChartResult[]; diagnostics: AnalysisChartDiagnostic[] }> => {
    const activityId = store.start("chart", { groupId: plannedDimension.dimensionId });
    if (!hasVisualizationSkills || !ctx.domainId) {
      store.settle(activityId, "completed");
      return { charts: [], diagnostics: [] };
    }

    throwIfAborted(ctx.signal);

    const successfulEvidence = evidence.filter(
      (item) => item.status === "completed" && item.data.length > 0
    );
    const chartGeneration = await generateChartsFromCandidates({
      domainId: ctx.domainId,
      userQuestion: ctx.userQuestion,
      scopeId: plannedDimension.dimensionId,
      candidates: successfulEvidence.map((item) => ({
        sourceSubQuestion: item.questionText,
        sourceQuestionId: item.questionId,
        data: item.data,
      })),
      maxCharts: Math.min(3, Math.max(2, successfulEvidence.length)),
      failurePolicy: "diagnostic",
      signal: ctx.signal,
      enabledVisualizationSkillIds: visualizationSkillIds,
    });

    const chartsWithMarkers = attachChartMarkers(chartGeneration.charts, "dimension");
    store.charts(plannedDimension.dimensionId, chartsWithMarkers, chartGeneration.diagnostics);
    store.settle(
      activityId,
      chartGeneration.diagnostics.length && !chartsWithMarkers.length ? "failed" : "completed",
      {
        charts: chartsWithMarkers.map(({ chartId, title }) => ({ chartId, title })),
        error: chartGeneration.diagnostics[0]?.message,
      }
    );
    return { charts: chartsWithMarkers, diagnostics: chartGeneration.diagnostics };
  };

  const runDimensionSkills = async (
    plannedDimension: PlannedDimension,
    queryResults: DimensionQueryResult[]
  ): Promise<any[]> => {
    const activityId = store.start("skill", {
      groupId: plannedDimension.dimensionId,
      skills: ctx.enabledSkillIds.map((skillId) => ({ skillId, action: "run", status: "running" })),
    });
    if (ctx.enabledSkillIds.length === 0 || !ctx.domainId) {
      store.settle(activityId, "completed");
      return [];
    }

    throwIfAborted(ctx.signal);

    const dimensionDatasets = buildSkillDatasets(queryResults);
    const skillExecutionResults = await analysisSkillExecutor.executeMultipleSkills(
      ctx.domainId,
      ctx.enabledSkillIds,
      {
        data: dimensionDatasets.map((dataset) => dataset.data),
        datasets: dimensionDatasets,
        query: ctx.userQuestion,
        dimensionName: plannedDimension.dimensionName,
        dimensionValue: plannedDimension.dimensionValue,
      }
    );
    throwIfAborted(ctx.signal);
    const skillResults = skillExecutionResults
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

    return skillResults;
  };

  const streamDimensionReport = async (
    plannedDimension: PlannedDimension,
    input: {
      evidence: AnalysisEvidence[];
      charts: AnalysisChartResult[];
      skillResults: any[];
    }
  ): Promise<string> => {
    logger.debug(tApp("analysis.dimension.execute.109"), {
      dimensionId: plannedDimension.dimensionId,
      dimensionName: plannedDimension.dimensionName,
      dimensionValue: plannedDimension.dimensionValue,
      evidenceCount: input.evidence.length,
      skillResultCount: input.skillResults.length,
    });

    store.section({
      sectionId: plannedDimension.dimensionId,
      mode: "replace",
      markdown: "",
      title: dimensionSectionTitle({ ...plannedDimension, report: "" }),
      titleLevel: 2,
      order: dimensionOrder.get(plannedDimension.dimensionId),
    });

    throwIfAborted(ctx.signal);

    let reportContent = "";
    for await (const chunk of reportGenerator.generateDimensionReportStream({
      dimensionName: plannedDimension.dimensionName,
      dimensionValue: plannedDimension.dimensionValue,
      evidence: input.evidence,
      datasetSchema,
      summarizerPrompt: ctx.summarizerPrompt,
      analysisDimensionPrompt: ctx.analysisDimensionPrompt,
      skillResults: input.skillResults,
      priorDimensionReports: successfulDimensionReportsForContext,
      charts: input.charts,
      locale: ctx.locale,
      signal: ctx.signal,
    })) {
      if (ctx.signal?.aborted) throw new Error(t("analysis.cancelled"));
      reportContent += chunk;
      store.section({ sectionId: plannedDimension.dimensionId, mode: "append", markdown: chunk });
    }

    return reportContent;
  };

  const processDimension = async (
    plannedDimension: PlannedDimension,
    dimensionIndex: number
  ): Promise<DimensionOutput> => {
    try {
      throwIfAborted(ctx.signal);

      if (dimensionIndex > 0 && subQuestionQueryIntervalMs > 0) {
        await new Promise((r) => setTimeout(r, subQuestionQueryIntervalMs * dimensionIndex));
      }

      logger.info(tApp("analysis.dimension.execute.110"), {
        dimensionId: plannedDimension.dimensionId,
        dimensionName: plannedDimension.dimensionName,
        dimensionValue: plannedDimension.dimensionValue,
        subQuestionCount: plannedDimension.subQuestions.length,
        isHotMatch: !!hotMatchCard,
      });
      store.update(`evidence:${plannedDimension.dimensionId}`, {
        narrative: t("analysis.dimensionQueryStarting", { name: plannedDimension.dimensionName }),
      });

      const subQuestionResults = await runWithConcurrency(
        plannedDimension.subQuestions.map(
          (question, questionIndex) => () => executeQuestion(question, questionIndex)
        ),
        subQuestionQueryConcurrency
      );
      const queryResults: DimensionQueryResult[] = [];
      const datasets: Dataset[] = [];
      for (const item of subQuestionResults) {
        if (item instanceof Error) throw item;
        queryResults.push(item.result);
        datasets.push(...item.datasets);
      }

      const success = queryResults.some((result) => result.status === "completed");

      logger.info(tApp("analysis.dimension.execute.111"), {
        dimensionId: plannedDimension.dimensionId,
        dimensionName: plannedDimension.dimensionName,
        mode: hotMatchCard ? "hot_report" : "normal_analysis",
        success,
        resultCount: queryResults.length,
        datasetCount: datasets.length,
      });
      store.settle(`evidence:${plannedDimension.dimensionId}`, success ? "completed" : "failed");

      throwIfAborted(ctx.signal);

      const evidence = buildDimensionEvidence(queryResults);
      const subQuestionsWithResults = mergePlannedSubQuestionsWithResults(
        plannedDimension,
        queryResults
      );
      const plannedDimensionWithResults: PlannedDimensionWithResults = {
        dimensionId: plannedDimension.dimensionId,
        dimensionName: plannedDimension.dimensionName,
        dimensionValue: plannedDimension.dimensionValue,
        reason: plannedDimension.reason,
        status: resolveDimensionStatus(subQuestionsWithResults),
        subQuestions: subQuestionsWithResults,
      };

      if (!success) {
        const errorMessage =
          queryResults
            .map((result) => result.error)
            .filter((message): message is string => !!message)
            .join(tApp("analysis.dimension.abc-replay.39")) || tApp("analysis.dimension.execute.112");
        publishFailedReport(plannedDimension, errorMessage);
        return {
          queryResults,
          plannedDimensionWithResults,
          charts: [],
          chartDiagnostics: [],
        };
      }

      const chartGeneration = await generateDimensionChartsFor(plannedDimension, evidence);
      const skillResults = await runDimensionSkills(plannedDimension, queryResults);

      throwIfAborted(ctx.signal);

      store.start("chapter", {
        activityId: `chapter:${plannedDimension.dimensionId}`,
        groupId: plannedDimension.dimensionId,
        chapter: plannedDimension.dimensionName,
      });

      try {
        const report = await streamDimensionReport(plannedDimension, {
          evidence,
          charts: chartGeneration.charts,
          skillResults,
        });

        const reportItem: DimensionReportItem = {
          dimensionId: plannedDimension.dimensionId,
          dimensionName: plannedDimension.dimensionName,
          dimensionValue: plannedDimension.dimensionValue,
          report,
          success: true,
          provenance: {
            sourceQuestionIds: evidence.map((item) => item.questionId),
            sourceChartIds: chartGeneration.charts.map((chart) => chart.chartId),
            generatedAt: Date.now(),
            generator: "llm" as const,
          },
        };

        store.settle(`chapter:${plannedDimension.dimensionId}`, "completed");
        store.section({
          sectionId: plannedDimension.dimensionId,
          mode: "replace",
          markdown: report,
          title: dimensionSectionTitle(reportItem),
          titleLevel: 2,
          order: dimensionOrder.get(plannedDimension.dimensionId),
          status: "success",
        });

        dimensionReports.push(reportItem);
        successfulDimensionReportsForContext.push({
          dimensionName: plannedDimension.dimensionName,
          dimensionValue: plannedDimension.dimensionValue,
          report,
        });

        return {
          queryResults,
          plannedDimensionWithResults,
          charts: chartGeneration.charts,
          chartDiagnostics: chartGeneration.diagnostics,
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        publishFailedReport(plannedDimension, errorMessage);
        return {
          queryResults,
          plannedDimensionWithResults: {
            ...plannedDimensionWithResults,
            status: "failed" as const,
          },
          charts: chartGeneration.charts,
          chartDiagnostics: chartGeneration.diagnostics,
        };
      }
    } catch (error: unknown) {
      if (ctx.signal?.aborted) throw error;

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(tApp("analysis.dimension.execute.113"), {
        dimensionId: plannedDimension.dimensionId,
        dimensionName: plannedDimension.dimensionName,
        error: errorMessage,
      });
      publishFailedReport(plannedDimension, errorMessage);
      return buildFailedDimensionOutput(plannedDimension, errorMessage);
    }
  };

  const outputs = await runWithConcurrency(
    plannedDimensions.map((dimension, index) => () => processDimension(dimension, index)),
    dimensionQueryConcurrency
  );

  for (const output of outputs) {
    if (output instanceof Error) {
      logger.error(tApp("analysis.dimension.execute.114"), output.message);
      continue;
    }
    allDimensionResults.push(...output.queryResults);
    allPlannedDimensionsWithResults.push(output.plannedDimensionWithResults);
  }

  // Events go out in completion order; artifacts persist in plan order.
  const orderedDimensionResults = sortByPlannedDimensionOrder(allDimensionResults);
  const orderedPlannedDimensions = sortByPlannedDimensionOrder(allPlannedDimensionsWithResults);
  const orderedReports = sortByPlannedDimensionOrder(dimensionReports);

  if (ctx.signal?.aborted) {
    return {
      errors: [{ node: "analysis", message: t("analysis.cancelled"), timestamp: Date.now() }],
    };
  }

  const successfulReports = orderedReports.filter(
    (report) => report.success && report.report.trim().length > 0
  );
  const completedQuestionCount = orderedDimensionResults.filter(
    (result) => result.status === "completed"
  ).length;
  const hasDeliverableReport = completedQuestionCount > 0 && successfulReports.length > 0;

  if (successfulReports.length > 0 && !hotMatchCard) {
    persistAnalysisHotCard(ctx, {
      plannedDimensionsWithResults: orderedPlannedDimensions,
      successfulReports,
    });
  }

  if (!hasDeliverableReport) {
    const errorMessage =
      completedQuestionCount === 0
        ? tApp("analysis.dimension.execute.115")
        : tApp("analysis.dimension.execute.116");
    logger.error(tApp("analysis.dimension.execute.117"), {
      agentId: ctx.agentId,
      completedQuestionCount,
      successfulReportCount: successfulReports.length,
    });
    return { errors: [{ node: "analysis", message: errorMessage, timestamp: Date.now() }] };
  }

  logger.info(tApp("analysis.dimension.execute.118"), {
    agentId: ctx.agentId,
    plannedDimensionCount: plannedDimensions.length,
    reportCount: orderedReports.length,
    successReportCount: orderedReports.filter((report) => report.success).length,
  });

  return {
    errors: [],
    summaryInput: { dimensionReports: orderedReports, plannedDimensions: orderedPlannedDimensions },
  };
}
