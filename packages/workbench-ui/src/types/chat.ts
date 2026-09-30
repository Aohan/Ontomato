import type {
  ThinkingBranchState,
  ThinkingAbcStep,
  ThinkingAbcState,
  QueryThinkingState as WireQueryThinkingState,
  QcResultState,
} from "@ontomato/contracts/query-thinking";
import type { QueryExecutionDisplayFact } from "@ontomato/contracts/query-execution";
import type { DeepAnalysisTaskPayload } from "@ontomato/contracts/analysis-presentation";
import type { ChatClientEvent } from "@ontomato/contracts/chat";
import type { EgressMessage } from "@ontomato/contracts/agent-egress";
export interface QueryThinkingBranch extends Omit<ThinkingBranchState, "status"> {
  status: ThinkingBranchState["status"] | "stopped";
}

export interface QueryThinkingAbcStep extends Omit<ThinkingAbcStep, "status"> {
  status: ThinkingAbcStep["status"] | "stopped";
}

export interface QueryThinkingState extends Omit<
  WireQueryThinkingState,
  "status" | "branches" | "abc"
> {
  status: WireQueryThinkingState["status"] | "stopped";
  branches: QueryThinkingBranch[];
  abc?: Omit<ThinkingAbcState, "status" | "steps"> & {
    status: ThinkingAbcState["status"] | "stopped";
    steps: QueryThinkingAbcStep[];
  };
}

export interface QueryExecutionFacts extends Omit<
  QueryExecutionDisplayFact,
  "thinkingState" | "data" | "datasets" | "qcResult" | "abcOutKeyRefs" | "winner"
> {
  thinkingState?: QueryThinkingState;
  data?: Array<Record<string, unknown>> | Array<Array<Record<string, unknown>>>;
  datasets?: Array<{
    name?: string;
    description?: string;
    data?: Array<Record<string, unknown>>;
    dsl?: unknown;
    subQuestion?: string;
  }>;
  qcResult?: QcResultState;
  /** Field lineage for each dataset, in the same order as datasets; consistent with contracts/query-execution. */
  abcOutKeyRefs?: unknown[][];
  winner?: string;
}

export interface DeepAnalysisQuestion {
  id: string;
  text: string;
  done: boolean;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  statusText?: string;
  /** Execution facts for this query question; both entry points render the same execution display view from it */
  execution?: QueryExecutionFacts;
}

export interface DeepAnalysisDimension {
  dimensionId: string;
  dimName: string;
  dimensionValue?: string;
  reason?: string;
  status: "pending" | "running" | "completed" | "partial" | "failed" | "stopped";
  questions: DeepAnalysisQuestion[];
}

export interface ExecutionSnapshotStep {
  id: string;
  name: string;
  icon?: string;
  detail?: string;
  status: "running" | "completed" | "failed" | "stopped";
  kind: "skill" | "tool" | "stage";
}

export type ClarificationSnapshot = Omit<
  Extract<ChatClientEvent, { type: "clarification" }>,
  "type"
>;

export interface ResponseSnapshot {
  mode: "standard" | "deep-analysis" | "error";
  status: "streaming" | "completed" | "failed";
  source: "live" | "history";
  stoppedByUser?: boolean;
  threadId?: string;
  turnKey?: string;
  runId?: string;
  lastEventSeq?: number;
  requestSeq?: number;
  primaryText: string;
  analysisText?: string;
  visualizationHTML?: string;
  visualizationLoading?: boolean;
  /** API/live read model: composed from execution_events for history; not part of the persisted reply snapshot. */
  executionSteps?: ExecutionSnapshotStep[];
  /** Execution facts for this turn's query question; same declaration and view as report tracing */
  execution?: QueryExecutionFacts;
  /** Public messages (user / assistant / tool results) already egress-filtered for this turn, used only for per-turn expansion display. */
  trace?: EgressMessage[];
  /** API/live read model: composed from query_runs for history, used for downloads and dashboard actions. */
  datasets?: Array<{
    id: string;
    title: string;
    rows: Array<Record<string, unknown>>;
    dsl?: unknown;
    subQuestion?: string;
  }>;
  /** API/live read model: composed from query_runs for history. */
  graphNodeIds?: string[];
  /** API/live read model: derived from the query data actually available in this turn. */
  hasQueryArtifacts?: boolean;
  showPendingUnderstanding?: boolean;
  deepAnalysis?: DeepAnalysisTaskPayload;
  clarification?: ClarificationSnapshot;
}

export interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  snapshot?: ResponseSnapshot;
}

export type SendMessageOverrides =
  | string
  | {
      submitText: string;
      displayText?: string;
    };
