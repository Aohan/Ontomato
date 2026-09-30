import type { QueryFactDatasetPreview as QueryResultDatasetPreview } from "@ontomato/contracts/query-execution";
/**
 * Evidence layer: normalized sub-question query results for charts and reports, with source tracing.
 */

import type { Dataset, FieldDisplayPlan } from "../../data-query/adapter";
import type { QueryResultData, QueryResultDsl } from "./query-result";
import type { QueryExecutionFact } from "../../data-query/query-fact";

/**
 * Evidence layer data structure - normalized query results for charts and reports
 */
export interface AnalysisEvidence {
  /** Sub-question ID */
  questionId: string;
  /** Sub-question text */
  questionText: string;
  /** Dimension ID */
  dimensionId: string;
  /** Dimension name */
  dimensionName: string;
  /** Query status */
  status: "completed" | "failed";
  /** Data */
  data: any[];
  /** Data row count */
  dataCount: number;
  /** Field display plan used when answering the user */
  fieldDisplayPlan?: FieldDisplayPlan;
  /** Markdown table */
  markdownTable?: string;
  /** Key findings */
  keyFindings?: string[];
  /** Sub-questions after ABC decomposition */
  abcSubQuestions?: string[];
  /** Error message */
  error?: string;
}

/**
 * Execution facts consumed by the analysis domain: the same fields as data-query's QueryExecutionFact, with only data and
 * DSL shapes narrowed. Every query result type in the analysis domain adds on top of it and never re-declares execution fields.
 */
export interface AnalysisQueryFact extends Omit<
  QueryExecutionFact,
  "data" | "dsl" | "datasets" | "datasetPreviews"
> {
  /** Query result data */
  data?: QueryResultData;
  /** DSL information */
  dsl?: QueryResultDsl;
  /** Datasets */
  datasets?: Dataset[];
  /** Multi-dataset preview */
  datasetPreviews?: QueryResultDatasetPreview[];
}

/**
 * Dimension query result = execution facts + the plan identity and business execution state the analysis domain attaches.
 */
export interface DimensionQueryResult extends AnalysisQueryFact {
  /** Stable sub-question ID */
  questionId: string;
  /** Dimension ID */
  dimensionId: string;
  /** Dimension name */
  dimensionName: string;
  /** Dimension value */
  dimensionValue: string;
  /** Sub-question */
  subQuestion: string;
  /** Query status */
  status: "pending" | "in_progress" | "completed" | "failed";
  /** Error message */
  error?: string;
}
