/**
 * 维度执行形态的运行时。
 *
 * 分析按"选计划 → 逐维度取证与报告 → 综合总结 → 收口"四段推进，段与段的产物
 * 由编排器显式传递。呈现事实统一经任务产物累积器渐进发布；任一段产生错误都会
 * 在收口后聚合抛出，交给任务编排器完成生命周期通知。
 *
 * 与循环形态一样不进图：LangGraph 只保留给标准问数主图。
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

/** 深度分析回看时最多带入的历史消息条数。 */
const MAX_HISTORY_MESSAGES = 10;

interface RunDeepAnalysisWorkflowParams {
  userQuestion: string;
  userId?: string;
  domainId: string;
  threadId?: string;
  taskId?: string;
  /** 受理时捕获的运行身份；产物与终态据此确认是否仍可写当前任务。 */
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

/** 深度分析回看的上文：只带最近若干条，读取失败按无历史继续。 */
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

  return runWithLogContext({ domainId, turn }, async () => {
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

      // 上游已失败时不再生成总结，与拆图前"检测到上游错误跳过总结"一致。
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
