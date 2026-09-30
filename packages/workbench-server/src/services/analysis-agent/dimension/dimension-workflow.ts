/**
 * Runtime of the dimension execution form.
 *
 * An analysis advances through four stages — "select plan → per-dimension evidence and reports → comprehensive summary → finalization" — with each
 * stage's outputs passed explicitly by the orchestrator. Presentation facts are published progressively through the task artifact accumulator; an error
 * from any stage is aggregated and thrown after finalization, handing lifecycle notifications to the task orchestrator.
 *
 * Like the loop form it never enters a graph: LangGraph is reserved for the standard query main graph.
 */

import { PendingLateFacts } from "../../data-query/late-fact";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { getCheckpointer, initializeConnection } from "../../../infrastructure/connection";
import { buildTurnIdentity, runWithLogContext } from "../../../logging/log-context";
import { createLogger } from "../../../logging/logger";
import { recordTurnRunFinish, recordTurnRunStart } from "../../turn-run/turn-run-store";
import { allocateRequestSeq } from "../../chat/thread-store";
import type { DeepAnalysisEmittedEvent } from "@ontomato/contracts/analysis-events";

import type { DeepAnalysisTaskPayload } from "@ontomato/contracts/analysis-presentation";
import { createDeepAnalysisArtifactStore } from "../task/artifacts";
import type { AnalysisRunIdentity } from "../task/run-history";
import type { DimensionRunContext, DimensionStageError } from "./context";
import { runAnalysisStage } from "./execute";
import { runFinalizeStage } from "./finalize";
import { runSummaryStage } from "./summary";
import { tApp } from "../../../i18n";


const logger = createLogger("deep-analysis-workflow");

/** Maximum number of historical messages carried into a deep-analysis review. */
const MAX_HISTORY_MESSAGES = 10;

interface RunDeepAnalysisWorkflowParams {
  userQuestion: string;
  userId?: string;
  domainId: string;
  threadId?: string;
  taskId?: string;
  /** Run identity captured at acceptance; artifacts and terminal states use it to confirm the current task is still writable. */
  identity?: AnalysisRunIdentity;
  onEvent?: (event: DeepAnalysisEmittedEvent) => void;
  token?: string;
  apiKey?: string;
  agentId?: string;
  summarizerPrompt?: string;
  conclusionMakerPrompt?: string;
  analysisDimensionPrompt?: string;
  enabledSkillIds?: string[];
  enabledVisualizationSkillIds?: string[];
  signal?: AbortSignal;
}

/** Context of a deep-analysis review: only the most recent entries; a read failure continues without history. */
async function loadHistoricalMessages(
  threadId: string,
  requestSeq: number
): Promise<Array<HumanMessage | AIMessage>> {
  const checkpointer = getCheckpointer();
  if (!checkpointer || requestSeq <= 0) return [];

  try {
    const rawMessages = await checkpointer.getThreadMessages(threadId);
    const historicalMessages: Array<HumanMessage | AIMessage> = [];
    for (const message of rawMessages.slice(-MAX_HISTORY_MESSAGES)) {
      if (message.role === "user") historicalMessages.push(new HumanMessage(message.content));
      else if (message.role === "assistant")
        historicalMessages.push(new AIMessage(message.content));
    }

    logger.debug(tApp("analysis.dimension.dimension-workflow.89", { length: historicalMessages.length }));
    return historicalMessages;
  } catch (error) {
    logger.error(tApp("analysis.dimension.dimension-workflow.90", { error: error }));
    return [];
  }
}

export async function runDeepAnalysisWorkflow(
  params: RunDeepAnalysisWorkflowParams
): Promise<DeepAnalysisTaskPayload | undefined> {
  const {
    userQuestion,
    userId = "default-user",
    domainId,
    threadId = `thread-${Date.now()}`,
    taskId,
    identity,
    onEvent,
    token,
    apiKey,
    agentId,
    summarizerPrompt,
    conclusionMakerPrompt,
    analysisDimensionPrompt,
    enabledSkillIds,
    enabledVisualizationSkillIds,
    signal,
  } = params;
  logger.debug(tApp("analysis.dimension.dimension-workflow.91", { userQuestion: userQuestion, agentId: String(agentId) }));

  await initializeConnection();
  if (!agentId) {
    throw new Error("Cannot resolve system model configuration domain: agentId is required");
  }

  const requestSeq = await allocateRequestSeq(threadId);
  await recordTurnRunStart({ threadId, requestSeq, source: "analysis" });
  const turn = buildTurnIdentity(threadId, requestSeq);

  return runWithLogContext(
    { domainId, turn, token: token || undefined, apiKey: apiKey || undefined },
    async () => {
    const store = createDeepAnalysisArtifactStore({
      taskId,
      identity,
      requestSeq,
      executionMode: "dimension",
      emit: onEvent,
    });
    const historicalMessages = await loadHistoricalMessages(threadId, requestSeq);

    const ctx: DimensionRunContext = {
      lateFacts: new PendingLateFacts(),
      userQuestion,
      userId,
      threadId,
      taskId,
      requestSeq,
      agentId,
      domainId,
      token: token || "",
      apiKey: apiKey || "",
      summarizerPrompt: summarizerPrompt || "",
      conclusionMakerPrompt: conclusionMakerPrompt || "",
      analysisDimensionPrompt,
      enabledSkillIds: enabledSkillIds || [],
      enabledVisualizationSkillIds,
      signal,
      sendEvent: (event) => onEvent?.(event),
    };

    try {
      const errors: DimensionStageError[] = [];

      const analysis = await runAnalysisStage(ctx, store);
      errors.push(...analysis.errors);

      // No summary is generated when upstream already failed, matching the pre-split "skip summary on upstream error".
      const summary =
        errors.length > 0 || !analysis.summaryInput
          ? { errors: [] }
          : await runSummaryStage(ctx, store, analysis.summaryInput);
      errors.push(...summary.errors);

      const finalize = await runFinalizeStage(ctx, store, {
        upstreamErrors: [...errors],
        historicalMessages,
      });
      errors.push(...finalize.errors);

      if (errors.length > 0) {
        const messages: string[] = [];
        for (const error of errors) {
          const message = String(error.message || tApp("analysis.dimension.dimension-workflow.92"));
          if (!messages.includes(message)) messages.push(message);
        }
        throw new Error(messages.join(tApp("analysis.dimension.abc-replay.39")));
      }

      logger.debug(tApp("analysis.dimension.dimension-workflow.93"));
      await recordTurnRunFinish({
        threadId,
        requestSeq,
        status: signal?.aborted ? "cancelled" : "completed",
      });
      return await store.finish(signal?.aborted ? "cancelled" : "completed");
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(tApp("analysis.dimension.dimension-workflow.94"), errorMessage);

      logger.warn(tApp("analysis.dimension.dimension-workflow.95"));
      await recordTurnRunFinish({
        threadId,
        requestSeq,
        status: signal?.aborted ? "cancelled" : "failed",
      });
      await store.finish(signal?.aborted ? "cancelled" : "failed", errorMessage);
      throw error;
    }
  });
}
