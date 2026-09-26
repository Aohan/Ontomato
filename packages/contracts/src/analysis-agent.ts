export type AnalysisAgentExecutionMode = "dimension" | "loop";

/** 综合总结在报告中的展示位置。历史智能体缺省为报告末尾。 */
export type AnalysisReportSummaryPosition = "top" | "bottom";

export interface AnalysisAgent {
  /** 业务 ID (UUID) */
  id: string;
  /** 智能体名称 */
  name: string;
  /** 智能体描述 */
  description: string;
  /** 图标（可选） */
  icon?: string;
  /** 执行形态标记，未标记的智能体走维度编排 */
  executionMode: AnalysisAgentExecutionMode;
  /** 循环形态提示词：角色定位、分析方法与报告结构要求；仅循环形态生效 */
  loopPrompt?: string;
  /** 是否挂载报告交付件；关闭时循环以最终回复与轨迹交付 */
  reportDeliverableEnabled: boolean;
  /** 分析维度提示词（用于拆分维度生成子问题） */
  analysisDimensionPrompt?: string;
  /** 维度报告生成提示词 */
  summarizerPrompt: string;
  /** 多维度总结提示词 */
  conclusionMakerPrompt: string;
  /** 综合总结在报告中的展示位置；未配置的历史智能体按报告末尾处理 */
  summaryPosition?: AnalysisReportSummaryPosition;
  /** 启用的分析技能 ID 列表 */
  enabledSkillIds?: string[];
  /** 启用的分析可视化技能 ID 列表 */
  enabledVisualizationSkillIds?: string[];
  /** 显式授权给循环主管的外部 MCP 服务名快照 */
  enabledMcpServiceNames?: string[];
  /** 关联的对象类名列表，用于限制维度拆分和问数范围 */
  classNames?: string[];
  /** 是否启用 */
  isEnabled: boolean;
  /** 排序序号（数值越小越靠前） */
  sortOrder?: number;
  /** 创建时间戳 */
  createdAt: number;
  /** 更新时间戳 */
  updatedAt: number;
}

export type DimensionType = "categorical" | "temporal" | "numeric";

export type DimensionValueSource = "static" | "dataset_field";

export interface AnalysisDimension {
  id: string;
  agentId: string;
  name: string;
  dimensionType: DimensionType;
  values?: string[];
  valueSource: DimensionValueSource;
  datasetField?: string;
  subQuestionTemplate: string;
  order?: number;
  isEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}
