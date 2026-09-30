import { getDefaultLocale } from "../../../i18n/index";
import type { ClarificationOption } from "@ontomato/contracts/chat";
import { buildQualityCheckView } from "../../data-query/query-fact";
import type { QualityCheckView } from "./utils/task-planner-history";
import { PendingLateFacts } from "../../data-query/late-fact";
import type { QueryExecutionFact } from "../../data-query/query-fact";
import { StateGraph, END, START } from "@langchain/langgraph";
import {
  GraphStateAnnotation,
  type AnalysisResult,
  type GraphState,
  type PreviousClarificationContext,
  type TaskPlannerOutputRecord,
  type VisualizationResult,
} from "./state";
import { t, tApp } from "../../../i18n";
import { taskPlannerNode } from "./nodes/task-planner-node";
import { replyNode } from "./nodes/reply-node";
import { knowledgeNode } from "./nodes/knowledge-node";
import { queryNode } from "./nodes/query-node";
import { analysisNode } from "./nodes/analysis-node";
import { visualizationNode } from "./nodes/visualization-node";
import { standardResponseNode } from "./nodes/response-node";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { createLogger } from "../../../logging/logger";
import { initializeConnection, getCheckpointer } from "../../../infrastructure/connection";
import { allocateRequestSeq, createThreadPlaceholder } from "../thread-store";
import { listChatRenderSnapshots } from "../chat-snapshot-store";
import { upsertExecutionEvent } from "../execution-event-store";
import { getPrimaryQueryRun } from "../../data-query/query-run-store";
import {
  buildTaskPlannerHistoryContext,
  collectTaskPlannerHistoryRequestSeqs,
  indexUserMessagesByRequest,
  type HistoricalQueryRefsById,
  type TaskPlannerPriorMessage,
  type TaskPlannerThreadMessage,
} from "./utils/task-planner-history";
import {
  createQueryArtifactRef,
  hasUsableQueryRun,
  QueryArtifactCache,
} from "./utils/query-artifact-cache";
import { extractDatasetsFromQueryRun } from "../../data-query/query-run-artifacts";
import { routeAfterTaskPlanner, routeAfterQuery, routeAfterAnalysis } from "./routes";

const logger = createLogger("workflow");

export interface DataAgentWorkflowRuntimeArtifacts {
  queryResult?: QueryExecutionFact;
  analysisResult?: AnalysisResult;
  visualizationResult?: VisualizationResult;
}

export type DataAgentWorkflowResult = GraphState & {
  runtimeArtifacts?: DataAgentWorkflowRuntimeArtifacts;
  /** Late facts registered by this run; entries presenting them wait for settlement before finalizing */
  pendingLateFacts?: PendingLateFacts;
};

function findPreviousClarificationContext(input: {
  messages: TaskPlannerThreadMessage[];
  snapshots: Array<{ requestSeq: number; snapshot?: any }>;
  currentRequestSeq: number;
}): PreviousClarificationContext | undefined {
  const questions = indexUserMessagesByRequest(input.messages);
  const candidates = input.snapshots
    .filter((item) => {
      const options = item.snapshot?.clarification?.options;
      return (
        item.requestSeq < input.currentRequestSeq && Array.isArray(options) && options.length > 0
      );
    })
    .sort((a, b) => b.requestSeq - a.requestSeq);

  const latest = candidates[0];
  if (!latest) return undefined;

  const clarification = latest.snapshot?.clarification;
  const options = Array.isArray(clarification?.options)
    ? clarification.options
        .map((option: any) => ({
          id: String(option?.id || ""),
          resolvedQuestion: String(option?.resolvedQuestion || option?.label || ""),
        }))
        .filter((option: ClarificationOption) => Boolean(option.id && option.resolvedQuestion))
    : [];
  if (options.length === 0) return undefined;

  const originalQuestion = questions.get(latest.requestSeq);
  if (!originalQuestion) return undefined;

  return {
    message: String(clarification?.message || t("response.clarification")),
    options,
    originalQuestion,
    requestSeq: latest.requestSeq,
  };
}

export function createDataAgentWorkflow() {
  const workflow = new StateGraph(GraphStateAnnotation)
    .addNode("taskPlanner", taskPlannerNode)
    .addNode("reply", replyNode)
    .addNode("knowledge", knowledgeNode)
    .addNode("query", queryNode)
    .addNode("analysis", analysisNode)
    .addNode("visualization", visualizationNode)
    .addNode("response", standardResponseNode)

    .addEdge(START, "taskPlanner")
    .addConditionalEdges("taskPlanner", routeAfterTaskPlanner, {
      reply: "reply",
      knowledge: "knowledge",
      query: "query",
      analysis: "analysis",
      visualization: "visualization",
      response: "response",
      [END]: END,
    })
    .addEdge("reply", END)
    .addEdge("knowledge", END)
    .addConditionalEdges("query", routeAfterQuery, {
      analysis: "analysis",
      visualization: "visualization",
      response: "response",
    })
    .addConditionalEdges("analysis", routeAfterAnalysis, {
      visualization: "visualization",
      response: "response",
    })
    .addEdge("visualization", "response")
    .addEdge("response", END);

  const checkpointer = getCheckpointer();
  const app = workflow.compile({ checkpointer: checkpointer || undefined });
  return app;
}

export async function runDataAgentWorkflow(params: {
  userQuestion: string;
  userDisplayQuestion?: string;
  userId: string;
  domainId: string;
  threadId?: string;
  onEvent?: (event: any) => void;
  token?: string;
  locale?: string;
  apiKey?: string;
  requestSeq?: number;
  signal?: AbortSignal;
}) {
  const {
    userQuestion,
    userDisplayQuestion = userQuestion,
    userId,
    domainId,
    threadId = `thread-${Date.now()}`,
    onEvent,
    token,
    locale = getDefaultLocale(),
    apiKey,
    requestSeq: providedRequestSeq,
    signal,
  } = params;
  const t0 = Date.now();
  const tInitStart = Date.now();
  await initializeConnection();
  const tInitDone = Date.now();

  const checkpointer = getCheckpointer();
  const queryArtifactCache = new QueryArtifactCache();
  const pendingLateFacts = new PendingLateFacts();
  const tReqSeqStart = Date.now();
  await createThreadPlaceholder(threadId, userQuestion.slice(0, 20), userId, domainId);
  if (
    providedRequestSeq !== undefined &&
    (!Number.isInteger(providedRequestSeq) || providedRequestSeq < 0)
  ) {
    throw new Error("requestSeq must be a non-negative integer");
  }
  const requestSeq = providedRequestSeq ?? (await allocateRequestSeq(threadId));
  const tReqSeqDone = Date.now();
  logger.debug(tApp("queryFixed.139"), {
    threadId,
    userId,
    requestSeq,
    requestSeqSource: providedRequestSeq === undefined ? "workflow" : "caller",
    initDurationMs: tInitDone - tInitStart,
    reqSeqDurationMs: tReqSeqDone - tReqSeqStart,
    totalStartupMs: tReqSeqDone - t0,
  });

  let historicalMessages: (HumanMessage | AIMessage)[] = [];
  let historicalQueryRefsById: HistoricalQueryRefsById = {};
  let previousClarificationContext: PreviousClarificationContext | undefined;
  let taskPlannerOutputRecords: TaskPlannerOutputRecord[] = [];
  let taskPlannerPriorMessages: TaskPlannerPriorMessage[] = [];

  if (checkpointer && requestSeq > 0) {
    try {
      const tHistoryStart = Date.now();
      const rawMessages = await checkpointer.getThreadMessages(threadId);
      const checkpointOutputRecords = await checkpointer.getThreadChannelValue<
        TaskPlannerOutputRecord[]
      >(threadId, "taskPlannerOutputRecords");
      taskPlannerOutputRecords = Array.isArray(checkpointOutputRecords)
        ? checkpointOutputRecords.filter(
            (entry) =>
              entry &&
              typeof entry.userInput === "string" &&
              entry.userInput.trim() &&
              entry.normalizedResult
          )
        : [];
      const tMessagesDone = Date.now();
      const MAX_HISTORY_MESSAGES = 10;
      const recentMessages = rawMessages.slice(-MAX_HISTORY_MESSAGES);

      for (const msg of recentMessages) {
        if (msg.role === "user") {
          historicalMessages.push(new HumanMessage(msg.content));
        } else if (msg.role === "assistant") {
          historicalMessages.push(new AIMessage(msg.content));
        }
      }

      logger.debug(tApp("queryFixed.140"), {
        threadId,
        historyMessageCount: historicalMessages.length,
        taskPlannerOutputRecordCount: taskPlannerOutputRecords.length,
        getMessagesMs: tMessagesDone - tHistoryStart,
      });

      let snapshots: Array<{ requestSeq: number; snapshot?: any }> = [];
      try {
        snapshots = await listChatRenderSnapshots(threadId);
      } catch (error) {
        logger.warn(tApp("queryFixed.141"), {
          threadId,
          error: String(error),
        });
      }
      const replayRequestSeqs = collectTaskPlannerHistoryRequestSeqs({
        records: taskPlannerOutputRecords,
        snapshots,
        messages: rawMessages,
        currentRequestSeq: requestSeq,
      });
      const snapshotRequestSeqs = new Set(snapshots.map((snapshot) => snapshot.requestSeq));
      const candidateRequestSeqs = replayRequestSeqs.filter((seq) => snapshotRequestSeqs.has(seq));
      const qualityChecksByRequestSeq = new Map<number, QualityCheckView>();
      const datasetsByRequestSeq = new Map<number, unknown[]>();
      const primaryQueryRunResults = await Promise.allSettled(
        candidateRequestSeqs.map((seq) => getPrimaryQueryRun(threadId, seq))
      );

      for (const [index, queryRunResult] of primaryQueryRunResults.entries()) {
        const sourceRequestSeq = candidateRequestSeqs[index];
        if (queryRunResult.status === "rejected") {
          logger.warn(tApp("queryFixed.142"), {
            threadId,
            sourceRequestSeq,
            error: String(queryRunResult.reason),
          });
          continue;
        }
        const queryRun = queryRunResult.value;
        // The quality check is a field of the execution facts: the historical context comes from here whether or not this turn's data is reusable.
        const qualityCheck = buildQualityCheckView(queryRun);
        if (qualityCheck) qualityChecksByRequestSeq.set(sourceRequestSeq, qualityCheck);
        if (queryRun) {
          const datasets = extractDatasetsFromQueryRun(queryRun).map((dataset) => ({
            title: dataset.title,
            rows: dataset.rows,
          }));
          if (datasets.length > 0) datasetsByRequestSeq.set(sourceRequestSeq, datasets);
        }
        if (!queryRun || !hasUsableQueryRun(queryRun)) {
          continue;
        }

        const ref = createQueryArtifactRef({
          threadId,
          requestSeq: sourceRequestSeq,
          sourceKind: queryRun.sourceKind,
          sourceRef: queryRun.sourceRef,
          queryRunId: queryRun.id,
        });
        historicalQueryRefsById[queryRun.id] = ref;
      }

      const taskPlannerHistory = buildTaskPlannerHistoryContext({
        records: taskPlannerOutputRecords,
        snapshots,
        messages: rawMessages,
        requestSeqs: replayRequestSeqs,
        historicalQueryRefsById,
        qualityChecksByRequestSeq,
        datasetsByRequestSeq,
      });
      taskPlannerPriorMessages = taskPlannerHistory.priorMessages;
      historicalQueryRefsById = taskPlannerHistory.historicalQueryRefsById;
      previousClarificationContext = findPreviousClarificationContext({
        messages: rawMessages,
        snapshots,
        currentRequestSeq: requestSeq,
      });
      if (previousClarificationContext) {
        logger.debug(tApp("queryFixed.143"), {
          threadId,
          sourceRequestSeq: previousClarificationContext.requestSeq,
          optionCount: previousClarificationContext.options.length,
        });
      }
      logger.debug(tApp("queryFixed.144"), {
        threadId,
        replayRequestSeqs,
        reusableQueryRunCount: Object.keys(historicalQueryRefsById).length,
      });
    } catch (error) {
      logger.error(tApp("queryFixed.145"), { threadId, error: String(error) });
      taskPlannerPriorMessages = [];
      historicalQueryRefsById = {};
    }
  }

  const initialState: GraphState = {
    userQuestion,
    userDisplayQuestion,
    clarificationResult: undefined,
    taskPlannerResult: undefined,
    previousClarificationContext,
    taskPlannerOutputRecords,
    userId,
    threadId,
    requestSeq,
    messages: [
      new HumanMessage({
        content: userDisplayQuestion,
        additional_kwargs: { requestSeq },
      }),
    ],
    events: [],
    errors: [],
    plan: undefined,
    mockData: undefined,
    historicalQueryRef: undefined,
    queryArtifactRef: undefined,
    analysisArtifactRef: undefined,
    analysisResult: undefined,
    visualizationArtifactRef: undefined,
  };

  const config = {
    signal,
    configurable: {
      thread_id: threadId,
      user_id: userId,
      domainId,
      token: token || "",
      locale,
      apiKey: apiKey || "",
      onEvent: onEvent,
      requestSeq: requestSeq,
      signal,
      priorMessages: historicalMessages,
      taskPlannerPriorMessages,
      historicalQueryRefsById,
      queryArtifactCache,
      pendingLateFacts,
    },
  };

  const workflowStartTime = Date.now();
  const workflow = createDataAgentWorkflow();
  const stream = await workflow.stream(initialState, config);
  const streamStartTime = Date.now();
  logger.debug(tApp("queryFixed.146"), { durationMs: streamStartTime - workflowStartTime });

  let finalState: DataAgentWorkflowResult | undefined;
  let allEvents: any[] = [];
  let accumulatedOutput: any = {};
  const nodeExecutionDurations = new Map<string, number>();

  const nodeDisplayNames: Record<string, { name: string; icon: string }> = {
    query: { name: t("response.queryData"), icon: "🔍" },
    analysis: { name: t("response.analyzeData"), icon: "📈" },
    visualization: { name: t("response.generateChart"), icon: "📊" },
  };
  const nodeEventSeq: Record<string, number> = {
    query: 1,
    analysis: 2,
    visualization: 3,
  };

  const pendingPersists: Promise<void>[] = [];

  const addPersist = (p: Promise<void>, label: string) => {
    pendingPersists.push(
      p.catch((err) => {
        logger.error(tApp("queryFixed.137", { v0: (label) }), { threadId, requestSeq, error: String(err) });
      })
    );
  };

  for await (const event of stream) {
    const nodeNames = Object.keys(event);
    if (nodeNames.length > 0) {
      const nodeName = nodeNames[0];
      const nodeOutput = (event as Record<string, any>)[nodeName];

      if (nodeOutput?.events) {
        allEvents = [...allEvents, ...nodeOutput.events];
      }

      if (nodeName !== "__end__") {
        const nodeArrivalTime = Date.now();
        accumulatedOutput = { ...accumulatedOutput, ...nodeOutput };

        if (threadId) {
          // Stream node updates arrive after the node completes; only the terminal states known at that point are saved.
          const startTime = nodeArrivalTime;
          if (nodeDisplayNames[nodeName]) {
            const endTime = Date.now();
            const duration = endTime - startTime;
            nodeExecutionDurations.set(nodeName, duration);
            const updatePromise = upsertExecutionEvent({
              threadId,
              requestSeq,
              eventSeq: nodeEventSeq[nodeName] || 99,
              eventType: "node",
              eventName: nodeDisplayNames[nodeName].name,
              eventIcon: nodeDisplayNames[nodeName].icon,
              status: "completed",
              startedAt: startTime,
              endedAt: endTime,
              durationMs: duration,
              sourceKind: "workflow_node",
              sourceRef: nodeName,
            });
            addPersist(updatePromise, `upsertExecutionEvent-${nodeName}-complete`);
          }
        }

        if (nodeDisplayNames[nodeName]) {
          logger.debug(tApp("queryFixed.138", { v0: (nodeName) }), {
            threadId,
            nodeDurationMs: nodeExecutionDurations.get(nodeName) || 0,
            consumerOverheadMs: Date.now() - nodeArrivalTime,
          });
        }
      }

      if (nodeName === "__end__") {
        finalState = nodeOutput as DataAgentWorkflowResult;
      }
    }
  }

  const streamEndTime = Date.now();
  logger.debug(tApp("queryFixed.147"), {
    threadId,
    totalDurationMs: streamEndTime - workflowStartTime,
    streamDurationMs: streamEndTime - streamStartTime,
    nodeDurations: Object.fromEntries(nodeExecutionDurations),
    pendingPersistCount: pendingPersists.length,
  });

  await Promise.allSettled(pendingPersists);

  if (!finalState && accumulatedOutput) {
    finalState = {
      ...initialState,
      events: allEvents,
      taskPlannerResult: accumulatedOutput.taskPlannerResult,
      plan: accumulatedOutput.plan,
      clarificationResult: accumulatedOutput.clarificationResult,
      taskPlannerOutputRecords:
        accumulatedOutput.taskPlannerOutputRecords || initialState.taskPlannerOutputRecords,
      historicalQueryRef: accumulatedOutput.historicalQueryRef,
      queryArtifactRef: accumulatedOutput.queryArtifactRef,
      analysisArtifactRef: accumulatedOutput.analysisArtifactRef,
      visualizationArtifactRef: accumulatedOutput.visualizationArtifactRef,
    };
  } else if (finalState) {
    finalState = { ...finalState, events: allEvents };
    if (!finalState.taskPlannerResult && accumulatedOutput.taskPlannerResult) {
      finalState.taskPlannerResult = accumulatedOutput.taskPlannerResult;
    }
    if (!finalState.clarificationResult && accumulatedOutput.clarificationResult) {
      finalState.clarificationResult = accumulatedOutput.clarificationResult;
    }
    if (!finalState.queryArtifactRef && accumulatedOutput.queryArtifactRef) {
      finalState.queryArtifactRef = accumulatedOutput.queryArtifactRef;
    }
    if (!finalState.historicalQueryRef && accumulatedOutput.historicalQueryRef) {
      finalState.historicalQueryRef = accumulatedOutput.historicalQueryRef;
    }
    if (!finalState.analysisArtifactRef && accumulatedOutput.analysisArtifactRef) {
      finalState.analysisArtifactRef = accumulatedOutput.analysisArtifactRef;
    }
    if (!finalState.visualizationArtifactRef && accumulatedOutput.visualizationArtifactRef) {
      finalState.visualizationArtifactRef = accumulatedOutput.visualizationArtifactRef;
    }
    if (
      (!finalState.taskPlannerOutputRecords || finalState.taskPlannerOutputRecords.length === 0) &&
      accumulatedOutput.taskPlannerOutputRecords
    ) {
      finalState.taskPlannerOutputRecords = accumulatedOutput.taskPlannerOutputRecords;
    }
  } else {
    finalState = { ...initialState, events: allEvents };
  }

  const runtimeArtifacts: DataAgentWorkflowRuntimeArtifacts = {
    queryResult: finalState.queryArtifactRef
      ? queryArtifactCache.getQueryResult(finalState.queryArtifactRef)
      : undefined,
    analysisResult: finalState.analysisArtifactRef
      ? queryArtifactCache.getAnalysisResult(finalState.analysisArtifactRef)
      : undefined,
    visualizationResult: finalState.visualizationArtifactRef
      ? queryArtifactCache.getVisualizationResult(finalState.visualizationArtifactRef)
      : undefined,
  };
  finalState.runtimeArtifacts = runtimeArtifacts;
  finalState.pendingLateFacts = pendingLateFacts;

  return finalState;
}
