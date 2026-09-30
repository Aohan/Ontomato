import { tApp } from "../../../i18n";
import { createModel } from "../../../config/model-factory";
import { modelAgentName } from "../../../logging/model-agents";
import { renderPrompt } from "../../../core/prompts/loader";
import { createLogger } from "../../../logging/logger";
import { interpretHotJudgeReply } from "./hot-data-utils";
import type { HotJudgeResult } from "./hot-data-utils";

const logger = createLogger("hot-data-static");

/**
 * Decides whether the "static business cards" are already sufficient to answer the question (fixed metrics)
 *
 * Static-card judgment is looser:
 * 1. Conclusion first: a card with a clear displayable conclusion already counts as a candidate
 * 2. The "coverage >= user need" direction is allowed (user asks top5, card has top10 = OK)
 * 3. The reverse is not allowed (user asks top10, card only has top5 = FAIL)
 */
export async function judgeAndAnswerByStaticDocs(params: {
  question: string;
  docs: string[];
  bizKnowledge?: string;
  signal?: AbortSignal;
}): Promise<HotJudgeResult> {
  const { question, docs, bizKnowledge, signal } = params;

  const prompt = renderPrompt("data-query.hot-data-static.user", {
    bizKnowledge: (bizKnowledge || "").trim(),
    docsContent: docs
      .map((d, i) => tApp("queryFixed.254") + (i + 1) + ">\n" + d + tApp("queryFixed.255") + (i + 1) + ">")
      .join("\n\n"),
    question,
  });

  const model = await createModel({ agentName: modelAgentName("hotDataStatic") });
  const response = await model.invoke([{ role: "user", content: prompt }], {
    signal,
  });

  const verdict = interpretHotJudgeReply(response.content);
  if (verdict.sufficient) {
    logger.debug(tApp("queryFixed.253", { v0: (verdict.cards.length) }));
  }
  return verdict;
}
