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
 * 分析任务与任务事件。
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
  /** 事件自身的结构化事实；分析任务事件只承载派遣子轨迹审计 */
  payload?: unknown;
}

/**
 * 分析任务。
 *
 * 定时字段（`scheduleExpression` / `scheduleEnabled` / `nextRunAt`）不属于任务行，
 * 只在定时规则以任务形状出现在既有列表接口时被填充。
 */

/**
 * 创建分析任务的参数
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
  /** 关闭报告交付即为常规会话任务；缺省按交付报告任务创建。 */
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
