import type { EvaluationResult, TestCase, CaseStatus } from "@ontomato/contracts/autotest";
import type { WorkspaceArtifactResult } from "../../observe/workspace-artifact/post-processor";
import type { CaseResult } from "../types";
/**
 * Single case execution pipeline.
 *
 * 1. Generate unique threadId
 * 2. Execute the data-agent workflow directly (runDataAgentWorkflow, no HTTP)
 * 3. Aggregate response text, snapshot it, and extract turnKey from the workflow result
 * 4. Wait briefly for backend log files/API buffers to flush, then post-process the case artifact
 * 5. Run answer evaluation (using the default judgment when omitted; logic check is folded in here)
 * 6. Write evaluation report, return CaseResult
 *
 * Stage transitions are reported via the optional `onStep` callback so callers
 * can surface progress during the otherwise-silent execution window.
 */

import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "../../../../logging/logger";
import { autotestConfig } from "../config";
import { evaluateAnswer } from "../evaluation/answer-evaluator";
import { loadEvaluationProtocol } from "../evaluation/conclusion-parser";
import { executeApiChat } from "../strategies/api-chat";
import { toResponseSnapshotMarkdown } from "../../observe/workspace-artifact/post-processor";
import { buildTurnEvidenceWorkspace } from "../../observe/workspaces/turn-evidence-workspace";

import { writeEvaluationReport } from "../artifact-writer";
import { withRunArtifactWrite } from "../results/store";
import { runWithLogContext } from "../../../../logging/log-context";
import { tApp } from "../../../../i18n";


const logger = createLogger("autotest:single-case");

function installedDefaultJudgment(): string {
  return loadEvaluationProtocol().defaultJudgment;
}

export interface SingleCaseOptions {
  domainId: string;
  runId: string;
  testCase: TestCase;
  userId?: string;
  tk?: string;
  signal?: AbortSignal;
  caseTimeoutMs?: number;
  /**
   * Stage-level progress callback (workflow node switches + this pipeline's
   * own stages). Side-effect only; guarded so failures never affect execution.
   */
  onStep?: (label: string) => void;
}

export async function executeSingleCase(options: SingleCaseOptions): Promise<CaseResult> {
  const { runId, testCase, userId, domainId, tk, signal, caseTimeoutMs, onStep } = options;
  return runWithLogContext({ domainId, token: tk }, async () => {
    const threadId = `autotest-${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const reportStep = (label: string): void => {
    if (!onStep) return;
    try {
      onStep(label);
    } catch (err) {
      logger.warn("onStep callback threw (ignored)", {
        runId,
        caseId: testCase.caseId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  logger.info("Case started", {
    runId,
    caseId: testCase.caseId,
    threadId,
    questionLength: testCase.question.length,
  });

  const startTime = Date.now();

  try {
    reportStep(tApp("diag.autotest.runner.single-case.0"));
    const execResult = await executeApiChat({
      question: testCase.question,
      threadId,
      userId,
      domainId,
      tk,
      signal,
      caseTimeoutMs,
      // Forwards workflow node switches (query data / analyze data / generate charts) upward.
      onStep: reportStep,
    });

    const effectiveTestCase = withDefaultJudgment(testCase);
    const status = mapExecutionStatus(execResult.status);
    const finalAnswerSnapshot =
      execResult.finalAnswer === undefined
        ? undefined
        : toResponseSnapshotMarkdown(execResult.finalAnswer).content;

    const result: CaseResult = {
      runId,
      caseId: testCase.caseId,
      threadId,
      status,
      question: testCase.question,
      finalAnswer: finalAnswerSnapshot,
      turnKey: execResult.turnKey,
      durationMs: execResult.durationMs,
      error: execResult.error,
    };

    // --- Wait briefly for backend log files/API buffers to flush --------
    //
    // Timeout cases keep waiting here because api-chat owns their internal
    // timeout signal. A user stop only stops waiting for this promise; the
    // already-produced Turn evidence continues in the background.

    let ppResult: WorkspaceArtifactResult | undefined;
    if (result.turnKey) {
      if (!signal?.aborted) reportStep(tApp("diag.autotest.runner.single-case.1"));

      const postProcess = withRunArtifactWrite(runId, async () => {
        await delay(10_000);
        if (!signal?.aborted) reportStep(tApp("diag.autotest.runner.single-case.2"));
        return safePostProcess(result, effectiveTestCase, runId, domainId, tk);
      });
      ppResult = signal
        ? await Promise.race([postProcess, waitForAbort(signal)])
        : await postProcess;
    }

    // --- Run evaluation (after post-processing, with logic context) -----

    reportStep(tApp("diag.autotest.runner.single-case.3"));
    const answerEvaluation = await runAnswerEvaluation(
      effectiveTestCase,
      result.finalAnswer,
      ppResult?.logicMarkdown
    );
    if (answerEvaluation) {
      result.answerEvaluation = answerEvaluation;
    }

    logger.info("Case completed", {
      runId,
      caseId: testCase.caseId,
      threadId,
      status,
      durationMs: execResult.durationMs,
      answerLength: result.finalAnswer?.length ?? 0,
      answerEvalPassed: answerEvaluation?.passed,
    });

    // --- Write evaluation report (after evaluation) --------------------

    if (ppResult) {
      safeWriteEvaluationReport(ppResult, result, effectiveTestCase);
    }

    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("Case execution failed unexpectedly", {
      runId,
      caseId: testCase.caseId,
      threadId,
      error: errorMessage,
    });

    return {
      runId,
      caseId: testCase.caseId,
      threadId,
      status: "error",
      question: testCase.question,
      durationMs: Date.now() - startTime,
      error: errorMessage,
    };
  }
  });
}

function mapExecutionStatus(execStatus: "success" | "error" | "cancelled"): CaseStatus {
  switch (execStatus) {
    case "success":
      return "success";
    case "cancelled":
      return "cancelled";
    case "error":
    default:
      return "error";
  }
}

// ---- Helpers (never throw) ----------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForAbort(signal: AbortSignal): Promise<undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(undefined), { once: true });
  });
}

async function safePostProcess(
  result: CaseResult,
  testCase: TestCase,
  runId: string,
  domainId: string,
  token?: string
): Promise<WorkspaceArtifactResult | undefined> {
  try {
    if (!result.turnKey) {
      logger.debug("No turnKey available, skipping case artifact generation", {
        caseId: result.caseId,
      });
      return undefined;
    }

    const artifactDir = path.join(autotestConfig.dataDir, "runs", runId, result.caseId);
    const evidenceResult = await buildTurnEvidenceWorkspace({
      domainId,
      workspaceId: `${runId}:${result.caseId}`,
      turnKey: result.turnKey,
      artifactDir,
      metadata: {
        targetId: result.caseId,
        source: "autotest",
        question: testCase.question,
        finalAnswer: result.finalAnswer,
        runId,
        caseId: result.caseId,
        threadId: result.threadId,
        durationMs: result.durationMs,
        error: result.error,
      },
      token,
    });
    if (evidenceResult.status !== "failed") return evidenceResult.artifactResult;
    logger.warn("Case Turn evidence workspace build failed (non-blocking)", {
      runId: result.runId,
      caseId: result.caseId,
      turnKey: result.turnKey,
      reason: evidenceResult.reason,
    });
  } catch (err) {
    logger.warn("Post-processing failed (non-blocking)", {
      caseId: result.caseId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return undefined;
}

function safeWriteEvaluationReport(
  ppResult: WorkspaceArtifactResult,
  result: CaseResult,
  testCase: TestCase
): void {
  try {
    const evaluationReportPath = path.join(ppResult.artifactDir, "evaluation.md");
    writeEvaluationReport(evaluationReportPath, result, testCase);
  } catch (err) {
    logger.warn("Evaluation data write failed", {
      caseId: result.caseId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---- Evaluation helpers (never throw) -----------------------------------

/**
 * Run answer evaluation with a non-empty judgment.
 */
async function runAnswerEvaluation(
  testCase: TestCase,
  finalAnswerSnapshot: string | undefined,
  actualLogicMarkdown?: string
): Promise<EvaluationResult | undefined> {
  const installed = installedDefaultJudgment();
  const judgment = testCase.judgment?.trim() || installed;

  if (judgment === installed) {
    const hasResult = Boolean(finalAnswerSnapshot?.trim());
    return {
      passed: hasResult,
      answerSummary: hasResult ? tApp("diag.autotest.runner.single-case.4") : tApp("diag.autotest.runner.single-case.5"),
      analysis: installed,
    };
  }

  try {
    return await evaluateAnswer({
      question: testCase.question,
      expectedAnswer: testCase.expectedAnswer,
      finalAnswerSnapshot: finalAnswerSnapshot ?? "",
      judgment,
      expectedLogic: testCase.expectedLogic,
      actualLogicMarkdown,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("Answer evaluation threw unexpectedly", {
      caseId: testCase.caseId,
      error: errorMessage,
    });
    return { passed: undefined, error: errorMessage };
  }
}

function withDefaultJudgment(testCase: TestCase): TestCase {
  return {
    ...testCase,
    judgment: testCase.judgment?.trim() || installedDefaultJudgment(),
  };
}
