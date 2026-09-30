/**
 * Dimensionalized sub-questions and this analysis's dimension execution plan.
 */

import type { AnalysisQueryFact } from "../runtime/evidence-types";

/**
 * A dimensionalized sub-question
 */
export interface DimensionalizedQuestion {
  /** Sub-question ID */
  id: string;
  /** Dimension ID */
  dimensionId: string;
  /** Dimension name */
  dimensionName: string;
  /** Dimension value */
  dimensionValue: string;
  /** The generated sub-question */
  subQuestion: string;
  /** The original question */
  originalQuestion: string;
}

/**
 * A sub-question with query results (for persistence) = plan entry + execution facts + plan-side status copy.
 * Execution fields are not re-declared here; they travel with AnalysisQueryFact.
 */
export interface DimensionalizedQuestionWithResult
  extends DimensionalizedQuestion, AnalysisQueryFact {
  /** Query status */
  status?: "pending" | "running" | "completed" | "failed";
  /** Query result status text */
  statusText?: string;
}

/**
 * This analysis's dimension execution plan
 */
export interface PlannedDimension {
  /** Dimension ID */
  dimensionId: string;
  /** Dimension name */
  dimensionName: string;
  /** Dimension value */
  dimensionValue: string;
  /** Reason for the split */
  reason?: string;
  /** Sub-question list */
  subQuestions: DimensionalizedQuestion[];
}

/**
 * Dimension plan with query results (for persistence)
 */
export interface PlannedDimensionWithResults extends Omit<PlannedDimension, "subQuestions"> {
  /** Dimension query status */
  status?: "pending" | "running" | "completed" | "partial" | "failed";
  /** Sub-question list (with query results) */
  subQuestions: DimensionalizedQuestionWithResult[];
}
