/**
 * Evidence assembly of the dimension form: organizes sub-question query results into evidence for reports and charts,
 * and merges planned sub-questions with query results into persistable dimension results.
 */

import { t } from "../../../i18n";
import {
  expandQueryResultDatasetEntries,
  flattenQueryResultData,
  getQueryResultDataCount,
} from "../runtime/query-result";
import type { DimensionalizedQuestionWithResult, PlannedDimension } from "./dimension-types";
import type { AnalysisEvidence, DimensionQueryResult } from "../runtime/evidence-types";
import { tApp } from "../../../i18n";


function formatPreviewValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return t("analysis.nullValue");
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  if (typeof value === "string") {
    return value.length > 40 ? `${value.slice(0, 40)}...` : value;
  }

  return JSON.stringify(value);
}

function buildFirstRowSummary(rows: Record<string, unknown>[]): string | undefined {
  const firstRow = rows[0];
  if (!firstRow || typeof firstRow !== "object" || Array.isArray(firstRow)) return undefined;

  const entries = Object.entries(firstRow).slice(0, 3);
  if (entries.length === 0) return undefined;

  return tApp("analysis.dimension.evidence.96", { join: entries
    .map(([key, value]) => `${key}=${formatPreviewValue(value)}`)
    .join(tApp("analysis.dimension.evidence.97")) });
}

export function buildKeyFindings(result: DimensionQueryResult): string[] {
  const rows = flattenQueryResultData(result.data);
  if (rows.length === 0) {
    return [t("analysis.noValidData")];
  }

  const findings: string[] = [t("analysis.recordCount", { n: rows.length })];
  const firstRowSummary = buildFirstRowSummary(rows);
  if (firstRowSummary) findings.push(firstRowSummary);

  if (result.markdownTable) {
    findings.push(t("analysis.structuredTableHint"));
  }

  return findings;
}

export function buildKeyFindingsFromRows(rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) {
    return [t("analysis.datasetNoData")];
  }

  const findings: string[] = [t("analysis.recordCount", { n: rows.length })];
  const firstRowSummary = buildFirstRowSummary(rows);
  if (firstRowSummary) findings.push(firstRowSummary);

  return findings;
}

export function normalizeQuestionStatus(
  status: unknown
): NonNullable<DimensionalizedQuestionWithResult["status"]> {
  if (
    status === "completed" ||
    status === "failed" ||
    status === "pending" ||
    status === "running"
  ) {
    return status;
  }
  if (status === "in_progress") return "running";
  return "failed";
}

export function resolveDimensionStatus(results: Array<{ status?: string }>) {
  if (results.length === 0) return "failed" as const;
  const completedCount = results.filter((result) => result.status === "completed").length;
  if (completedCount === results.length) return "completed" as const;
  if (completedCount > 0) return "partial" as const;
  return "failed" as const;
}

function buildQuestionWithResult(
  plannedQuestion: PlannedDimension["subQuestions"][number],
  result?: DimensionQueryResult
): DimensionalizedQuestionWithResult {
  const savedQuestion = plannedQuestion as Partial<DimensionalizedQuestionWithResult>;

  if (!result) {
    const status = normalizeQuestionStatus(savedQuestion.status);
    return {
      id: plannedQuestion.id,
      dimensionId: plannedQuestion.dimensionId,
      dimensionName: plannedQuestion.dimensionName,
      dimensionValue: plannedQuestion.dimensionValue,
      subQuestion: plannedQuestion.subQuestion,
      originalQuestion:
        savedQuestion.originalQuestion ||
        plannedQuestion.originalQuestion ||
        plannedQuestion.subQuestion,
      status,
      statusText:
        savedQuestion.statusText ||
        (status === "completed" ? t("query.status.queryCompleted") : t("query.status.queryFailed")),
      data: savedQuestion.data,
      dsl: savedQuestion.dsl,
      datasets: savedQuestion.datasets,
      markdownTable: savedQuestion.markdownTable,
      dataCount:
        typeof savedQuestion.dataCount === "number"
          ? savedQuestion.dataCount
          : getQueryResultDataCount(savedQuestion.data),
      datasetPreviews: savedQuestion.datasetPreviews,
      abcSubQuestions: savedQuestion.abcSubQuestions,
      abcDsls: savedQuestion.abcDsls,
      abcCodes: savedQuestion.abcCodes,
      abcOutKeyRefs: savedQuestion.abcOutKeyRefs,
      replayPlan: savedQuestion.replayPlan,
      thinkingState: savedQuestion.thinkingState,
      cards: savedQuestion.cards,
      winner: savedQuestion.winner,
    };
  }

  return {
    id: result.questionId,
    dimensionId: result.dimensionId,
    dimensionName: result.dimensionName,
    dimensionValue: result.dimensionValue,
    subQuestion: result.subQuestion,
    originalQuestion:
      savedQuestion.originalQuestion || savedQuestion.subQuestion || result.subQuestion,
    status: normalizeQuestionStatus(result.status),
    statusText:
      result.status === "completed"
        ? t("query.status.queryCompleted")
        : result.error || t("query.status.queryFailed"),
    data: result.data,
    dsl: result.dsl,
    datasets: result.datasets,
    markdownTable: result.markdownTable || undefined,
    dataCount: getQueryResultDataCount(result.data),
    datasetPreviews: result.datasetPreviews || undefined,
    abcSubQuestions: result.abcSubQuestions || undefined,
    abcDsls: result.abcDsls || undefined,
    abcCodes: result.abcCodes || undefined,
    abcOutKeyRefs: result.abcOutKeyRefs || undefined,
    replayPlan: result.replayPlan || undefined,
    thinkingState: result.thinkingState,
    cards: result.cards,
    winner: result.winner,
  };
}

export function mergePlannedSubQuestionsWithResults(
  plannedDimension: PlannedDimension,
  queryResults: DimensionQueryResult[]
): DimensionalizedQuestionWithResult[] {
  const resultsByQuestion = new Map<string, DimensionQueryResult>();

  for (const result of queryResults) {
    resultsByQuestion.set(result.questionId, result);
  }

  return plannedDimension.subQuestions.map((question) =>
    buildQuestionWithResult(question, resultsByQuestion.get(question.id))
  );
}

/** All sub-question results of one dimension → evidence entries for reports and charts. */
export function buildDimensionEvidence(results: DimensionQueryResult[]): AnalysisEvidence[] {
  return results.flatMap((result): AnalysisEvidence[] => {
    if (result.status !== "completed") {
      return [
        {
          questionId: result.questionId,
          questionText: result.subQuestion,
          dimensionId: result.dimensionId,
          dimensionName: result.dimensionName,
          status: "failed" as const,
          data: [],
          dataCount: 0,
          markdownTable: result.markdownTable,
          keyFindings: buildKeyFindings(result),
          abcSubQuestions: result.abcSubQuestions,
          error: result.error,
        },
      ];
    }

    const datasetEntries = expandQueryResultDatasetEntries({
      data: result.data,
      dsl: result.dsl,
      datasets: result.datasets,
      datasetPreviews: result.datasetPreviews,
      baseTitle: result.subQuestion,
    });

    if (datasetEntries.length === 0) {
      return [
        {
          questionId: result.questionId,
          questionText: result.subQuestion,
          dimensionId: result.dimensionId,
          dimensionName: result.dimensionName,
          status: "completed" as const,
          data: [],
          dataCount: 0,
          markdownTable: result.markdownTable,
          keyFindings: buildKeyFindings(result),
          abcSubQuestions: result.abcSubQuestions,
          error: result.error,
        },
      ];
    }

    return datasetEntries.map((entry) => ({
      questionId: `${result.questionId}#${entry.index}`,
      questionText:
        datasetEntries.length > 1 ? tApp("analysis.dimension.evidence.98", { subQuestion: result.subQuestion, title: entry.title }) : result.subQuestion,
      dimensionId: result.dimensionId,
      dimensionName: result.dimensionName,
      status: "completed" as const,
      data: entry.data,
      dataCount: entry.dataCount,
      fieldDisplayPlan: entry.fieldDisplayPlan,
      markdownTable:
        entry.markdownTable || (datasetEntries.length === 1 ? result.markdownTable : undefined),
      keyFindings: buildKeyFindingsFromRows(entry.data),
      abcSubQuestions: result.abcSubQuestions,
      error: result.error,
    }));
  });
}

/** Input dataset of analysis skills: the raw-value dataset of every sub-question in the same dimension, expanded. */
export function buildSkillDatasets(results: DimensionQueryResult[]) {
  return results.flatMap((result) =>
    expandQueryResultDatasetEntries({
      data: result.data,
      dsl: result.dsl,
      datasets: result.datasets,
      datasetPreviews: result.datasetPreviews,
      baseTitle: result.subQuestion,
    }).map((entry) => ({
      title: entry.title,
      data: entry.data,
      dsl: entry.dsl,
      dimensionId: result.dimensionId,
      dimensionName: result.dimensionName,
      subQuestion: result.subQuestion,
    }))
  );
}
