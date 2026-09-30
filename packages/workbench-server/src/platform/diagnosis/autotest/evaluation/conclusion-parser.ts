/**
 * Shared XML conclusion parser for LLM evaluation outputs.
 *
 * Parses structured XML responses from evaluation LLMs.
 */

import { z } from "zod";
import { loadPromptProtocol } from "../../../../core/prompts/loader";

// ---- XML parsing -------------------------------------------------------

/**
 * The XML protocol agreed with the evaluation prompt, stored next to the prompt (`answer-evaluator/protocol.json`),
 * assembled from each edition's content: the open-source English labels, the enterprise Chinese labels. Parsing accepts only this edition's protocol.
 */
const evaluationProtocolSchema = z
  .object({
    inputTags: z.object({
      expectedAnswer: z.string().min(1),
      expectedLogic: z.string().min(1),
      actualLogic: z.string().min(1),
    }),
    outputTags: z.object({
      answerSummary: z.string().min(1),
      analysis: z.string().min(1),
      verdict: z.string().min(1),
    }),
    verdicts: z.object({ passed: z.string().min(1), failed: z.string().min(1) }),
    /** Cases with an empty judgment or one equal to this value take the "any result passes" path and never call the evaluation model. */
    defaultJudgment: z.string().min(1),
  })
  .strict();

export type EvaluationProtocol = z.infer<typeof evaluationProtocolSchema>;

export function loadEvaluationProtocol(): EvaluationProtocol {
  return evaluationProtocolSchema.parse(loadPromptProtocol("autotest.answer-evaluator.protocol"));
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tagContent = (tag: string, content: string) =>
  new RegExp(`<${escapeRegExp(tag)}>\\s*${content}\\s*<\\/${escapeRegExp(tag)}>`, "s");

export interface ParsedEvaluationConclusion {
  passed: boolean;
  answerSummary?: string;
  analysis?: string;
}

/**
 * Parse the verdict (the protocol's passed / failed value) from an LLM evaluation output.
 *
 * Returns null if the required XML conclusion tag is missing.
 */
export function parseConclusionFromOutput(
  output: string,
  protocol: EvaluationProtocol
): ParsedEvaluationConclusion | null {
  const { outputTags, verdicts } = protocol;
  const verdictValues = `(${escapeRegExp(verdicts.passed)}|${escapeRegExp(verdicts.failed)})`;
  // Primary: XML tag
  const xmlMatch = tagContent(outputTags.verdict, verdictValues).exec(output);
  if (xmlMatch) {
    const answerSummaryMatch = tagContent(outputTags.answerSummary, "([\\s\\S]*?)").exec(output);
    const analysisMatch = tagContent(outputTags.analysis, "([\\s\\S]*?)").exec(output);
    const answerSummary = answerSummaryMatch?.[1]?.trim();
    const analysis = analysisMatch?.[1]?.trim();
    return {
      passed: xmlMatch[1] === verdicts.passed,
      answerSummary,
      analysis,
    };
  }

  return null;
}

/**
 * Extract text content from an LLM message result.
 *
 * Handles string content, array content (multi-part messages),
 * and other formats by falling back to String conversion.
 */
export function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object" && "text" in c) {
          return String((c as { text: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return String(content ?? "");
}
