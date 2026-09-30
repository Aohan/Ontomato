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

  // Query failure errors already live in the execution facts and are shown by the execution view; like live mode, they are no longer copied into the body.
  return {
    ...baseSnapshot,
    status: "failed" as const,
    primaryText: queryResult?.error
      ? baseSnapshot.primaryText
      : baseSnapshot.primaryText || errorMsg,
  };
}

/**
 * Response Node - handles the final reply uniformly
 *
 * Responsibilities:
 * 1. Aggregates the results of each node (query/analysis/visualization)
 * 2. Handles error cases
 * 3. Generates the final reply and returns messages
 * 4. Ensures exactly one assistant message when a historical session loads
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

  // Check for errors
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

  // Build the final reply content
  const responseParts: string[] = [];
  const queryResult = responseArtifacts.queryResult;

  // 1. When query results (ABC) exist, add the query content
  if (queryResult?.fullContent) {
    responseParts.push(queryResult.fullContent);
  }

  // 2. Ordinary analysis results are not added to content; they reach the frontend separately through analysisResult
  // to avoid: analysis results inside content + analysis results inside the analysisResult field = rendered twice

  // 3. Visualization results need no text addition (the frontend handles them separately);
  // visualizationHTML travels separately through the runtime artifact

  // Merge the final reply (visualization-only or analysis-only scenarios need no text content)
  const finalContent = responseParts.length > 0 ? responseParts.join("\n\n") : "";

  logger.debug(tApp("queryFixed.49"), {
    threadId: state.threadId,
    requestSeq,
    finalContentLength: finalContent.length,
    nodeCount: Array.isArray(queryResult?.nodeIds) ? queryResult.nodeIds.length : 0,
  });

  // Create the AI message (for persistence)
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
