import type { AnalysisReportHotCard } from "@ontomato/contracts/analysis-report";
import { createModel } from "../../../config/model-factory";
import { modelAgentName } from "../../../logging/model-agents";
import { renderPrompt } from "../../../core/prompts/loader";
import { createLogger } from "../../../logging/logger";
import { truncateText } from "../../../utils/prompt-context";
import {
  stripAnalysisTags,
  extractFirstJSONObject,
} from "../../data-query/hot-data/hot-data-utils";
import { getCardById, getPublishedCardCandidates } from "../hot-card/analysis-report-hot-cards";

import { getQueryRunBySource, type QueryRun } from "../../data-query/query-run-store";
import { tApp } from "../../../i18n";


const logger = createLogger("hot-report-matcher");

const MAX_MATCH_CARDS = 20;

export interface AnalysisReportMatchResult {
  matched: boolean;
  card?: AnalysisReportHotCard;
  queryRunsByQuestionId?: Record<string, QueryRun | undefined>;
}

export interface AnalysisReportMatchFrameworkContext {
  agentName?: string;
  analysisDimensionPrompt?: string;
  dimensions?: Array<{
    id?: string;
    name?: string;
    dimensionType?: string;
    valueSource?: string;
    values?: string[];
    datasetField?: string;
    subQuestionTemplate?: string;
  }>;
}

function formatFrameworkContext(context?: AnalysisReportMatchFrameworkContext): string {
  if (!context) {
    return tApp("analysis.dimension.hot-report-matcher.122");
  }

  const dimensions = context.dimensions || [];
  const dimensionSummary =
    dimensions.length > 0
      ? dimensions
          .slice(0, 12)
          .map((dimension, index) => {
            const name = dimension.name || dimension.id || tApp("analysis.dimension.hot-report-matcher.123", { value: index + 1 });
            const valueInfo =
              dimension.valueSource === "static"
                ? tApp("analysis.dimension.dimension-engine.62", { value: (dimension.values || []).join(tApp("analysis.dimension.dimension-engine.63")) || tApp("analysis.dimension.dimension-engine.64") })
                : dimension.datasetField
                  ? tApp("analysis.dimension.hot-report-matcher.124", { datasetField: dimension.datasetField })
                  : tApp("analysis.dimension.hot-report-matcher.125");
            const template = dimension.subQuestionTemplate
              ? tApp("analysis.dimension.hot-report-matcher.126", { truncateText: truncateText(dimension.subQuestionTemplate, 300) })
              : "";
            return tApp("analysis.dimension.hot-report-matcher.127", { name: name, value: dimension.dimensionType ? tApp("analysis.dimension.hot-report-matcher.128", { dimensionType: dimension.dimensionType }) : "", valueInfo: valueInfo, template: template });
          })
          .join("\n")
      : tApp("analysis.dimension.hot-report-matcher.129");

  return [
    tApp("analysis.dimension.hot-report-matcher.130", { value: context.agentName || tApp("analysis.dimension.hot-report-matcher.131") }),
    context.analysisDimensionPrompt?.trim()
      ? tApp("analysis.dimension.hot-report-matcher.132", { truncateText: truncateText(context.analysisDimensionPrompt.trim(), 1500) })
      : tApp("analysis.dimension.hot-report-matcher.133"),
    tApp("analysis.dimension.hot-report-matcher.134", { dimensionSummary: dimensionSummary }),
  ].join("\n\n");
}

/**
 * Uses the LLM to decide whether the current question matches a published analysis report hot card
 */
export async function matchAnalysisReportCards(params: {
  question: string;
  agentId?: string;
  domainId?: string;
  frameworkContext?: AnalysisReportMatchFrameworkContext;
  signal?: AbortSignal;
}): Promise<AnalysisReportMatchResult> {
  const { question, agentId, domainId, frameworkContext, signal } = params;

  try {
    const publishedCards = await getPublishedCardCandidates({ agentId, domainId });
    if (publishedCards.length === 0) {
      logger.debug(tApp("analysis.dimension.hot-report-matcher.135"), { agentId });
      return { matched: false };
    }

    const candidates =
      publishedCards.length > MAX_MATCH_CARDS
        ? publishedCards.slice(0, MAX_MATCH_CARDS)
        : publishedCards;

    const cardSummaries = candidates.map((card, i) => {
      const dimensionNames = card.dimensions.join(tApp("analysis.dimension.dimension-engine.63"));
      const totalQuestions = card.questionTotal;
      return tApp("analysis.dimension.hot-report-matcher.136", { value: i + 1, question: card.question, dimensionNames: dimensionNames, totalQuestions: totalQuestions, value2: card.businessDescription || tApp("analysis.dimension.dimension-engine.64"), value3: i + 1 });
    });

    const prompt = renderPrompt("analysis-agent.hot-report-matcher.user", {
      cardSummaries: cardSummaries.join("\n\n"),
      currentAgentFramework: formatFrameworkContext(frameworkContext),
      question,
    });

    const model = await createModel({ agentName: modelAgentName("hotReportMatcher") });
    const response = await model.invoke([{ role: "user", content: prompt }], { signal });
    const raw = String(response.content ?? "").trim();
    const cleaned = stripAnalysisTags(raw);

    if (!cleaned) {
      logger.debug(tApp("analysis.dimension.hot-report-matcher.137"));
      return { matched: false };
    }

    const result = extractFirstJSONObject<{
      isMatched?: boolean;
      cardIndex?: number;
      reason?: string;
    }>(cleaned);

    if (!result || !result.isMatched || !result.cardIndex) {
      logger.debug(tApp("analysis.dimension.hot-report-matcher.138", { value: result?.reason || tApp("analysis.dimension.hot-report-matcher.139") }));
      return { matched: false };
    }

    const index = result.cardIndex - 1;
    if (index < 0 || index >= candidates.length) {
      logger.warn(tApp("analysis.dimension.hot-report-matcher.140", { cardIndex: result.cardIndex }));
      return { matched: false };
    }

    const matchedCandidate = candidates[index];
    const matchedCard = await getCardById(matchedCandidate.id, domainId);
    if (!matchedCard || matchedCard.status !== "PUBLISHED") {
      logger.warn(tApp("analysis.dimension.hot-report-matcher.141", { id: matchedCandidate.id }));
      return { matched: false };
    }
    if (agentId && matchedCard.agentId !== agentId) {
      logger.warn(tApp("analysis.dimension.hot-report-matcher.142", { id: matchedCandidate.id }));
      return { matched: false };
    }
    const queryRunEntries = await Promise.all(
      matchedCard.dimensions.flatMap((dimension) =>
        dimension.subQuestions.map(async (question) => {
          if (!question.queryRunRef) return [question.id, undefined] as const;
          try {
            const run = await getQueryRunBySource(question.queryRunRef);
            return [question.id, run || undefined] as const;
          } catch (error) {
            logger.warn(tApp("analysis.dimension.hot-report-matcher.143"), {
              cardId: matchedCard.id,
              subQuestionId: question.id,
              error: String(error),
            });
            return [question.id, undefined] as const;
          }
        })
      )
    );
    logger.info(
      tApp("analysis.dimension.hot-report-matcher.144", { id: matchedCard.id, slice: matchedCard.question.slice(0, 50) })
    );
    return {
      matched: true,
      card: matchedCard,
      queryRunsByQuestionId: Object.fromEntries(queryRunEntries),
    };
  } catch (error) {
    logger.error(tApp("analysis.dimension.hot-report-matcher.145"), { error: String(error) });
    return { matched: false };
  }
}
