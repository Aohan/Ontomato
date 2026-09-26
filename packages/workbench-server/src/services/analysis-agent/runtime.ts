import type { AnalysisAgentExecutionMode } from "@ontomato/contracts/analysis-agent";
import { runDeepAnalysisWorkflow } from "./dimension/dimension-workflow";
import { t } from "../../i18n";
import { getAnalysisAgentService } from "./config/agent-service";
import type { AnalysisConversationTurnRecord } from "./task/conversation-types";
import type { AnalysisRunIdentity } from "./task/run-history";
import { runAnalysisLoopWorkflow } from "./loop/loop-workflow";

import type { DeepAnalysisTaskPayload } from "@ontomato/contracts/analysis-presentation";
import type { DeepAnalysisEmittedEvent } from "@ontomato/contracts/analysis-events";

/** 智能体服务实例入口收敛在 config/agent-service.ts；此处按运行时门面继续对外暴露。 */
export { getAnalysisAgentService };

type RunDeepAnalysisParams = {
  message: string;
  userId: string;
  threadId: string;
  taskId: string;
  /** 受理时捕获的运行身份；产物与终态据此确认是否仍可写当前任务。 */
  identity?: AnalysisRunIdentity;
  agentId: string;
  domainId: string;
  token: string;
  apiKey?: string;
  onEvent: (event: DeepAnalysisEmittedEvent) => void;
  signal?: AbortSignal;
  conversationTurn?: AnalysisConversationTurnRecord;
  /** 已创建任务的交付模式快照；直接运行时使用智能体默认配置。 */
  reportDeliverableEnabled?: boolean;
  /** 预加载的 agent 配置，避免重复查询 DB */
  agentConfig?: {
    executionMode: AnalysisAgentExecutionMode;
    summarizerPrompt: string;
    conclusionMakerPrompt: string;
    analysisDimensionPrompt?: string;
    enabledSkillIds?: string[];
    enabledVisualizationSkillIds?: string[];
    reportDeliverableEnabled?: boolean;
  };
};

export async function runDeepAnalysis(
  params: RunDeepAnalysisParams
): Promise<DeepAnalysisTaskPayload | undefined> {
  const { agentConfig } = params;

  let executionMode: AnalysisAgentExecutionMode;
  let summarizerPrompt: string;
  let conclusionMakerPrompt: string;
  let analysisDimensionPrompt: string | undefined;
  let enabledSkillIds: string[] | undefined;
  let enabledVisualizationSkillIds: string[] | undefined;
  let agentReportDeliverableEnabled: boolean | undefined;

  if (agentConfig) {
    executionMode = agentConfig.executionMode;
    summarizerPrompt = agentConfig.summarizerPrompt;
    conclusionMakerPrompt = agentConfig.conclusionMakerPrompt;
    analysisDimensionPrompt = agentConfig.analysisDimensionPrompt;
    enabledSkillIds = agentConfig.enabledSkillIds;
    enabledVisualizationSkillIds = agentConfig.enabledVisualizationSkillIds;
    agentReportDeliverableEnabled = agentConfig.reportDeliverableEnabled;
  } else {
    const service = await getAnalysisAgentService();
    const agent = await service.getAgent(params.agentId, params.domainId);
    if (!agent) {
      throw new Error(t("analysis.agentNotFound", { agentId: params.agentId }));
    }
    executionMode = agent.executionMode;
    summarizerPrompt = agent.summarizerPrompt;
    conclusionMakerPrompt = agent.conclusionMakerPrompt;
    analysisDimensionPrompt = agent.analysisDimensionPrompt;
    enabledSkillIds = agent.enabledSkillIds;
    enabledVisualizationSkillIds = agent.enabledVisualizationSkillIds;
    agentReportDeliverableEnabled = agent.reportDeliverableEnabled;
  }

  // 已受理的常规会话轮次固定使用循环；分析任务仍按当前智能体配置分派。
  if (params.conversationTurn || executionMode === "loop") {
    return runAnalysisLoopWorkflow({
      userQuestion: params.message,
      userId: params.userId,
      threadId: params.threadId,
      taskId: params.taskId,
      identity: params.identity,
      agentId: params.agentId,
      domainId: params.domainId,
      token: params.token,
      apiKey: params.apiKey,
      onEvent: params.onEvent,
      signal: params.signal,
      conversationTurn: params.conversationTurn,
      reportDeliverableEnabled: params.reportDeliverableEnabled ?? agentReportDeliverableEnabled,
    });
  }

  return runDeepAnalysisWorkflow({
    userQuestion: params.message,
    userId: params.userId,
    domainId: params.domainId,
    threadId: params.threadId,
    taskId: params.taskId,
    identity: params.identity,
    onEvent: params.onEvent,
    token: params.token,
    apiKey: params.apiKey,
    agentId: params.agentId,
    summarizerPrompt,
    conclusionMakerPrompt,
    analysisDimensionPrompt,
    enabledSkillIds,
    enabledVisualizationSkillIds,
    signal: params.signal,
  });
}
