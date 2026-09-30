import type { RunEvent, RunSummary, RunCaseResult } from "@ontomato/contracts/autotest";
import { t } from "../../../i18n";

export type AutotestVerdict = Extract<RunEvent, { type: "case_end" }>["data"]["verdict"];
export type AutotestTagType = "success" | "danger" | "warning" | "info";

export type AutotestCaseLike = Partial<
  Pick<RunCaseResult, "status" | "error" | "answerEvaluation">
>;

export function getAutotestVerdict(result: AutotestCaseLike): AutotestVerdict {
  if (result.status !== "success") return "abnormal";

  if (result.answerEvaluation?.passed === true) return "correct";
  if (result.answerEvaluation?.passed === false) return "wrong";
  return "abnormal";
}

export function normalizeAutotestVerdict(value: unknown): AutotestVerdict {
  if (value === "correct" || value === "wrong" || value === "abnormal") return value;
  return "abnormal";
}

export function getAutotestVerdictLabel(verdict: AutotestVerdict): string {
  switch (verdict) {
    case "correct":
      return t("autotest.correct");
    case "wrong":
      return t("autotest.wrong");
    case "abnormal":
      return t("autotest.abnormal");
  }
}

export function getAutotestVerdictTagType(verdict: AutotestVerdict): AutotestTagType {
  switch (verdict) {
    case "correct":
      return "success";
    case "wrong":
      return "danger";
    case "abnormal":
      return "warning";
  }
}

export function getAutotestVerdictReason(result: AutotestCaseLike): string {
  if (result.status === "cancelled") return t("common.cancelled");
  if (result.status === "error") return result.error || t("autotest.execAbnormal");
  if (result.status === "failed") return result.error || t("autotest.execFailed");
  if (result.status !== "success") return result.error || t("autotest.execIncomplete");

  if (!result.answerEvaluation) return t("autotest.missingEvalConclusion");
  if (result.answerEvaluation.passed === undefined) {
    return result.answerEvaluation.error || t("autotest.evalAbnormal");
  }
  if (result.answerEvaluation.passed === false) {
    return result.answerEvaluation.analysis || t("autotest.evalWrong");
  }
  return "";
}

export function summarizeAutotestVerdicts(results: AutotestCaseLike[]): RunSummary {
  const summary: RunSummary = {
    total: results.length,
    correct: 0,
    wrong: 0,
    abnormal: 0,
  };

  for (const result of results) {
    const verdict = getAutotestVerdict(result);
    summary[verdict]++;
  }

  return summary;
}

export function formatAutotestAccuracyRate(summary: Pick<RunSummary, "total" | "correct">): string {
  if (summary.total <= 0) return "0.0";
  return ((summary.correct / summary.total) * 100).toFixed(1);
}
