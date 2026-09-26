import type {
  ThinkingStep,
  QueryThinkingState,
  BranchKey,
  QcState,
  QcResult,
} from "./query-thinking";
/** 展示用的多数据集预览。 */
export interface QueryFactDatasetPreview {
  title: string;
  markdownTable: string;
  dataCount: number;
}

/**
 * 查询记录里的一个后端会话：产生它的分支键、会话号，以及执行时上报的 datarag 节点。
 * 每条有模型参与的分支各有一个后端会话，同一事实不另用单值字段表达
 * （问数后端会话的定位与取消·设计 1、6）。
 */
export interface QueryBackendSession {
  branch: BranchKey;
  sessionId: string;
  nodeId?: string;
}

export interface QueryExecutionDisplayFact {
  thinkingSummary?: string;
  thinkingSteps?: ThinkingStep[];
  thinkingState?: QueryThinkingState;
  /** 完整回答正文：与标准问数回复快照的正文同一份，表格、子图都在其中，只显示一次。 */
  fullContent?: string;
  /** 展示表格 */
  markdownTable?: string;
  /** 原始数据 */
  data?: unknown;
  /** 结构化数据集 */
  datasets?: unknown[];
  datasetPreviews?: QueryFactDatasetPreview[];
  dsl?: unknown;
  dataCount?: number;
  /** 二级拆解产出：DSL 型给出 abcDsls，程序型给出 abcCodes 与 abcOutKeyRefs */
  abcSubQuestions?: string[];
  abcDsls?: unknown[];
  abcCodes?: string[];
  abcOutKeyRefs?: unknown[][];
  winner?: BranchKey;
  qcResult?: QcResult;
  qcState?: QcState;
  /** 执行失败原因；失败也是执行事实的一部分，展示视图据它渲染失败态 */
  error?: string;
}
