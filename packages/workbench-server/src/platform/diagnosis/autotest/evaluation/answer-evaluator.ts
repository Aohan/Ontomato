import type { EvaluationResult } from "@ontomato/contracts/autotest";
/**
 * LLM-based answer correctness evaluator.
 *
 * Compares the final answer snapshot from a test case execution against the
 * expected answer using an LLM with structured XML output. The evaluation result
 * never blocks the run -- failures are captured in EvaluationResult.error.
 *
 * Reference: ragchat-server autotest src/llm/core/evaluator.py
 */

import { createModel } from "../../../../config/model-factory";
import { modelAgentName } from "../../../../logging/model-agents";
import { renderPrompt } from "../../../../core/prompts/loader";
import { createLogger } from "../../../../logging/logger";
import {
  extractTextFromContent,
  loadEvaluationProtocol,
  parseConclusionFromOutput,
  type EvaluationProtocol,
} from "./conclusion-parser";

const logger = createLogger("autotest:evaluator");

/** Timeout for a single evaluation LLM call (30 seconds). */
const EVALUATION_TIMEOUT_MS = 30_000;

function buildUserPrompt(
  { inputTags }: EvaluationProtocol,
  question: string,
  judgment: string,
  expectedAnswer: string,
  finalAnswerSnapshot: string,
  expectedLogic?: string,
  actualLogicMarkdown?: string
): string {
  const expectedAnswerBlock = expectedAnswer?.trim()
    ? `<${inputTags.expectedAnswer}>\n${expectedAnswer}\n</${inputTags.expectedAnswer}>`
    : "";

  let expectedLogicBlock = "";
  if (expectedLogic?.trim()) {
    expectedLogicBlock = `<${inputTags.expectedLogic}>\n${expectedLogic}\n</${inputTags.expectedLogic}>`;
  }

  let actualLogicBlock = "";
  if (actualLogicMarkdown?.trim()) {
    const truncated =
      actualLogicMarkdown.length > 8000
        ? actualLogicMarkdown.slice(0, 8000) + "\n...(truncated)"
        : actualLogicMarkdown;
    actualLogicBlock = `<${inputTags.actualLogic}>\n${truncated}\n</${inputTags.actualLogic}>`;
  }

  return renderPrompt("autotest.answer-evaluator.user", {
    question,
    judgment,
    expectedAnswerBlock,
    finalAnswerSnapshot,
    expectedLogicBlock,
    actualLogicBlock,
  });
}

// ---- Public API --------------------------------------------------------

export interface AnswerEvaluateInput {
  question: string;
  /**
   * Optional reference answer. When provided it is used as an extra comparison
   * baseline; when omitted the judgment criteria are the sole basis.
   */
  expectedAnswer?: string;
  finalAnswerSnapshot: string;
  /** Judgment criteria from the test case. Evaluation only runs when it is set. */
  judgment: string;
  /** Expected query logic from the test case. */
  expectedLogic?: string;
  /** Actual query logic extracted from backend diagnostic evidence (Markdown format). */
  actualLogicMarkdown?: string;
}

/**
 * Evaluate whether the final answer snapshot matches the expected answer using LLM.
 *
 * - Uses createModel with agentName so the call is automatically logged to
 *   the LLM JSONL log.
 * - Times out after 30 seconds via AbortSignal.timeout.
 * - Never throws: failures are captured in EvaluationResult.error with
 *   passed = undefined.
 */
export async function evaluateAnswer(input: AnswerEvaluateInput): Promise<EvaluationResult> {
  const {
    question,
    expectedAnswer = "",
    finalAnswerSnapshot,
    judgment,
    expectedLogic,
    actualLogicMarkdown,
  } = input;

  if (!judgment.trim()) {
    return { passed: undefined, error: "judgment is empty" };
  }
  if (!finalAnswerSnapshot?.trim()) {
    return { passed: undefined, error: "finalAnswerSnapshot is empty" };
  }

  try {
    const model = await createModel({ agentName: modelAgentName("answerEvaluator"), temperature: 0, stream: false });

    const protocol = loadEvaluationProtocol();
    const userPrompt = buildUserPrompt(
      protocol,
      question,
      judgment,
      expectedAnswer,
      finalAnswerSnapshot,
      expectedLogic,
      actualLogicMarkdown
    );

    const result = await model.invoke(
      [
        { role: "system", content: renderPrompt("autotest.answer-evaluator.system") },
        { role: "user", content: userPrompt },
      ],
      { signal: AbortSignal.timeout(EVALUATION_TIMEOUT_MS) }
    );

    const outputText = extractTextFromContent(result.content);

    if (!outputText.trim()) {
      logger.warn("Answer evaluation returned empty output", { question: question.slice(0, 60) });
      return { passed: undefined, error: "LLM returned empty output" };
    }

    const parsed = parseConclusionFromOutput(outputText, protocol);
    if (!parsed) {
      logger.warn("Answer evaluation failed to parse conclusion", {
        question: question.slice(0, 60),
        outputLength: outputText.length,
      });
      return { passed: undefined, error: "Failed to parse conclusion from LLM output" };
    }

    logger.info("Answer evaluation completed", {
      question: question.slice(0, 60),
      passed: parsed.passed,
    });

    return {
      passed: parsed.passed,
      answerSummary: parsed.answerSummary,
      analysis: parsed.analysis,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("Answer evaluation failed", { error: errorMessage });
    return { passed: undefined, error: errorMessage };
  }
}
