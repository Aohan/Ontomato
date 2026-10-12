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

/**
 * Identity of one result dataset. The server creates it where the dataset is created, and it travels
 * unchanged through events, saved runs, history and analysis merges. Datasets saved before this field
 * existed have no id.
 */
export interface QueryDatasetIdentity {
  id: string;
}

/**
 * Where the answer body places a dataset's actions (row count, downloads, details). The server writes
 * it right after that dataset's sub-question and table or empty state; it is invisible in rendered
 * Markdown.
 */
export function datasetPlacement(datasetId: string): string {
  return `<!-- query-dataset:${datasetId} -->`;
}

const DATASET_PLACEMENT_PATTERN = /<!-- query-dataset:([\w-]+) -->/g;

export type AnswerBodyPiece =
  | { kind: "text"; text: string }
  | { kind: "dataset"; datasetId: string };

/** The answer body in order: text between placements, and each placement's dataset id. */
export function splitAnswerBody(body: string): AnswerBodyPiece[] {
  const pieces: AnswerBodyPiece[] = [];
  let cursor = 0;
  for (const match of body.matchAll(DATASET_PLACEMENT_PATTERN)) {
    if (match.index > cursor) pieces.push({ kind: "text", text: body.slice(cursor, match.index) });
    pieces.push({ kind: "dataset", datasetId: match[1]! });
    cursor = match.index + match[0].length;
  }
  if (cursor < body.length) pieces.push({ kind: "text", text: body.slice(cursor) });
  return pieces;
}

/** The answer body as plain text for copying, exports and model input: placements removed. */
export function answerBodyText(body: string): string {
  return body.replace(DATASET_PLACEMENT_PATTERN, "");
}

export interface QueryExecutionDisplayFact {
  thinkingSummary?: string;
  thinkingSteps?: ThinkingStep[];
  thinkingState?: QueryThinkingState;
  /**
   * Full answer body: the same body as the standard query reply snapshot, tables and subcharts
   * included, rendered only once; dataset actions are placed with `datasetPlacement`.
   */
  fullContent?: string;
  /** Tables for display */
  markdownTable?: string;
  /** Raw data */
  data?: unknown;
  /** Structured datasets, each carrying its `QueryDatasetIdentity` */
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
