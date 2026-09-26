import { tApp } from "../../../i18n";
import { createModel } from "../../../config/model-factory";
import { modelAgentName } from "../../../logging/model-agents";
import { renderPrompt } from "../../../core/prompts/loader";
import { createLogger } from "../../../logging/logger";
import { interpretHotJudgeReply } from "./hot-data-utils";
import type { HotJudgeResult } from "./hot-data-utils";

const logger = createLogger("hot-data-dynamic");

/**
 * 判断"热数据片段 + 业务知识"是否足以完整回答问题（动态指标）
 *
 * 动态指标判断更严格：
 * 1. 结果形式必须匹配（用户要数字，卡片给列表 = 不匹配）
 * 2. 核心实体必须对齐（用户问科研经费，卡片是教职工人数 = 不匹配）
 * 3. 约束条件必须完备（用户每个条件，卡片必须显性包含且值一致）
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

  const model = createModel({ agentName: modelAgentName("hotDataDynamic") });
  const response = await model.invoke([{ role: "user", content: prompt }], {
    signal,
  });

  const verdict = interpretHotJudgeReply(response.content);
  if (verdict.sufficient) {
    logger.debug(tApp("queryFixed.244", { v0: (verdict.cards.length) }));
  }
  return verdict;
}
