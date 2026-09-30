import { createModel } from "../../../../config/model-factory";
import { modelAgentName } from "../../../../logging/model-agents";
import { datasetSchemaService } from "../../../data-query/dataset-schema";
import { findKnowledge } from "../../../data-query/hot-data/hot-data-utils";
import { t, tApp } from "../../../../i18n";
import { createLogger } from "../../../../logging/logger";
import { estimateMessagesSize } from "../../../../utils/prompt-context";
import { renderPrompt } from "../../../../core/prompts/loader";
import {
  ClarificationResult,
  GraphState,
  GraphUpdate,
  Plan,
  TaskPlannerOutputRecord,
  TaskPlannerResult,
  TaskPlannerResultSchema,
  TaskPlannerStep,
} from "../state";
import type {
  HistoricalQueryRefsById,
  TaskPlannerPriorMessage,
} from "../utils/task-planner-history";

const logger = createLogger("task-planner-node");

class TaskPlannerOutputValidationError extends Error {
  constructor(readonly validationMessage: string) {
    super(validationMessage);
    this.name = "TaskPlannerOutputValidationError";
  }
}

function summarizeContext(text: string, maxLength = 300): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

async function fetchBizKnowledge(question: string, token?: string): Promise<string> {
  try {
    return await findKnowledge({ question, token, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    logger.warn(tApp("queryFixed.62"), {
      error: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}

function buildHistoricalQueryHint(candidateCount: number): string {
  if (candidateCount === 0) {
    return tApp("queryFixed.63");
  }
  return [
    tApp("queryFixed.52", { v0: (candidateCount) }),
    tApp("queryFixed.64"),
    tApp("queryFixed.65"),
  ].join("\n");
}

function buildClarificationContext(state: GraphState): string {
  const context = state.previousClarificationContext;
  if (!context) return tApp("queryFixed.66");

  const options = context.options
    .map((option) => `- ${option.id}: ${option.resolvedQuestion}`)
    .join("\n");

  return [
    tApp("queryFixed.67"),
    tApp("queryFixed.53", { v0: (context.originalQuestion) }),
    tApp("queryFixed.54", { v0: (context.message) }),
    tApp("queryFixed.68"),
    options || tApp("queryFixed.69"),
    tApp("queryFixed.70"),
  ].join("\n");
}

function buildTaskPlannerPrompt(input: {
  datasetSchema: string;
  bizKnowledge: string;
  historicalQueryHint: string;
  clarificationContext: string;
}): string {
  return renderPrompt("standard-chat.task-planner.system", {
    datasetSchema: input.datasetSchema || tApp("queryFixed.71"),
    bizKnowledge: input.bizKnowledge || tApp("queryFixed.72"),
    historicalQueryHint: input.historicalQueryHint || tApp("queryFixed.63"),
    clarificationContext: input.clarificationContext,
  });
}

function buildTaskPlannerPromptMessages(input: {
  systemPrompt: string;
  currentUserContent: string;
  priorMessages: TaskPlannerPriorMessage[];
}) {
  return [
    { role: "system" as const, content: input.systemPrompt },
    ...input.priorMessages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    { role: "user" as const, content: input.currentUserContent },
  ];
}

function normalizeNodes(steps: TaskPlannerStep[]): Plan["nodes"] {
  return Array.from(new Set(steps.map((step) => step.type)));
}

function toPlan(result: Extract<TaskPlannerResult, { status: "ready" }>): Plan {
  const nodes = normalizeNodes(result.steps);

  return {
    nodes,
    steps: result.steps,
  };
}

function toAmbiguousClarificationResult(
  result: Extract<TaskPlannerResult, { status: "clarify" }>
): ClarificationResult {
  return {
    status: "ambiguous",
    message: result.message,
    options: result.options,
  };
}

function buildFallbackReadyResult(
  state: GraphState
): Extract<TaskPlannerResult, { status: "ready" }> {
  const question = state.previousClarificationContext?.originalQuestion || state.userQuestion;
  return {
    status: "ready",
    steps: [{ type: "query", question }],
  };
}

function parseTaskPlannerEnvelope(rawOutput: string): {
  planningText: string;
  jsonText: string;
} {
  const trimmed = rawOutput.trim();
  const fenceCount = trimmed.match(/```/g)?.length || 0;
  const match = trimmed.match(/^([\s\S]*\S)\s+```json\s*([\s\S]*?)\s*```$/i);
  if (fenceCount !== 2 || !match) {
    throw new Error(tApp("queryFixed.73"));
  }

  const planningText = match[1].trim();
  const jsonText = match[2].trim();
  if (!planningText || !jsonText) {
    throw new Error(tApp("queryFixed.74"));
  }
  return { planningText, jsonText };
}

function schemaErrorMessage(error: any): string {
  if (!Array.isArray(error?.issues)) return error instanceof Error ? error.message : String(error);
  return error.issues
    .map((issue: any) => {
      const path = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join(".") : "$";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function validateTaskPlannerSemantics(
  result: TaskPlannerResult,
  historicalQueryRefsById: HistoricalQueryRefsById
): TaskPlannerResult {
  if (result.status !== "ready") return result;

  const querySteps = result.steps.filter((step) => step.type === "query");
  if (querySteps.length > 1) {
    throw new TaskPlannerOutputValidationError(
      tApp("queryFixed.55", { v0: (querySteps.length) }) +
        tApp("queryFixed.75")
    );
  }

  const historicalQueryRunId = result.historicalQueryRunId;

  if (querySteps.length > 0 && historicalQueryRunId) {
    throw new TaskPlannerOutputValidationError(
      tApp("queryFixed.76")
    );
  }
  if (historicalQueryRunId && !historicalQueryRefsById[historicalQueryRunId]) {
    throw new TaskPlannerOutputValidationError(
      tApp("queryFixed.56", { v0: (historicalQueryRunId) })
    );
  }

  return result;
}

function parseTaskPlannerResult(
  rawOutput: string,
  historicalQueryRefsById: HistoricalQueryRefsById
): { result: TaskPlannerResult; planningText: string } {
  let envelope: ReturnType<typeof parseTaskPlannerEnvelope>;
  let parsed: unknown;
  try {
    envelope = parseTaskPlannerEnvelope(rawOutput);
    parsed = JSON.parse(envelope.jsonText);
  } catch (error) {
    throw new TaskPlannerOutputValidationError(
      tApp("queryFixed.57", { v0: (error instanceof Error ? error.message : String(error)) })
    );
  }

  const result = TaskPlannerResultSchema.safeParse(parsed);
  if (result.success) {
    return {
      result: validateTaskPlannerSemantics(result.data, historicalQueryRefsById),
      planningText: envelope.planningText,
    };
  }

  throw new TaskPlannerOutputValidationError(
    tApp("queryFixed.58", { v0: (schemaErrorMessage(result.error)) })
  );
}

function buildRepairMessage(errorMessage: string): string {
  return tApp("queryFixed.59", { v0: (errorMessage) });
}

async function invokeTaskPlannerWithRepair(
  model: Awaited<ReturnType<typeof createModel>>,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  historicalQueryRefsById: HistoricalQueryRefsById,
  logContext: { threadId?: string; requestSeq?: number }
): Promise<{ result: TaskPlannerResult; planningText: string; rawOutput: string }> {
  const response = await model.invoke(messages);
  const rawOutput = String(response.content || "");

  try {
    return {
      ...parseTaskPlannerResult(rawOutput, historicalQueryRefsById),
      rawOutput,
    };
  } catch (error) {
    if (!(error instanceof TaskPlannerOutputValidationError)) {
      throw error;
    }

    logger.warn(tApp("queryFixed.77"), {
      ...logContext,
      error: error.validationMessage,
      rawOutputPreview: summarizeContext(rawOutput, 500),
    });
    logger.warn(tApp("queryFixed.78"), {
      ...logContext,
      error: error.validationMessage,
    });

    const repairMessages = [
      ...messages,
      { role: "assistant" as const, content: rawOutput },
      { role: "user" as const, content: buildRepairMessage(error.validationMessage) },
    ];
    const repairResponse = await model.invoke(repairMessages);
    const repairedRawOutput = String(repairResponse.content || "");

    try {
      return {
        ...parseTaskPlannerResult(repairedRawOutput, historicalQueryRefsById),
        rawOutput: repairedRawOutput,
      };
    } catch (repairError) {
      if (repairError instanceof TaskPlannerOutputValidationError) {
        logger.error(tApp("queryFixed.79"), {
          ...logContext,
          firstError: error.validationMessage,
          retryError: repairError.validationMessage,
          firstRawOutputPreview: summarizeContext(rawOutput, 500),
          retryRawOutputPreview: summarizeContext(repairedRawOutput, 500),
        });
        throw new TaskPlannerOutputValidationError(
          tApp("queryFixed.60", { v0: (error.validationMessage), v1: (repairError.validationMessage) })
        );
      }
      throw repairError;
    }
  }
}

export async function taskPlannerNode(state: GraphState, config?: any): Promise<GraphUpdate> {
  const onEvent = config?.configurable?.onEvent;
  const sendEvent = (event: any) => {
    if (onEvent) onEvent(event);
  };

  sendEvent({
    type: "progress" as const,
    node: "taskPlanner" as const,
    content: t("planner.planningExecution"),
    timestamp: Date.now(),
  });

  try {
    const token = config?.configurable?.token;
    const apiKey = config?.configurable?.apiKey;
    const datasetSchema = await datasetSchemaService.getSchemaForQuestion(
      state.userQuestion,
      token,
      apiKey
    );
    const bizKnowledge = await fetchBizKnowledge(state.userQuestion, token);
    const historicalQueryRefsById =
      config?.configurable?.historicalQueryRefsById &&
      typeof config.configurable.historicalQueryRefsById === "object"
        ? (config.configurable.historicalQueryRefsById as HistoricalQueryRefsById)
        : {};
    const priorMessages = Array.isArray(config?.configurable?.taskPlannerPriorMessages)
      ? (config.configurable.taskPlannerPriorMessages as TaskPlannerPriorMessage[])
      : [];

    logger.info(tApp("queryFixed.80"), {
      bizKnowledgeLength: bizKnowledge.length,
      bizKnowledgePreview: summarizeContext(bizKnowledge),
      hasPreviousClarification: !!state.previousClarificationContext,
      historicalQueryCandidateCount: Object.keys(historicalQueryRefsById).length,
    });

    const prompt = buildTaskPlannerPrompt({
      datasetSchema,
      bizKnowledge,
      historicalQueryHint: buildHistoricalQueryHint(Object.keys(historicalQueryRefsById).length),
      clarificationContext: buildClarificationContext(state),
    });

    const messages = buildTaskPlannerPromptMessages({
      systemPrompt: prompt,
      currentUserContent: state.userQuestion,
      priorMessages,
    });

    logger.info(tApp("queryFixed.81"), {
      promptLength: prompt.length,
      messageCount: messages.length,
      messagesLength: estimateMessagesSize(messages),
    });

    const model = await createModel({ agentName: modelAgentName("taskPlanner") });
    const parsed = await invokeTaskPlannerWithRepair(model, messages, historicalQueryRefsById, {
      threadId: config?.configurable?.thread_id,
      requestSeq: config?.configurable?.requestSeq ?? state.requestSeq,
    });
    let result = parsed.result;
    let planningText = parsed.planningText;

    if (result.status === "clarify" && state.previousClarificationContext) {
      logger.warn(tApp("queryFixed.82"), {
        originalQuestion: state.previousClarificationContext.originalQuestion,
      });
      result = buildFallbackReadyResult(state);
      planningText = tApp("queryFixed.83");
    }

    const outputRecord: TaskPlannerOutputRecord = {
      requestSeq: config?.configurable?.requestSeq ?? state.requestSeq ?? 0,
      userInput: state.userDisplayQuestion || state.userQuestion,
      rawOutput: parsed.rawOutput,
      normalizedResult: result,
    };

    const thinkingEvent = {
      type: "thinking" as const,
      node: "taskPlanner" as const,
      content: planningText,
      timestamp: Date.now(),
    };
    sendEvent(thinkingEvent);

    if (result.status === "reply" || result.status === "knowledge") {
      const resultEvent = {
        type: "result" as const,
        node: "taskPlanner" as const,
        content:
          result.status === "reply"
            ? { status: result.status, replyKind: result.replyKind }
            : { status: result.status },
        timestamp: Date.now(),
      };
      sendEvent(resultEvent);
      return {
        taskPlannerResult: result,
        events: [thinkingEvent, resultEvent],
        taskPlannerOutputRecords: [outputRecord],
      };
    }

    if (result.status === "clarify") {
      const clarificationResult = toAmbiguousClarificationResult(result);
      const clarificationEvent = {
        type: "clarification" as const,
        node: "taskPlanner" as const,
        content: {
          message: result.message || t("response.clarification"),
          options: result.options || [],
        },
        timestamp: Date.now(),
      };
      sendEvent(clarificationEvent);
      return {
        taskPlannerResult: result,
        clarificationResult,
        events: [thinkingEvent, clarificationEvent],
        taskPlannerOutputRecords: [outputRecord],
      };
    }

    const plan = toPlan(result);
    const historicalQueryRef = result.historicalQueryRunId
      ? historicalQueryRefsById[result.historicalQueryRunId]
      : undefined;
    const resultEvent = {
      type: "result" as const,
      node: "taskPlanner" as const,
      content: {
        status: result.status,
        nodes: plan.nodes,
      },
      timestamp: Date.now(),
    };
    sendEvent(resultEvent);

    return {
      taskPlannerResult: result,
      plan,
      historicalQueryRef,
      events: [thinkingEvent, resultEvent],
      taskPlannerOutputRecords: [outputRecord],
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(tApp("queryFixed.61", { v0: (errorMsg) }), {
      threadId: config?.configurable?.thread_id,
    });

    const thinkingEvent = {
      type: "thinking" as const,
      node: "taskPlanner" as const,
      content: t("planning.failed", { error: errorMsg }),
      timestamp: Date.now(),
    };
    const errorEvent = {
      type: "error" as const,
      node: "taskPlanner" as const,
      content: errorMsg,
      timestamp: Date.now(),
    };

    sendEvent(thinkingEvent);
    sendEvent(errorEvent);

    return {
      events: [thinkingEvent, errorEvent],
      errors: [{ node: "taskPlanner", message: errorMsg, timestamp: Date.now() }],
    };
  }
}
