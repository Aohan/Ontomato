/**
 * 维度形态的收口阶段：把已有产物组装成最终报告正文，写会话消息。
 *
 * 收口无论成功还是失败都要发生——失败时以错误正文写会话消息；
 * 任务详情的"对话"回看由读取侧从 `analysis_payload` 派生，这里不再另写一份快照。
 */

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { getCheckpointer } from "../../../infrastructure/connection";
import { createLogger } from "../../../logging/logger";
import { buildDeepAnalysisMarkdown } from "../task/task-result";

import type { DeepAnalysisArtifactStore } from "../task/artifacts";
import type { DimensionRunContext, DimensionStageError } from "./context";
import { tApp } from "../../../i18n";


const logger = createLogger("deep-analysis-finalize");

/**
 * 会话消息：拆图之前由 LangGraph 把 messages 通道写进 checkpoint，
 * 现在由收口阶段显式写同一条通道，观测的问答文本与线程消息读取路径不变。
 */
function saveThreadMessages(
  ctx: DimensionRunContext,
  historicalMessages: Array<HumanMessage | AIMessage>,
  answer: string
): void {
  const checkpointer = getCheckpointer();
  if (!checkpointer) return;

  checkpointer
    .putThreadMessages(ctx.threadId, [
      ...historicalMessages,
      new HumanMessage(ctx.userQuestion),
      new AIMessage({ content: answer, additional_kwargs: { requestSeq: ctx.requestSeq } }),
    ])
    .catch((error) => {
      logger.error(tApp("analysis.dimension.finalize.119"), {
        threadId: ctx.threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

export async function runFinalizeStage(
  ctx: DimensionRunContext,
  store: DeepAnalysisArtifactStore,
  input: {
    upstreamErrors: DimensionStageError[];
    historicalMessages: Array<HumanMessage | AIMessage>;
  }
): Promise<{ errors: DimensionStageError[] }> {
  const artifacts = store.current();

  if (input.upstreamErrors.length > 0 || !artifacts) {
    const errorMsg = input.upstreamErrors[0]?.message || tApp("analysis.dimension.finalize.120");
    logger.warn(tApp("analysis.dimension.finalize.121"), { taskId: ctx.taskId, error: errorMsg });
    saveThreadMessages(ctx, input.historicalMessages, errorMsg);
    return { errors: [{ node: "response", message: errorMsg, timestamp: Date.now() }] };
  }

  const finalContent = buildDeepAnalysisMarkdown(artifacts);
  saveThreadMessages(ctx, input.historicalMessages, finalContent);

  return { errors: [] };
}
