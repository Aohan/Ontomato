/**
 * 维度执行形态的运行上下文。
 *
 * 拆除 LangGraph 壳之前，这些入参藏在 `config.configurable` 里由三个节点各自读取；
 * 现在由编排器一次组装、显式传给各阶段函数。
 */

import type { PendingLateFacts } from "../../data-query/late-fact";
import { t } from "../../../i18n";
import type { DeepAnalysisEmittedEvent } from "@ontomato/contracts/analysis-events";

export interface DimensionRunContext {
  /** 本次运行登记迟到事实的位置；分析不呈现质检，登记后不等结算 */
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
  /** 显式空数组表示本次不出图，与"未配置、回退到智能体设置"区分 */
  enabledVisualizationSkillIds?: string[];
  /** 并发覆盖；未给出时用 DEFAULT_ANALYSIS_CONCURRENCY */
  analysisConcurrency?: {
    dimensionQueryConcurrency?: number;
    subQuestionQueryConcurrency?: number;
  };
  signal?: AbortSignal;
  sendEvent: (event: DeepAnalysisEmittedEvent) => void;
}

/** 阶段错误的形状与拆前的 GraphState.errors 一致，编排器按它聚合终态。 */
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
