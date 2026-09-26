import type { LogSourceType, ParsedLogSource } from "@ontomato/contracts/observe";

/** 已经写进日志、锁、围栏和目录的产品字面量。两版各装自己的，不改历史值。 */
export interface WorkbenchProduct {
  proxyMountPath: "/data-agent" | "/ontomato";
  logFileName: "data-agent.log" | "ontomato.log";
  llmLogFileName: "data-agent_llm.jsonl" | "ontomato_llm.jsonl";
  migrationLockKey: "data-agent:postgres-business-migrations" | "ontomato:postgres-business-migrations";
  subgraphFence: "data-agent-subgraph" | "ontomato-subgraph";
  mcpClientName: "data-agent" | "ontomato";
  analysisMcpServerName: "data-agent-analysis-agents" | "ontomato-analysis-agents";
  systemMcpCatalogName: "dataagent-mcp" | "ontomato-mcp";
  serviceDisplayName: "Data Agent" | "Ontomato";
  emailFooter: "此邮件由 Data Agent 自动发送" | "This email was sent automatically by Ontomato";
  logDirEnvName: "DATA_AGENT_LOG_DIR" | "ONTOMATO_LOG_DIR";
  smtpFromAddress: "noreply@data-agent.local" | "noreply@ontomato.local";
  logSource: Extract<ParsedLogSource, "data-agent" | "ontomato">;
  appLogSourceType: Extract<LogSourceType, "data-agent-app" | "ontomato-app">;
  llmLogSourceType: Extract<LogSourceType, "data-agent-llm" | "ontomato-llm">;
  /** 日志文本里 sessionId / backendNodeId 的匹配规则。两版迁出前的正则原样保留（企业另认全角冒号）。 */
  logIdPatterns: { sessionId: RegExp; backendNodeId: RegExp };
  /** 仪表盘字段映射时从模型返回的字段名上去掉的括号注释（如单位）。两版迁出前的正则原样保留（企业另认全角括号）。 */
  chartFieldAnnotationPattern: RegExp;
  /** 数据集类定义 Markdown 里取类路径：行首写法与表格单元格写法。两版迁出前的正则原样保留（企业另以全角逗号结束）。 */
  datasetClassPathPatterns: { line: RegExp; tableCell: RegExp };
  /**
   * 诊断工作区落盘的目录与查询逻辑文件名。两版迁出前各自的名字；
   * 各自的知识、技能与诊断提示词按这些名字引用产物。
   */
  diagnosisWorkspaceNames: {
    rawLogs: "原始日志" | "raw-logs";
    prompts: "提示词" | "prompts";
    diagnostics: "诊断结果" | "diagnostics";
    subTurns: "子Turn" | "sub-turns";
    upstreamTurns: "上游Turn" | "upstream-turns";
    queryLogicFile: "mqls_logic.md" | "query_logic.md";
  };
  /** 服务健康诊断输出里后端、前端的分组名与缺省服务名。 */
  serviceHealthNames: {
    backendGroup: "后端 datarag" | "Backend";
    backendDefault: "datarag" | "backend";
    frontendGroup: "前端 ragchat" | "Frontend";
    frontendDefault: "ragchat" | "frontend";
  };
  /** 兜底字段展示计划里，按本地化分组列名显示的表头。 */
  groupColumnHeader: "分组" | "group";
  /** 主维度列识别：与列名相等的词、列名包含即算的词（另有两版共同的 name / *_name 判断）。 */
  primaryDimensionHeaders: { exact: readonly string[]; contains: readonly string[] };
  /** 判断问题里是否自带数据：同时包含一个数据词和一个选项词。 */
  userDataKeywords: { data: readonly string[]; option: readonly string[] };
  /** 演示契约迁移写入库内标题和失败原因，必须保持迁出前的句子。 */
  migrationCopy: {
    recordsMustBeObjects: (field: string) => string;
    summaryTitle: "综合总结" | "Comprehensive Summary";
    dimensionValueSeparator: "：" | ": ";
    conversionFailed: (message: string) => string;
  };
}
