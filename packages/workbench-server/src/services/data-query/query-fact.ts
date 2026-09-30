import type {
  QueryThinkingState,
  ThinkingBranchCard,
  ThinkingBranchState,
} from "@ontomato/contracts/query-thinking";
import type {
  QueryExecutionDisplayFact,
  QueryBackendSession,
} from "@ontomato/contracts/query-execution";
/**
 * Execution facts of one query question: the only result model and the only persistence constructor.
 *
 * Standard query and analysis sub-questions are only callers — they decide which query branches to enable and what to
 * layer on top of these facts (turn-level assembly, or plan identity and business execution states), but none of them
 * defines its own result shape, and none decides which columns to write into the query run facts.
 */

import { t } from "../../i18n";
import type { QueryRun, UpsertQueryRunInput } from "./query-run-store";
import { buildThinkingSteps, buildThinkingSummary } from "./thinking/thinking-state";

import type { HotReportReplayPlan, OutKeyRef } from "./replay-plan";

/**
 * Execution facts. Each field carries a value only when this execution actually produced one; what was not produced does not exist —
 * query mode differences (DSL-form vs program-form second-level decomposition) show up only as the presence or absence of facts.
 */
export interface QueryExecutionFact extends QueryExecutionDisplayFact {
  abcOutKeyRefs?: OutKeyRef[][];
  /** Backend sessions produced by this execution, for diagnosis to locate backend evidence */
  backendSessions?: QueryBackendSession[];
  /** Nodes that need locating in the graph */
  nodeIds?: string[];
  dslText?: string;
  ir?: string;
  objectClasses?: string[];
  replayPlan?: HotReportReplayPlan;
  /** Hit cards and the winning branch */
  cards?: ThinkingBranchCard[];
}

/** Retired pre-computed branch keys: they exist only in query run facts saved before retirement; the current executor no longer produces them. */
const RETIRED_BRANCH_KEY = "reportCard";

/**
 * Historical queries won by a retired branch: neither the generated answer nor the query process is displayed anymore. The winner column and
 * the thinking state are both persisted winning facts (the winner column of old rows is backfilled by migration); either naming a retired branch counts.
 */
export function isWonByRetiredBranch(run: QueryRun | null | undefined): boolean {
  return run?.winner === RETIRED_BRANCH_KEY || run?.thinkingState?.winner === RETIRED_BRANCH_KEY;
}

/** Persisted branch keys are strings: records saved before retirement may name a retired branch. */
type SavedThinkingBranch = Omit<ThinkingBranchState, "key"> & { key: string };

/** With retired branches removed, everything left is a branch the current executor has produced. */
function isCurrentBranch(branch: SavedThinkingBranch): branch is ThinkingBranchState {
  return branch.key !== RETIRED_BRANCH_KEY;
}

/**
 * Reads the thinking process back. Thinking states saved before retirement contain pre-computed branches: drop them and rebuild
 * titles, summaries, and steps the way the executor does, so the process presents only current branches; all other runs are read back as-is.
 */
function readThinking(run: QueryRun | null | undefined) {
  const saved = run?.thinkingState;
  // Old-row migration only guarantees the thinking state is an object, not that it carries branches.
  const branches: SavedThinkingBranch[] | undefined = saved?.branches;
  if (!branches || branches.every(isCurrentBranch)) {
    return { summary: run?.thinkingSummary, steps: run?.thinkingSteps, state: saved };
  }
  const state: QueryThinkingState = {
    ...saved,
    headline: t("query.thinking.parallelStart"),
    branches: branches.filter(isCurrentBranch),
  };
  state.summary = buildThinkingSummary(state);
  return { summary: state.summary, steps: buildThinkingSteps(state.summary), state };
}

/**
 * Reads saved query run facts back into execution facts. Pairs with buildQueryRunInput: writing and reading each exist in exactly
 * one place, callers stop hand-copying field by field, and a new fact can never silently miss one of the readers.
 */
export function toQueryExecutionFact(run?: QueryRun | null): QueryExecutionFact {
  if (isWonByRetiredBranch(run)) return {};
  const thinking = readThinking(run);
  return {
    // Persisted old run facts carry no fullContent value: fall back to the result table on the same row,
    // otherwise these real results would be invisible in history. All new writes include fullContent.
    fullContent: run?.fullContent ?? run?.markdownTable,
    thinkingSummary: thinking.summary,
    thinkingSteps: thinking.steps,
    thinkingState: thinking.state,
    backendSessions: run?.backendSessions,
    nodeIds: run?.nodeIds,
    markdownTable: run?.markdownTable,
    data: run?.dataPayload,
    datasets: run?.datasetsPayload,
    datasetPreviews: run?.datasetPreviews,
    dsl: run?.dslPayload,
    dslText: run?.dslText,
    ir: run?.ir,
    objectClasses: run?.objectClasses,
    dataCount: run?.dataCount,
    abcSubQuestions: run?.abcSubQuestions,
    abcDsls: run?.abcDsls,
    abcCodes: run?.abcCodes,
    abcOutKeyRefs: run?.abcOutKeyRefs,
    replayPlan: run?.replayPlan,
    cards: run?.cards,
    winner: run?.winner as QueryExecutionFact["winner"],
    qcResult: run?.qcResult,
    qcState: run?.qcState,
    error: run?.error,
  };
}

const DISPLAY_FACT_KEYS = [
  "thinkingSummary",
  "thinkingSteps",
  "fullContent",
  "markdownTable",
  "data",
  "datasets",
  "datasetPreviews",
  "dsl",
  "dataCount",
  "abcSubQuestions",
  "abcDsls",
  "abcCodes",
  "abcOutKeyRefs",
  "thinkingState",
  "winner",
  "qcState",
  "qcResult",
  "error",
] as const satisfies readonly (keyof QueryExecutionDisplayFact)[];

/** Picks the display part of execution facts. Facts that were never produced do not appear; callers decide rendering by presence. */
export function toDisplayFact(
  fact: QueryExecutionFact | null | undefined
): QueryExecutionDisplayFact {
  const display: Record<string, unknown> = {};
  if (!fact) return display;
  for (const key of DISPLAY_FACT_KEYS) {
    if (fact[key] !== undefined) display[key] = fact[key];
  }
  return display;
}

/** Stable identity of a query run. */
export interface QueryRunIdentity {
  threadId: string;
  requestSeq: number;
  sourceKind: string;
  sourceRef: string;
  sourceStage?: string;
}

/**
 * Converts execution facts into the write input for query run facts. This is the only persistence constructor:
 * standard query and analysis sub-questions write the same set of columns through it.
 */
export function buildQueryRunInput(input: {
  identity: QueryRunIdentity;
  question: string;
  status?: string;
  error?: string;
  fact: QueryExecutionFact;
}): UpsertQueryRunInput {
  const { identity, fact } = input;
  // DSL text, object class lists, and data row counts can all be derived deterministically from this dataset; both callers share one derivation,
  // neither implements its own, and neither can skip writing it. When a caller passes values explicitly, those win.
  const datasets = Array.isArray(fact.datasets) ? (fact.datasets as any[]) : undefined;
  const lastDataset = datasets && datasets.length > 0 ? datasets[datasets.length - 1] : undefined;
  const dsl = fact.dsl ?? lastDataset?.dsl;
  const dslText = fact.dslText ?? buildDslText(lastDataset?.dsl);
  const objectClasses = fact.objectClasses ?? extractObjectClasses(lastDataset?.dsl);
  const dataCount =
    fact.dataCount ?? (Array.isArray(lastDataset?.data) ? lastDataset.data.length : undefined);
  // The thinking summary is a derived expression of the thinking state; the two share one source. When a caller does not pass it, take it from the
  // thinking state so one caller forgetting to copy it cannot leave the column permanently empty.
  const thinkingSummary = fact.thinkingSummary ?? fact.thinkingState?.summary;

  return {
    threadId: identity.threadId,
    requestSeq: identity.requestSeq,
    sourceKind: identity.sourceKind,
    sourceRef: identity.sourceRef,
    sourceStage: identity.sourceStage,
    question: input.question,
    status: input.status || "completed",
    error: input.error,
    backendSessions: fact.backendSessions,
    nodeIds: fact.nodeIds,
    markdownTable: fact.markdownTable,
    datasetPreviews: fact.datasetPreviews,
    cards: fact.cards,
    winner: fact.winner,
    // The analysis side supplies a query-result data wrapper; standard query has no separate wrapper and reuses this dataset directly.
    dataPayload: fact.data ?? fact.datasets,
    datasetsPayload: fact.datasets,
    dslPayload: dsl,
    dslText,
    ir: fact.ir,
    fullContent: fact.fullContent,
    thinkingSummary,
    thinkingSteps: fact.thinkingSteps,
    thinkingState: fact.thinkingState,
    objectClasses,
    dataCount,
    abcSubQuestions: fact.abcSubQuestions,
    abcDsls: fact.abcDsls,
    abcCodes: fact.abcCodes,
    abcOutKeyRefs: fact.abcOutKeyRefs,
    replayPlan: fact.replayPlan,
  };
}

function buildDslText(dsl: any): string | undefined {
  const graph = dsl?.answer?.steps?.[0]?.graph;
  return graph?.patterns ? JSON.stringify(graph) : undefined;
}

/** Extracts the object classes participating in this query from the DSL query steps. */
function extractObjectClasses(dsl: any): string[] | undefined {
  if (!dsl?.problem) return undefined;
  const classes = new Set<string>();
  try {
    for (const step of dsl?.answer?.steps || []) {
      for (const pattern of step?.graph?.patterns || []) {
        for (const object of pattern?.objects || []) {
          const className = String(object?.class || "")
            .replace(/^\/+/, "")
            .split("/")[0];
          if (className) classes.add(className);
        }
      }
    }
  } catch {
    /* On an unexpected DSL shape treat it as no object classes; this must not block persisting the query facts */
  }
  return Array.from(classes);
}

/**
 * Display form of the quality check: built from execution facts for task-planning history context.
 * The quality check has exactly one channel; readers take it from here, never from the reply snapshot.
 */
export function buildQualityCheckView(
  run?: Pick<QueryRun, "qcState" | "qcResult"> | null
): { state?: unknown; content?: string } | undefined {
  if (!run?.qcState && !run?.qcResult) return undefined;
  return { state: run.qcState, content: (run.qcResult as { conclusion?: string })?.conclusion };
}
