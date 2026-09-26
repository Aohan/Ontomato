import { tApp } from "../../../i18n";
import { createModel } from "../../../config/model-factory";
import { modelAgentName } from "../../../logging/model-agents";
import { renderPrompt } from "../../../core/prompts/loader";
import { createLogger } from "../../../logging/logger";
import { interpretHotJudgeReply } from "./hot-data-utils";
import type { HotJudgeResult } from "./hot-data-utils";

const logger = createLogger("hot-data-static");

/**
 * 判断"静态业务卡片"是否已经足够回答问题（固定指标）
 *
 * 静态卡片判断更宽松：
 * 1. 结论优先：卡片已有清晰可展示结论即可视为候选
 * 2. 允许"覆盖范围 >= 用户需求"方向（用户要 top5，卡片有 top10 = OK）
 * 3. 不允许反向（用户要 top10，卡片只有 top5 = FAIL）
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

  const model = createModel({ agentName: modelAgentName("hotDataStatic") });
  const response = await model.invoke([{ role: "user", content: prompt }], {
    signal,
  });

  const verdict = interpretHotJudgeReply(response.content);
  if (verdict.sufficient) {
    logger.debug(tApp("queryFixed.253", { v0: (verdict.cards.length) }));
  }
  return verdict;
}
