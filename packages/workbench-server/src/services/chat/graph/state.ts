import type { QueryThinkingState } from "@ontomato/contracts/query-thinking";
import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";

const ClarificationOptionSchema = z
  .object({
    id: z.string(),
    resolvedQuestion: z.string(),
  })
  .strict();

export type ClarificationResult = {
  status: "ambiguous";
  message: string;
  options: Array<z.infer<typeof ClarificationOptionSchema>>;
};

const TaskPlannerReplyKindSchema = z.enum([
  "greeting",
  "out_of_scope",
  "capability",
  "direct_explanation",
]);

const QueryStepSchema = z
  .object({
    type: z.literal("query"),
    question: z.string().trim().min(1),
  })
  .strict();

const AnalysisStepSchema = z
  .object({
    type: z.literal("analysis"),
    instruction: z.string().trim().min(1),
  })
  .strict();

const VisualizationStepSchema = z
  .object({
    type: z.literal("visualization"),
    instruction: z.string().trim().min(1),
  })
  .strict();

const TaskPlannerStepSchema = z.discriminatedUnion("type", [
  QueryStepSchema,
  AnalysisStepSchema,
  VisualizationStepSchema,
]);

export const TaskPlannerResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("reply"),
      replyKind: TaskPlannerReplyKindSchema,
      replyInstruction: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      status: z.literal("knowledge"),
    })
    .strict(),
  z
    .object({
      status: z.literal("clarify"),
      message: z.string().trim().min(1),
      options: z.array(ClarificationOptionSchema).min(1),
    })
    .strict(),
  z
    .object({
      status: z.literal("ready"),
      historicalQueryRunId: z.string().trim().min(1).optional(),
      steps: z.array(TaskPlannerStepSchema).min(1),
    })
    .strict(),
]);

export type TaskPlannerStep = z.infer<typeof TaskPlannerStepSchema>;
export type TaskPlannerResult = z.infer<typeof TaskPlannerResultSchema>;

export type TaskPlannerOutputRecord = {
  requestSeq: number;
  userInput: string;
  rawOutput: string;
  normalizedResult: TaskPlannerResult;
};

const MAX_TASK_PLANNER_OUTPUT_RECORDS = 10;

function mergeTaskPlannerOutputRecords(
  existing: TaskPlannerOutputRecord[] = [],
  updates: TaskPlannerOutputRecord[] = []
): TaskPlannerOutputRecord[] {
  const byRequestSeq = new Map<number, TaskPlannerOutputRecord>();

  for (const entry of existing) {
    byRequestSeq.set(entry.requestSeq, entry);
  }

  for (const update of updates) {
    byRequestSeq.set(update.requestSeq, update);
  }

  return Array.from(byRequestSeq.values())
    .sort((a, b) => a.requestSeq - b.requestSeq)
    .slice(-MAX_TASK_PLANNER_OUTPUT_RECORDS);
}

export type PreviousClarificationContext = {
  message: string;
  options: Array<z.infer<typeof ClarificationOptionSchema>>;
  originalQuestion: string;
  requestSeq?: number;
};

export type Plan = {
  nodes: Array<"query" | "analysis" | "visualization">;
  steps: TaskPlannerStep[];
};

export type QueryArtifactRef = {
  queryRunId?: string;
  threadId: string;
  requestSeq: number;
  sourceKind: string;
  sourceRef: string;
};

export type AnalysisResult = {
  thinking?: string;
  result?: string;
};

export type VisualizationResult = {
  thinking?: string;
  thinkingState?: QueryThinkingState;
  result: {
    html: string;
    chartType?: string;
    title?: string;
  };
};

export type Event = {
  type: "thinking" | "result" | "error" | "progress" | "token" | "clarification";
  node?:
    | "taskPlanner"
    | "reply"
    | "knowledge"
    | "query"
    | "analysis"
    | "visualization"
    | "response";
  content: string | object;
  timestamp: number;
};

// Graph State with proper annotations
export const GraphStateAnnotation = Annotation.Root({
  // User input
  userQuestion: Annotation<string>,
  userDisplayQuestion: Annotation<string | undefined>,

  // Task planner results
  clarificationResult: Annotation<ClarificationResult | undefined>,
  taskPlannerResult: Annotation<TaskPlannerResult | undefined>,
  previousClarificationContext: Annotation<PreviousClarificationContext | undefined>,
  taskPlannerOutputRecords: Annotation<TaskPlannerOutputRecord[], TaskPlannerOutputRecord[]>({
    default: () => [],
    reducer: mergeTaskPlannerOutputRecords,
  }),

  // Execution plan from task planner
  plan: Annotation<Plan | undefined>,

  // Mock data (user-provided or generated)
  mockData: Annotation<Record<string, unknown>[] | undefined>,

  // Historical query reference from previous requests (for follow-up questions)
  historicalQueryRef: Annotation<QueryArtifactRef | undefined>,

  // Runtime artifact references from each node
  queryArtifactRef: Annotation<QueryArtifactRef | undefined>,
  analysisArtifactRef: Annotation<string | undefined>,
  analysisResult: Annotation<AnalysisResult | undefined>,
  visualizationArtifactRef: Annotation<string | undefined>,

  // Events for streaming (use reducer to merge arrays)
  events: Annotation<Event[], Event[]>({
    default: () => [],
    reducer: (existing, newEvents) => [...existing, ...newEvents],
  }),

  // Error tracking
  errors: Annotation<Array<{ node: string; message: string; timestamp: number }>>,

  // User context
  userId: Annotation<string>,
  threadId: Annotation<string>,
  requestSeq: Annotation<number | undefined>,

  // Messages for LLM (optional, for compatibility)
  messages: Annotation<BaseMessage[], BaseMessage[]>({
    default: () => [],
    reducer: (existing, newMessages) => [...existing, ...newMessages],
  }),
});

export type GraphState = typeof GraphStateAnnotation.State;
export type GraphUpdate = typeof GraphStateAnnotation.Update;
