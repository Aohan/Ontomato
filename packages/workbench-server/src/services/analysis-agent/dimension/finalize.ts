/**
 * Finalization stage of the dimension form: assembles existing artifacts into the final report body and writes the session message.
 *
 * Finalization happens on success and on failure alike — on failure the session message carries the error body;
 * the task detail's conversation review is derived from `analysis_payload` by the read side, so no second snapshot is written here.
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
 * Session messages: before the graph was dismantled LangGraph wrote the messages channel into the checkpoint;
 * the finalization stage now writes the same channel explicitly, keeping the observed QA text and the thread-message read path unchanged.
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
