/**
 * Shared XML conclusion parser for LLM evaluation outputs.
 *
 * Parses structured XML responses from evaluation LLMs.
 */

import { z } from "zod";
import { loadPromptProtocol } from "../../../../core/prompts/loader";

// ---- XML parsing -------------------------------------------------------

/**
 * 评测提示词约定的 XML 协议，与提示词同目录（`answer-evaluator/protocol.json`），
 * 由各版内容装配：开源英文标签，企业中文标签。解析只认本版协议。
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
    /** 空 judgment 与等于该值的用例走「有结果即通过」，不调用评测模型。 */
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
