import type { AnalysisChartResult, ProvenanceInfo } from "@ontomato/contracts/analysis-charts";
/**
 * 维度报告与多维度总结的生成入参与产物。
 */

import type { AnalysisEvidence } from "../runtime/evidence-types";

/**
 * 维度报告生成结果（带来源追踪）
 */
export interface DimensionReportGenerationResult {
  report: string;
  provenance: ProvenanceInfo;
}

/**
 * 多维度总结生成结果（带来源追踪）
 */
export interface MultiDimensionSummaryGenerationResult {
  summary: string;
  provenance: ProvenanceInfo;
}

/**
 * 维度报告生成参数
 */
export interface DimensionReportParams {
  /** 维度名称 */
  dimensionName: string;
  /** 维度值 */
  dimensionValue: string;
  /** 证据层数据（标准化查询结果） */
  evidence: AnalysisEvidence[];
  /** 数据集定义 */
  datasetSchema: string;
  /** 提示词规则 */
  summarizerPrompt: string;
  /** 分析维度提示词（用于指导报告生成） */
  analysisDimensionPrompt?: string;
  /** 分析技能执行结果 */
  skillResults?: any[];
  /** 前序已生成维度报告上下文 */
  priorDimensionReports?: Array<{
    dimensionName: string;
    dimensionValue: string;
    report: string;
  }>;
  charts?: AnalysisChartResult[];
  /** 展示值格式化使用的请求语言 */
  locale?: string;
  /** 取消信号 */
  signal?: AbortSignal;
}

/**
 * 多维度总结参数
 */
export interface MultiDimensionSummaryParams {
  /** 所有维度报告 */
  dimensionReports: Array<{
    dimensionName: string;
    dimensionValue: string;
    report: string;
  }>;
  /** 原始问题 */
  originalQuestion: string;
  /** 提示词规则 */
  conclusionMakerPrompt: string;
  /** 分析技能执行结果 */
  skillResults?: any[];
  /** 可用图表 */
  charts?: AnalysisChartResult[];
  /** 取消信号 */
  signal?: AbortSignal;
}
