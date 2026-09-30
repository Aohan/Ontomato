import type { AgentMessage } from "../../core/agent-loop/types";
import type { LoopSubagentTrace } from "@ontomato/contracts/analysis-task";
import type { DeepAnalysisTaskPayload } from "@ontomato/contracts/analysis-presentation";
import type {
  AnalysisTask as ClientAnalysisTask,
  AnalysisTaskTriggerSource,
} from "@ontomato/contracts/analysis-task";
export interface AnalysisTask extends ClientAnalysisTask {
  domainId: string;
  analysisPayload?: DeepAnalysisTaskPayload;
  requestSeq?: number;
  token?: string;
}
/**
 * Analysis tasks and task events.
 */

export interface UpsertAnalysisTaskEventInput {
  taskId: string;
  eventSeq: number;
  eventType: string;
  eventName: string;
  status?: string;
  phase?: string;
  sourceKind?: string;
  sourceRef: string;
  /** Structured facts of the event itself; analysis task events only carry dispatch sub-trajectory audit */
  payload?: unknown;
}

/**
 * An analysis task.
 *
 * Schedule fields (`scheduleExpression` / `scheduleEnabled` / `nextRunAt`) are not part of the task row;
 * they are filled only when schedule rules appear in task shape through the existing list endpoints.
 */

/**
 * Parameters for creating an analysis task
 */
export interface CreateAnalysisTaskParams {
  agentId: string;
  userId: string;
  domainId: string;
  name: string;
  description?: string;
  question: string;
  threadId?: string;
  notifyEmail?: string;
  notifyOnComplete?: boolean;
  triggerSource?: AnalysisTaskTriggerSource;
  token?: string;
  /** With report delivery off this is a regular session task; by default the task is created as a report-delivery task. */
  reportDeliverableEnabled?: boolean;
}

export const ANALYSIS_LOOP_SUBAGENT_SOURCE_KIND = "analysis_loop_subagent";
export interface AnalysisLoopSubagentAudit extends Omit<LoopSubagentTrace, "messages"> {
  messages: AgentMessage[];
}

export interface AnalysisLoopSubagentReference {
  error?: string;
  activityId: string;
  topic: string;
  sessionId: string;
}
