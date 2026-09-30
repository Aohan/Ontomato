/**
 * Agent identity inside LLM logs and diagnosis display names.
 *
 * Each model call in this service takes this edition's agentName by semantic role; agentName is written into LLM logs as a persisted identifier.
 * Each edition installs its pre-migration original values, independent of request language or APP_DEFAULT_LOCALE. Diagnosis interprets the
 * agentName in this service's and the data engine backend's logs into display names via the same catalog, falling back to the raw name when absent.
 * Fixed names that were never renamed (Skill-*, Dashboard-*, API-TitleGenerator, etc.) are still written directly at call sites.
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
  /** The agentName a role writes into logs; roles listed in the catalog also carry a display name. */
  roles: Record<ModelAgentRole, { agentName: string; displayName?: string }>;
  /** Names in this service's logs outside the roles above: fixed names and historical names. */
  otherDisplayNames: Record<string, string>;
  /** agentName of the data engine backend's agent-llm logs. */
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
