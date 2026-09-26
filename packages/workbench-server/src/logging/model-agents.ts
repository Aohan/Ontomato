/**
 * LLM 日志里的 Agent 身份与诊断显示名。
 *
 * 本服务各模型调用按语义角色取本版 agentName；agentName 写进 LLM 日志，是持久化标识，
 * 两版各装迁出前的原值，不随请求语言或 APP_DEFAULT_LOCALE 变化。诊断按同一份目录把
 * 本服务与 DataRAG 后端日志里的 agentName 解释成显示名，查不到的按原名显示。
 * 未改过名的固定名字（Skill-*、Dashboard-*、API-TitleGenerator 等）仍由调用处直接写。
 */
export type ModelAgentRole =
  | "taskPlanner"
  | "analysis"
  | "reply"
  | "dataResolver"
  | "abcDescription"
  | "conclusion"
  | "fieldAdapter"
  | "hotDataStatic"
  | "hotDataDynamic"
  | "abcHarnessAnswer"
  | "answerEvaluator"
  | "followUp"
  | "chartPlanner"
  | "analysisDimension"
  | "analysisReport"
  | "hotReportMatcher"
  | "analysisLoop"
  | "analysisLoopSubAgent";

export interface ModelAgentCatalog {
  /** 角色写入日志的 agentName；源目录收录的角色另有显示名。 */
  roles: Record<ModelAgentRole, { agentName: string; displayName?: string }>;
  /** 本服务日志里不属于上述角色的名字：固定名与历史名。 */
  otherDisplayNames: Record<string, string>;
  /** DataRAG 后端 agent-llm 日志的 agentName。 */
  backendDisplayNames: Record<string, string>;
}

let installed: ModelAgentCatalog | null = null;

export function installModelAgentCatalog(catalog: ModelAgentCatalog): void {
  installed = catalog;
}

export function modelAgentCatalog(): ModelAgentCatalog {
  if (!installed) throw new Error("Model agent catalog is not installed");
  return installed;
}

export function modelAgentName(role: ModelAgentRole): string {
  return modelAgentCatalog().roles[role].agentName;
}
