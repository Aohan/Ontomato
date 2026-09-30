/**
 * Runtime context of the dimension execution form.
 *
 * Before the LangGraph shell was dismantled these inputs hid inside `config.configurable`, read separately by three nodes;
 * the orchestrator now assembles them once and passes them explicitly to the stage functions.
 */

import type { PendingLateFacts } from "../../data-query/late-fact";
import { t } from "../../../i18n";
import type { DeepAnalysisEmittedEvent } from "@ontomato/contracts/analysis-events";

export interface DimensionRunContext {
  /** Where this run registers late facts; analysis never presents the quality check and does not wait for settlement after registering */
  lateFacts: PendingLateFacts;
  userQuestion: string;
  userId: string;
  threadId: string;
  taskId?: string;
  requestSeq: number;
  agentId: string;
  domainId: string;
  token: string;
  apiKey: string;
  locale?: string;
  summarizerPrompt: string;
  conclusionMakerPrompt: string;
  analysisDimensionPrompt?: string;
  enabledSkillIds: string[];
  /** An explicit empty array means no charts this run, distinct from "unconfigured, fall back to the agent settings" */
  enabledVisualizationSkillIds?: string[];
  /** Concurrency override; DEFAULT_ANALYSIS_CONCURRENCY applies when absent */
  analysisConcurrency?: {
    dimensionQueryConcurrency?: number;
    subQuestionQueryConcurrency?: number;
  };
  signal?: AbortSignal;
  sendEvent: (event: DeepAnalysisEmittedEvent) => void;
}

/** Stage errors keep the shape of the pre-split GraphState.errors; the orchestrator aggregates the terminal state from them. */
export interface DimensionStageError {
  node: string;
  message: string;
  timestamp: number;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error(t("analysis.cancelled"));
  }
}
