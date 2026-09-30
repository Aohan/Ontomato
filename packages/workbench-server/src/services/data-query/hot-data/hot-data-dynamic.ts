import { tApp } from "../../../i18n";
import { createModel } from "../../../config/model-factory";
import { modelAgentName } from "../../../logging/model-agents";
import { renderPrompt } from "../../../core/prompts/loader";
import { createLogger } from "../../../logging/logger";
import { interpretHotJudgeReply } from "./hot-data-utils";
import type { HotJudgeResult } from "./hot-data-utils";

const logger = createLogger("hot-data-dynamic");

/**
 * Decides whether "hot data snippets + business knowledge" are sufficient to answer the question completely (dynamic metrics)
 *
 * Dynamic-metric judgment is stricter:
 * 1. Result form must match (user asks for a number, card gives a list = mismatch)
 * 2. Core entity must align (user asks research funding, card shows staff headcount = mismatch)
 * 3. Constraints must be complete (every user condition must be explicitly contained in the card with a consistent value)
 */
export async function judgeAndAnswerByDocs(params: {
  question: string;
  docs: string[];
  bizKnowledge?: string;
  signal?: AbortSignal;
}): Promise<HotJudgeResult> {
  const { question, docs, bizKnowledge, signal } = params;

  const prompt = renderPrompt("data-query.hot-data-dynamic.user", {
    bizKnowledge: (bizKnowledge || "").trim(),
    docsContent: docs
      .map((d, i) => tApp("queryFixed.245") + (i + 1) + ">\n" + d + tApp("queryFixed.246") + (i + 1) + ">")
      .join("\n\n"),
    question,
  });

  const model = await createModel({ agentName: modelAgentName("hotDataDynamic") });
  const response = await model.invoke([{ role: "user", content: prompt }], {
    signal,
  });

  const verdict = interpretHotJudgeReply(response.content);
  if (verdict.sufficient) {
    logger.debug(tApp("queryFixed.244", { v0: (verdict.cards.length) }));
  }
  return verdict;
}
