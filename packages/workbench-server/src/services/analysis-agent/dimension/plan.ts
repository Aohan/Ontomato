import type { AnalysisReportHotCard } from "@ontomato/contracts/analysis-report";
import type { AnalysisAgent } from "@ontomato/contracts/analysis-agent";
import type { DeepAnalysisArtifactStore } from "../task/artifacts";
/**
 * 维度形态的计划来源：热卡命中直接复用已发布报告的维度与取数事实，
 * 未命中则按智能体维度配置或提示词做一次维度规划。两条来源都要通过
 * 稳定身份校验，再以同一个计划活动下发完整框架。
 *
 * 本模块同时负责热卡的另一端——分析完成后的待审核卡片沉淀。
 */

import { toDisplayFact } from "../../data-query/query-fact";
import { createLogger } from "../../../logging/logger";
import { buildAnalysisSubQuestionTurnKey } from "../../../logging/log-context";
import { buildQueryRunId } from "../../data-query/query-run-store";
import { toAnalysisQueryFact } from "../runtime/query-result";
import { t } from "../../../i18n";
import { matchAnalysisReportCards } from "./hot-report-matcher";
import { datasetSchemaService } from "../../data-query/dataset-schema";
import { createCard } from "../hot-card/analysis-report-hot-cards";
import { dimensionEngine } from "./dimension-engine";

import { getAnalysisAgentService } from "../config/agent-service";
import { getAnalysisDimensionService } from "../config/dimension-service";

import type {
  DimensionalizedQuestionWithResult,
  PlannedDimension,
  PlannedDimensionWithResults,
} from "./dimension-types";

import { throwIfAborted, type DimensionRunContext } from "./context";
import { normalizeQuestionStatus } from "./evidence";
import { tApp } from "../../../i18n";


const logger = createLogger("deep-analysis-plan");

export interface AnalysisPlan {
  agent: AnalysisAgent;
  datasetSchema: string;
  plannedDimensions: PlannedDimension[];
  /** 命中的分析报告热卡片；命中时子问题走保存的 DSL/重放计划 */
  hotMatchCard: AnalysisReportHotCard | null;
}

/**
 * 维度与子问题的稳定身份是溯源、热卡复用和观测切片的共同前提，
 * 规划一结束就整体校验，不留到执行期逐个失败。
 */
export function assertPlannedDimensionIds(
  plannedDimensions: PlannedDimension[],
  threadId: string,
  requestSeq: number
): void {
  const dimensionIds = new Set<string>();
  const questionIds = new Set<string>();

  for (const dimension of plannedDimensions) {
    const dimensionId = String(dimension.dimensionId || "").trim();
    if (!dimensionId) throw new Error(tApp("analysis.dimension.plan.146"));
    if (dimensionId !== dimension.dimensionId) {
      throw new Error(tApp("analysis.dimension.plan.147", { dimensionId: dimensionId }));
    }
    if (dimensionIds.has(dimensionId)) {
      throw new Error(tApp("analysis.dimension.plan.148", { dimensionId: dimensionId }));
    }
    dimensionIds.add(dimensionId);

    for (const question of dimension.subQuestions) {
      const questionId = String(question.id || "").trim();
      if (!questionId) throw new Error(tApp("analysis.dimension.plan.149", { dimensionId: dimensionId }));
      if (questionId !== question.id) {
        throw new Error(tApp("analysis.dimension.plan.150", { questionId: questionId }));
      }
      if (question.dimensionId !== dimensionId) {
        throw new Error(tApp("analysis.dimension.plan.151", { questionId: questionId }));
      }
      if (questionIds.has(questionId)) {
        throw new Error(tApp("analysis.dimension.plan.152", { questionId: questionId }));
      }
      buildAnalysisSubQuestionTurnKey(threadId, requestSeq, questionId);
      questionIds.add(questionId);
    }
  }
}

function buildHotMatchedDimensions(
  card: AnalysisReportHotCard,
  queryRunsByQuestionId: NonNullable<
    Awaited<ReturnType<typeof matchAnalysisReportCards>>["queryRunsByQuestionId"]
  >
): PlannedDimension[] {
  return card.dimensions.map((dim) => ({
    dimensionId: dim.dimensionId,
    dimensionName: dim.dimensionName,
    dimensionValue: dim.dimensionValue,
    reason: dim.reason || tApp("analysis.dimension.plan.153"),
    subQuestions: dim.subQuestions.map((sq) => {
      const queryRun = queryRunsByQuestionId[sq.id];
      const question: DimensionalizedQuestionWithResult = {
        id: sq.id,
        dimensionId: sq.dimensionId,
        dimensionName: sq.dimensionName || dim.dimensionName,
        dimensionValue: sq.dimensionValue || dim.dimensionValue,
        subQuestion: sq.subQuestion,
        originalQuestion: sq.originalQuestion || card.question,
        ...toAnalysisQueryFact(queryRun),
        dataCount: queryRun?.dataCount ?? sq.dataCount,
        status: normalizeQuestionStatus(sq.status),
        statusText: sq.statusText,
      };
      return question;
    }),
  }));
}

export async function resolveAnalysisPlan(
  ctx: DimensionRunContext,
  store: DeepAnalysisArtifactStore
): Promise<AnalysisPlan> {
  const activityId = store.start("plan");
  const service = await getAnalysisAgentService();
  const agent = await service.getAgent(ctx.agentId, ctx.domainId);

  throwIfAborted(ctx.signal);

  if (!agent) {
    throw new Error(t("analysis.agentNotFound", { agentId: ctx.agentId }));
  }

  const dimensions = await getAnalysisDimensionService().getEnabledDimensions(
    ctx.agentId,
    ctx.domainId
  );

  const hotReportEnabled = agent.hotReportEnabled !== false;
  const matchResult = hotReportEnabled
    ? await matchAnalysisReportCards({
        question: ctx.userQuestion,
        agentId: ctx.agentId,
        domainId: ctx.domainId,
        frameworkContext: {
          agentName: agent.name,
          analysisDimensionPrompt: ctx.analysisDimensionPrompt,
          dimensions,
        },
        signal: ctx.signal,
      })
    : { matched: false as const };
  if (!hotReportEnabled) {
    logger.debug(tApp("analysis.dimension.plan.159"));
  }

  const hotMatchCard = matchResult.matched && matchResult.card ? matchResult.card : null;
  if (hotMatchCard) {
    logger.info(
      tApp("analysis.dimension.plan.154", { id: hotMatchCard.id })
    );
  }

  if (!hotMatchCard && !ctx.analysisDimensionPrompt?.trim() && dimensions.length === 0) {
    throw new Error(t("analysis.noDimensionsOrPrompt", { agentName: agent.name }));
  }

  const datasetSchema = await datasetSchemaService.getSchemaForQuestion(
    ctx.userQuestion,
    ctx.token,
    ctx.apiKey,
    agent.classNames
  );

  throwIfAborted(ctx.signal);

  let plannedDimensions: PlannedDimension[];

  if (hotMatchCard) {
    plannedDimensions = buildHotMatchedDimensions(
      hotMatchCard,
      matchResult.queryRunsByQuestionId || {}
    );
  } else {
    if (dimensions.length === 0) {
      logger.warn(tApp("analysis.dimension.plan.155"), {
        agentId: ctx.agentId,
        agentName: agent.name,
      });
    }

    plannedDimensions = await dimensionEngine.planDimensions({
      originalQuestion: ctx.userQuestion,
      datasetSchema,
      dimensions,
      analysisDimensionPrompt: ctx.analysisDimensionPrompt,
      token: ctx.token,
      apiKey: ctx.apiKey,
    });
  }

  throwIfAborted(ctx.signal);

  assertPlannedDimensionIds(plannedDimensions, ctx.threadId, ctx.requestSeq);

  logger.debug(tApp("analysis.dimension.plan.156"), {
    agentId: ctx.agentId,
    dimensionCount: plannedDimensions.length,
    dimensions: plannedDimensions.map((dimension) => ({
      dimensionId: dimension.dimensionId,
      dimensionName: dimension.dimensionName,
      dimensionValue: dimension.dimensionValue,
      subQuestionCount: dimension.subQuestions.length,
    })),
  });

  if (!plannedDimensions.length) {
    throw new Error(t("analysis.noExecutableDimensions"));
  }

  store.settle(activityId, "completed", {
    dimensions: plannedDimensions.map((dimension) => ({
      dimensionId: dimension.dimensionId,
      name: dimension.dimensionName,
      value: dimension.dimensionValue,
      reason: dimension.reason,
      questions: dimension.subQuestions.map((q) => ({ questionId: q.id, question: q.subQuestion })),
    })),
  });
  for (const dimension of plannedDimensions) {
    store.start("evidence", {
      activityId: `evidence:${dimension.dimensionId}`,
      groupId: dimension.dimensionId,
      questions: dimension.subQuestions.map((q) => ({
        questionId: q.id,
        question: q.subQuestion,
        status: "pending",
        execution: toDisplayFact(q as DimensionalizedQuestionWithResult),
      })),
    });
  }

  return { agent, datasetSchema, plannedDimensions, hotMatchCard };
}

/**
 * 分析报告热卡片沉淀：只沉淀非热匹配路径产生的新报告，异步执行不阻塞收口。
 */
export function persistAnalysisHotCard(
  ctx: DimensionRunContext,
  input: {
    plannedDimensionsWithResults: PlannedDimensionWithResults[];
    successfulReports: Array<{ dimensionName: string; dimensionValue: string; report: string }>;
  }
): void {
  const dimensionsForCard = input.plannedDimensionsWithResults.map((dim) => ({
    dimensionId: dim.dimensionId,
    dimensionName: dim.dimensionName,
    dimensionValue: dim.dimensionValue,
    reason: dim.reason,
    subQuestions: dim.subQuestions.map((q) => ({
      id: q.id,
      dimensionId: q.dimensionId,
      dimensionName: q.dimensionName,
      dimensionValue: q.dimensionValue,
      subQuestion: q.subQuestion,
      dataCount: q.dataCount,
      status: q.status,
      statusText: q.statusText,
      originalQuestion: q.originalQuestion,
      queryRunRef: {
        queryRunId: buildQueryRunId(ctx.threadId, ctx.requestSeq, q.id),
        threadId: ctx.threadId,
        requestSeq: ctx.requestSeq,
        sourceKind: "analysis_sub_question",
        sourceRef: q.id,
      },
    })),
  }));

  const fullReport = input.successfulReports
    .map((report) => {
      const title = report.dimensionValue
        ? tApp("analysis.dimension.plan.157", { dimensionName: report.dimensionName, dimensionValue: report.dimensionValue })
        : `## ${report.dimensionName}\n\n`;
      return title + report.report;
    })
    .join("\n\n");

  createCard({
    question: ctx.userQuestion,
    dimensions: dimensionsForCard,
    reportContent: fullReport,
    status: "PENDING_REVIEW",
    businessDescription: "",
    agentId: ctx.agentId || "unknown",
    sessionId: ctx.threadId || `session-${Date.now()}`,
    domainId: ctx.domainId,
  }).catch((err) => {
    logger.error(tApp("analysis.dimension.plan.158"), err);
  });
}
