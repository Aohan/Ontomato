import type { QueryExecutionFact } from "../../../data-query/query-fact";
import { AnalysisResult, GraphState, GraphUpdate, VisualizationResult } from "../state";
import { t, tApp } from "../../../../i18n";
import { createLogger } from "../../../../logging/logger";
import { AIMessage } from "@langchain/core/messages";
import { upsertChatRenderSnapshot } from "../../chat-snapshot-store";
import {
  resolveCurrentQueryResult,
  resolveRuntimeAnalysisResult,
  resolveRuntimeVisualizationResult,
} from "../utils/query-artifact-cache";

const logger = createLogger("response-node");

interface ResponseArtifacts {
  queryResult?: QueryExecutionFact;
  analysisResult?: AnalysisResult;
  visualizationResult?: VisualizationResult;
}

function buildHistorySnapshot(finalContent: string, artifacts: ResponseArtifacts = {}) {
  const analysisResult = artifacts.analysisResult;
  const visualizationResult = artifacts.visualizationResult;

  return {
    mode: "standard" as const,
    status: "completed" as const,
    primaryText: finalContent,
    analysisText: analysisResult?.result,
    visualizationHTML: visualizationResult?.result?.html,
  };
}

function buildClarificationSnapshot(state: GraphState) {
  return {
    mode: "standard" as const,
    status: "completed" as const,
    primaryText: "",
    clarification:
      state.clarificationResult?.status === "ambiguous"
        ? {
            message: state.clarificationResult.message || t("response.clarification"),
            options: state.clarificationResult.options || [],
          }
        : undefined,
  };
}

function buildPartialErrorSnapshot(errorMsg: string, artifacts: ResponseArtifacts = {}) {
  const queryResult = artifacts.queryResult;
  const baseSnapshot = buildHistorySnapshot(queryResult?.fullContent || "", artifacts);
  const hasPartialContent = Boolean(
    baseSnapshot.primaryText ||
    baseSnapshot.analysisText ||
    baseSnapshot.visualizationHTML ||
    (Array.isArray(queryResult?.datasets) && queryResult.datasets.length > 0)
  );

  if (!hasPartialContent) {
    return {
      mode: "error" as const,
      status: "failed" as const,
      primaryText: errorMsg,
    };
  }

  // 查询失败的错误已在执行事实里，由执行视图显示；与直播一致，不再复制进正文。
  return {
    ...baseSnapshot,
    status: "failed" as const,
    primaryText: queryResult?.error
      ? baseSnapshot.primaryText
      : baseSnapshot.primaryText || errorMsg,
  };
}

/**
 * Response Node - 统一处理最终回复
 *
 * 职责：
 * 1. 聚合各节点的结果（query/analysis/visualization）
 * 2. 处理错误情况
 * 3. 生成最终回复并返回 messages
 * 4. 确保历史会话加载时只有一条 assistant 消息
 */
export async function standardResponseNode(state: GraphState, config?: any): Promise<GraphUpdate> {
  logger.debug(tApp("queryFixed.47"), {
    threadId: state.threadId,
    requestSeq: config?.configurable?.requestSeq ?? 0,
  });

  const onEvent = config?.configurable?.onEvent;
  const requestSeq = config?.configurable?.requestSeq ?? 0;

  const sendEvent = (event: any) => {
    if (onEvent) {
      onEvent(event);
    }
  };

  sendEvent({
    type: "progress" as const,
    node: "response" as const,
    content: t("response.generatingReply"),
    timestamp: Date.now(),
  });

  const responseArtifacts: ResponseArtifacts = {
    queryResult: await resolveCurrentQueryResult(state, config),
    analysisResult: resolveRuntimeAnalysisResult(state, config),
    visualizationResult: resolveRuntimeVisualizationResult(state, config),
  };

  // 检查是否有错误
  const errors = state.errors || [];
  if (errors.length > 0) {
    const errorMsg = errors[0].message;
    const errorNode = errors[0].node;
    logger.warn(tApp("queryFixed.48"), { node: errorNode, error: errorMsg });

    const thinkingEvent = {
      type: "thinking" as const,
      node: "response" as const,
      content: `❌ ${errorMsg}`,
      timestamp: Date.now(),
    };

    const errorEvent = {
      type: "error" as const,
      node: "response" as const,
      content: errorMsg,
      timestamp: Date.now(),
    };

    sendEvent(thinkingEvent);
    sendEvent(errorEvent);

    const aiMessage = new AIMessage({
      content: responseArtifacts.queryResult?.fullContent || errorMsg,
      additional_kwargs: { requestSeq },
    });

    await upsertChatRenderSnapshot({
      threadId: state.threadId,
      requestSeq,
      snapshot: buildPartialErrorSnapshot(errorMsg, responseArtifacts),
      source: "runtime",
    });

    return {
      events: [thinkingEvent, errorEvent],
      messages: [aiMessage],
    };
  }

  if (state.clarificationResult?.status === "ambiguous") {
    const aiMessage = new AIMessage({
      content: "",
      additional_kwargs: { requestSeq },
    });

    await upsertChatRenderSnapshot({
      threadId: state.threadId,
      requestSeq,
      snapshot: buildClarificationSnapshot(state),
      source: "runtime",
    });

    return {
      messages: [aiMessage],
    };
  }

  // 构建最终回复内容
  const responseParts: string[] = [];
  const queryResult = responseArtifacts.queryResult;

  // 1. 如果有查询结果（ABC），添加查询内容
  if (queryResult?.fullContent) {
    responseParts.push(queryResult.fullContent);
  }

  // 2. 普通分析结果不添加到 content，通过 analysisResult 单独传递给前端
  // 避免：content 中包含分析结果 + analysisResult 字段也包含分析结果 = 显示两次

  // 3. 如果有可视化结果，不需要添加到文本（前端单独处理）
  // visualizationHTML 会通过 runtime artifact 单独传递

  // 合并最终回复（可视化场景或纯分析场景不需要文本内容）
  const finalContent = responseParts.length > 0 ? responseParts.join("\n\n") : "";

  logger.debug(tApp("queryFixed.49"), {
    threadId: state.threadId,
    requestSeq,
    finalContentLength: finalContent.length,
    nodeCount: Array.isArray(queryResult?.nodeIds) ? queryResult.nodeIds.length : 0,
  });

  // 创建 AI 消息（用于持久化）
  const aiMessage = new AIMessage({
    content: finalContent,
    additional_kwargs: { requestSeq },
  });

  await upsertChatRenderSnapshot({
    threadId: state.threadId,
    requestSeq,
    snapshot: buildHistorySnapshot(finalContent, responseArtifacts),
    source: "runtime",
  });
  logger.debug(tApp("queryFixed.50"), {
    threadId: state.threadId,
    requestSeq,
    nodeCount: Array.isArray(queryResult?.nodeIds) ? queryResult.nodeIds.length : 0,
  });

  const thinkingEvent = {
    type: "thinking" as const,
    node: "response" as const,
    content: t("response.generationComplete"),
    timestamp: Date.now(),
  };

  sendEvent(thinkingEvent);

  logger.debug(tApp("queryFixed.51"), {
    threadId: state.threadId,
    requestSeq,
  });

  return {
    events: [thinkingEvent],
    messages: [aiMessage],
  };
}
