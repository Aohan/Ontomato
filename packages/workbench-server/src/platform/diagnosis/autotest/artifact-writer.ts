import type { TestCase } from "@ontomato/contracts/autotest";
import type { CaseResult } from "./types";
/**
 * Autotest-only artifact writers.
 *
 * Shared workspace digestion lives in workspace-artifact. This module keeps the
 * evaluation report owned by the autotest runner.
 */

import fs from "node:fs";
import { getCaseVerdict, getCaseVerdictLabel } from "./results/verdict";
import { tApp } from "../../../i18n";


/**
 * Write a human-readable evaluation report to the caller-provided path.
 */
export function writeEvaluationReport(
  reportPath: string,
  caseResult: CaseResult,
  testCase: TestCase
): void {
  fs.writeFileSync(reportPath, buildEvaluationMarkdown(caseResult, testCase), "utf-8");
}

function buildEvaluationMarkdown(caseResult: CaseResult, testCase: TestCase): string {
  const evaluation = caseResult.answerEvaluation;
  return [
    tApp("diag.autotest.artifact-writer.0"),
    "",
    tApp("diag.autotest.artifact-writer.1"),
    "",
    getCaseVerdictLabel(getCaseVerdict(caseResult)),
    "",
    tApp("diag.autotest.artifact-writer.2"),
    "",
    markdownBlock(evaluation?.answerSummary),
    "",
    tApp("diag.autotest.artifact-writer.3"),
    "",
    markdownBlock(evaluation?.analysis ?? evaluation?.error),
    "",
    tApp("diag.autotest.artifact-writer.4"),
    "",
    tApp("diag.autotest.artifact-writer.5"),
    "",
    markdownBlock(testCase.expectedAnswer),
    "",
    tApp("diag.autotest.artifact-writer.6"),
    "",
    markdownBlock(testCase.judgment),
    "",
    tApp("diag.autotest.artifact-writer.7"),
    "",
    markdownBlock(testCase.expectedLogic),
    "",
  ].join("\n");
}

function markdownBlock(value: string | undefined): string {
  const text = value?.trim();
  return text ? text : tApp("diag.autotest.artifact-writer.8");
}
