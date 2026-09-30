import type {
  ThinkingStep,
  QueryThinkingState,
  BranchKey,
  QcState,
  QcResult,
} from "./query-thinking";
/** Multi-dataset preview for display. */
export interface QueryFactDatasetPreview {
  title: string;
  markdownTable: string;
  dataCount: number;
}

/**
 * One backend session in a query record: the branch key that produced it, the
 * session number, and the data-engine node reported at execution time.
 * Each model-involved branch gets its own backend session; the same fact is
 * never re-expressed through a single-value field
 * (backend session locating and cancellation · design 1, 6).
 */
export interface QueryBackendSession {
  branch: BranchKey;
  sessionId: string;
  nodeId?: string;
}

export interface QueryExecutionDisplayFact {
  thinkingSummary?: string;
  thinkingSteps?: ThinkingStep[];
  thinkingState?: QueryThinkingState;
  /** Full answer body: the same body as the standard query reply snapshot, tables and subcharts included, rendered only once. */
  fullContent?: string;
  /** Tables for display */
  markdownTable?: string;
  /** Raw data */
  data?: unknown;
  /** Structured datasets */
  datasets?: unknown[];
  datasetPreviews?: QueryFactDatasetPreview[];
  dsl?: unknown;
  dataCount?: number;
  /** Second-level decomposition output: DSL forms provide abcDsls, program forms provide abcCodes and abcOutKeyRefs */
  abcSubQuestions?: string[];
  abcDsls?: unknown[];
  abcCodes?: string[];
  abcOutKeyRefs?: unknown[][];
  winner?: BranchKey;
  qcResult?: QcResult;
  qcState?: QcState;
  /** Execution failure reason; failure is part of the execution facts, and the display view renders the failed state from it */
  error?: string;
}
