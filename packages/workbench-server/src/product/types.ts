import type { LogSourceType, ParsedLogSource } from "@ontomato/contracts/observe";

/**
 * Product literals already written into logs, locks, fences, and directories.
 * Each edition app installs its own values and must not change its historical
 * ones. Fields whose values are edition-specific language literals are typed as
 * string here; each app pins its own literals locally.
 */
export interface WorkbenchProduct {
  proxyMountPath: "/data-agent" | "/ontomato";
  logFileName: "data-agent.log" | "ontomato.log";
  llmLogFileName: "data-agent_llm.jsonl" | "ontomato_llm.jsonl";
  migrationLockKey: "data-agent:postgres-business-migrations" | "ontomato:postgres-business-migrations";
  subgraphFence: "data-agent-subgraph" | "ontomato-subgraph";
  mcpClientName: "data-agent" | "ontomato";
  analysisMcpServerName: "data-agent-analysis-agents" | "ontomato-analysis-agents";
  opsMcpServerName: "data-agent-ops-agent" | "ontomato-ops-agent";
  systemMcpCatalogName: "dataagent-mcp" | "ontomato-mcp";
  serviceDisplayName: "Data Agent" | "Ontomato";
  emailFooter: string;
  logDirEnvName: "DATA_AGENT_LOG_DIR" | "ONTOMATO_LOG_DIR";
  smtpFromAddress: "noreply@data-agent.local" | "noreply@ontomato.local";
  logSource: Extract<ParsedLogSource, "data-agent" | "ontomato">;
  appLogSourceType: Extract<LogSourceType, "data-agent-app" | "ontomato-app">;
  llmLogSourceType: Extract<LogSourceType, "data-agent-llm" | "ontomato-llm">;
  /** Matching rules for sessionId / backendNodeId in log text. Each edition keeps its pre-migration regex as-is (the enterprise edition also matches full-width colons). */
  logIdPatterns: { sessionId: RegExp; backendNodeId: RegExp };
  /** Bracket annotations (e.g. units) stripped from model-returned field names during dashboard field mapping. Each edition keeps its pre-migration regex as-is (the enterprise edition also matches full-width brackets). */
  chartFieldAnnotationPattern: RegExp;
  /** Class path extraction from dataset class-definition Markdown: line-start form and table-cell form. Each edition keeps its pre-migration regex as-is (the enterprise edition also ends on full-width commas). */
  datasetClassPathPatterns: { line: RegExp; tableCell: RegExp };
  /**
   * Directory and query-logic file names persisted in diagnosis workspaces.
   * Each edition keeps its own pre-migration names; its knowledge, skills, and
   * diagnosis prompts reference artifacts through these names. The escaped
   * literals are the enterprise edition's historical Chinese directory names
   * already written to disk in existing deployments; they are persisted
   * identifiers, not UI copy.
   */
  diagnosisWorkspaceNames: {
    rawLogs: "\u539f\u59cb\u65e5\u5fd7" | "raw-logs";
    prompts: "\u63d0\u793a\u8bcd" | "prompts";
    diagnostics: "\u8bca\u65ad\u7ed3\u679c" | "diagnostics";
    subTurns: "\u5b50Turn" | "sub-turns";
    upstreamTurns: "\u4e0a\u6e38Turn" | "upstream-turns";
    queryLogicFile: "mqls_logic.md" | "query_logic.md";
  };
  /** Group names and default service names for backend/frontend in service-health diagnosis output. */
  serviceHealthNames: {
    backendGroup: string;
    backendDefault: string;
    frontendGroup: string;
    frontendDefault: string;
  };
  /** Table header shown for localized group column names in the fallback field display plan. The escaped literal is the historical Chinese group column header matched in user data. */
  groupColumnHeader: "\u5206\u7ec4" | "group";
  /** Primary dimension column detection: words equal to a column name, and words contained in a column name (both editions also share the name / *_name checks). */
  primaryDimensionHeaders: { exact: readonly string[]; contains: readonly string[] };
  /** Detects whether a question already carries data: requires one data word and one option word. */
  userDataKeywords: { data: readonly string[]; option: readonly string[] };
  /** Migration demo copy persisted into in-database titles and failure reasons; each edition must keep its pre-migration sentences. */
  migrationCopy: {
    recordsMustBeObjects: (field: string) => string;
    summaryTitle: string;
    dimensionValueSeparator: string;
    conversionFailed: (message: string) => string;
  };
}
