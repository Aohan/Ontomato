import type { CaseVerdict } from "@ontomato/contracts/autotest";
import type { CaseResult } from "../types";
import { t } from "../../../../i18n";

type VerdictInput = Pick<CaseResult, "status" | "error" | "answerEvaluation">;

export function getCaseVerdict(
  result: Pick<CaseResult, "status" | "answerEvaluation">
): CaseVerdict {
  if (result.status !== "success") return "abnormal";

  if (result.answerEvaluation?.passed === true) return "correct";
  if (result.answerEvaluation?.passed === false) return "wrong";
  return "abnormal";
}

export function getCaseVerdictLabel(verdict: CaseVerdict): string {
  switch (verdict) {
    case "correct":
      return t("autotest.verdict.correct");
    case "wrong":
      return t("autotest.verdict.wrong");
    case "abnormal":
      return t("autotest.verdict.abnormal");
  }
}

export function getCaseVerdictReason(result: VerdictInput): string {
  if (result.status === "cancelled") return t("autotest.verdict.reason.cancelled");
  if (result.status === "error") return result.error || t("autotest.verdict.reason.execAbnormal");
  if (result.status === "failed") return result.error || t("autotest.verdict.reason.execFailed");
  if (result.status !== "success")
    return result.error || t("autotest.verdict.reason.execIncomplete");

  if (!result.answerEvaluation) return t("autotest.verdict.reason.missingEval");
  if (result.answerEvaluation.passed === undefined) {
    return result.answerEvaluation.error || t("autotest.verdict.reason.evalAbnormal");
  }
  if (result.answerEvaluation.passed === false) {
    return result.answerEvaluation.analysis || t("autotest.verdict.reason.evalWrong");
  }
  return "";
}
