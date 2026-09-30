import { buildQueryRunInput, toDisplayFact } from "../../../data-query/query-fact";
import { startQualityCheckSettlement } from "../../../data-query/late-fact";
import { resolvePendingLateFacts } from "../utils/query-artifact-cache";
import type { QueryExecutionFact } from "../../../data-query/query-fact";
import { GraphState, GraphUpdate } from "../state";
import { createLogger } from "../../../../logging/logger";
import { AuthFailedError } from "../../../../utils/backend-client";
import { BRANCH_CN } from "../../../data-query/hot-data/hot-data-utils";
import { getAbcQuestionMode } from "../../../data-query/data-query-policy";
import { t, tApp } from "../../../../i18n";
import {
  createQueryArtifactRef,
  getQueryArtifactCache,
  STANDARD_QUERY_SOURCE_KIND,
  STANDARD_QUERY_SOURCE_REF,
} from "../utils/query-artifact-cache";
import { executeBaseQuery, STANDARD_QUERY_BRANCHES } from "../../../data-query/base-query-executor";
import { runtimeDefaults } from "../../../../runtime/defaults";
import type { QueryBackendSession } from "@ontomato/contracts/query-execution";
import {
  startQueryRun,
  updateQueryRunBackendSessions,
  upsertQueryRun,
  type UpsertQueryRunInput,
} from "../../../data-query/query-run-store";

const logger = createLogger("query-node");

export async function queryNode(state: GraphState, config?: any): Promise<GraphUpdate> {
  const onEvent = config?.configurable?.onEvent;
  const token = config?.configurable?.token || "";
  const apiKey = config?.configurable?.apiKey || "";
  const userId = config?.configurable?.user_id || "";
  const locale = config?.configurable?.locale || runtimeDefaults().requestLocaleFallback;
  const abcQuestionMode = getAbcQuestionMode();
  const signal = config?.signal || config?.configurable?.signal;
  const threadId = config?.configurable?.thread_id || state.threadId;
  const requestSeq = config?.configurable?.requestSeq ?? 0;
  const queryArtifactCache = getQueryArtifactCache(config);
  const shouldStoreEventsInState = !queryArtifactCache;

  const sendEvent = (event: any) => {
    if (onEvent) {
      onEvent(event);
    }
  };

  const queryStep = state.plan?.steps.find((step) => step.type === "query");
  const queryQuestion = queryStep?.type === "query" ? queryStep.question : state.userQuestion;
  const queryRunIdentity = {
    threadId,
    requestSeq,
    sourceKind: STANDARD_QUERY_SOURCE_KIND,
    sourceRef: STANDARD_QUERY_SOURCE_REF,
  };
  let backendSessions: QueryBackendSession[] = [];

  const persistQueryRun = async (message: string, operation: () => Promise<void>) => {
    try {
      await operation();
    } catch (error) {
      logger.error(message, { threadId, requestSeq, error: String(error) });
    }
  };

  // The executor hands over sessions in the contract shape; field names are not changed here.
  const reportBackendLocation = (session: QueryBackendSession) => {
    const existingIndex = backendSessions.findIndex((item) => item.branch === session.branch);
    const previous = existingIndex >= 0 ? backendSessions[existingIndex] : undefined;
    // The same branch reporting the same session is a duplicate frame: no new session fact and no second write.
    if (
      previous &&
      previous.sessionId === session.sessionId &&
      previous.nodeId === session.nodeId
    ) {
      return;
    }

    backendSessions =
      existingIndex >= 0
        ? backendSessions.map((item, index) => (index === existingIndex ? session : item))
        : [...backendSessions, session];

    void persistQueryRun(tApp("queryFixed.35"), () =>
      updateQueryRunBackendSessions({ ...queryRunIdentity, backendSessions })
    );
  };

  const finishQueryRun = async (
    queryResult: QueryExecutionFact | undefined,
    status: "completed" | "failed",
    error?: string
  ) => {
    const input: UpsertQueryRunInput = buildQueryRunInput({
      identity: { ...queryRunIdentity, sourceStage: "query" },
      question: queryQuestion,
      status,
      error,
      // Even with no facts at all the same constructor runs with empty facts — no second write constructor is introduced.
      fact: queryResult ?? {},
    });

    // The terminal state writes the same session list collected per branch during the run.
    if (backendSessions.length > 0) {
      input.backendSessions = backendSessions;
    }

    await persistQueryRun(tApp("queryFixed.36"), () => upsertQueryRun(input));
  };

  const buildQueryUpdate = (
    queryResult: QueryExecutionFact | undefined,
    events: any[],
    extra?: Partial<GraphUpdate>
  ): GraphUpdate => {
    if (!queryArtifactCache) {
      logger.warn(tApp("queryFixed.37"), {
        threadId,
        requestSeq,
      });
      return {
        ...extra,
        events,
      };
    }

    if (!queryResult) {
      return {
        ...extra,
        events: shouldStoreEventsInState ? events : [],
      };
    }

    const ref = createQueryArtifactRef({ threadId, requestSeq });
    queryArtifactCache.setQueryResult(ref, queryResult);
    return {
      ...extra,
      queryArtifactRef: ref,
      events: shouldStoreEventsInState ? events : [],
    };
  };

  const eventCollector: any[] = [];
  const pushEvent = (event: any) => {
    eventCollector.push(event);
    sendEvent(event);
  };

  try {
    pushEvent({
      type: "progress",
      node: "query",
      content: t("query.node.parallelProgress"),
      timestamp: Date.now(),
    });

    await persistQueryRun(tApp("queryFixed.38"), () =>
      startQueryRun({
        ...queryRunIdentity,
        sourceStage: "query",
        question: queryQuestion,
      })
    );

    const execution = await executeBaseQuery({
      queryQuestion,
      token,
      apiKey,
      userId,
      locale,
      abcQuestionMode,
      signal,
      enabledBranches: STANDARD_QUERY_BRANCHES,
      onEvent: pushEvent,
      onThinkingState: (thinkingState) => {
        pushEvent({
          type: "thinking_state",
          node: "query",
          content: {
            thinking: thinkingState.summary,
            mode: "replace",
            thinkingState,
          },
          timestamp: Date.now(),
        });
      },
      onBackendLocation: reportBackendLocation,
    });
    if (!execution.winner) {
      const fallback = execution.abcFallback;
      const error = execution.error;
      const errorMsg = error.message;
      logger.error(tApp("queryFixed.39"), {
        error: errorMsg,
        question: queryQuestion,
        threadId: config?.configurable?.thread_id,
      });

      const fallbackContent = fallback?.content;
      const fallbackDatasets = fallback?.datasets || [];
      const fallbackNodeIds = fallback?.nodeIds || [];
      const fallbackQueryResult: QueryExecutionFact | undefined =
        fallbackContent || fallbackDatasets.length > 0 || execution.thinkingSummary
          ? {
              fullContent: fallbackContent || undefined,
              thinkingSummary: execution.thinkingSummary,
              thinkingSteps: execution.thinkingSteps,
              thinkingState: execution.thinkingState,
              nodeIds: fallbackNodeIds.length > 0 ? fallbackNodeIds : undefined,
              abcSubQuestions: fallback?.subQuestions,
              abcDsls: fallback?.abcDsls,
              abcCodes: fallback?.abcCodes,
              abcOutKeyRefs: fallback?.abcOutKeyRefs,
              replayPlan: fallback?.replayPlan,
              markdownTable: fallbackContent || undefined,
              datasets: fallbackDatasets,
              // The failure reason travels with the execution facts: live and history both see the error description through the same facts.
              error: errorMsg,
            }
          : undefined;

      const errorEvent = {
        type: error instanceof AuthFailedError ? "auth_failed" : "error",
        node: "query",
        content: errorMsg,
        timestamp: Date.now(),
      };

      // A failure with partial results still publishes result events: live and history render from the same execution facts,
      // and even with no partial body the thinking and error facts go out, consistent with the persisted failure snapshot.
      if (fallbackQueryResult) {
        pushEvent({
          type: "result",
          node: "query",
          content: {
            markdownTable: fallbackContent || undefined,
            execution: toDisplayFact(fallbackQueryResult),
          },
          timestamp: Date.now(),
        });
      }
      pushEvent(errorEvent);

      await finishQueryRun(fallbackQueryResult, "failed", errorMsg);

      return buildQueryUpdate(fallbackQueryResult, eventCollector, {
        errors: [{ node: "query", message: errorMsg, timestamp: Date.now() }],
      });
    }

    const {
      content,
      datasets,
      sessionId,
      backendNodeId,
      nodeIds,
      subQuestions,
      abcDsls,
      abcCodes,
      abcOutKeyRefs,
      replayPlan,
    } = execution.output;
    const { thinkingState, thinkingSummary, thinkingSteps } = execution;
    const winnerName = BRANCH_CN[execution.winner];
    const normalizedNodeIds = Array.isArray(nodeIds) ? nodeIds.map(String).filter(Boolean) : [];

    logger.debug(tApp("queryFixed.40"), {
      winner: execution.winner,
      winnerName,
      sessionId,
      backendNodeId,
      datasetCount: datasets.length,
      nodeCount: normalizedNodeIds.length,
      hasThinking: !!thinkingSummary,
    });

    const querySummary = t("query.node.completedViaBranch", { branchName: winnerName });

    const thinkingEvent = {
      type: "thinking",
      node: "query",
      content: thinkingSummary || t("query.node.thinkingSummary", { branchName: winnerName }),
      thinkingSteps,
      thinkingState,
      timestamp: Date.now(),
    };

    const queryResult: QueryExecutionFact = {
      fullContent: content,
      thinkingSummary,
      thinkingSteps,
      thinkingState,
      nodeIds: normalizedNodeIds.length > 0 ? normalizedNodeIds : undefined,
      abcSubQuestions: subQuestions,
      abcDsls,
      abcCodes,
      abcOutKeyRefs,
      replayPlan,
      markdownTable: content,
      datasets,
    };

    const resultEvent = {
      type: "result",
      node: "query",
      content: {
        summary: querySummary,
        complete: true,
        markdownTable: content,
        winner: winnerName,
        // From this the live path renders the same execution display view as after a refresh, no longer receiving only the table and winning branch.
        execution: toDisplayFact(queryResult),
      },
      timestamp: Date.now(),
    };

    pushEvent(thinkingEvent);
    pushEvent(resultEvent);

    // Execution facts finalize as soon as data arrives, without waiting for the quality check.
    await finishQueryRun(queryResult, "completed");

    // The quality check is a late fact: this turn's display includes the quality-check panel, so it is registered with the run and progress states are pushed,
    // and the run waits for its settlement before finalizing; the execution facts themselves are unaffected by it.
    if (execution.winner === "abc" && sessionId) {
      const pendingLateFacts = resolvePendingLateFacts(config);
      const settlement = startQualityCheckSettlement({
        identity: { ...queryRunIdentity, sourceStage: "query" },
        sessionId,
        abcQuestionMode,
        token,
        apiKey,
        userId,
        locale,
        signal,
        onState: (qcState, markdown) => {
          onEvent?.({
            type: "post_thinking",
            node: "query",
            content: markdown,
            label: t("query.qcProcess.label"),
            mode: "replace",
            qcState,
            timestamp: Date.now(),
          });
        },
      });
      pendingLateFacts?.register(settlement);
    }

    return buildQueryUpdate(queryResult, eventCollector.concat([thinkingEvent, resultEvent]));
  } catch (error) {
    const isAuthFailed = error instanceof AuthFailedError;
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(tApp("queryFixed.41"), {
      error: errorMsg,
      question: queryQuestion,
      threadId: config?.configurable?.thread_id,
    });

    const errorEvent = {
      type: isAuthFailed ? "auth_failed" : "error",
      node: "query",
      content: errorMsg,
      timestamp: Date.now(),
    };
    pushEvent(errorEvent);

    await finishQueryRun(undefined, "failed", errorMsg);

    return buildQueryUpdate(undefined, eventCollector, {
      errors: [{ node: "query", message: errorMsg, timestamp: Date.now() }],
    });
  }
}
