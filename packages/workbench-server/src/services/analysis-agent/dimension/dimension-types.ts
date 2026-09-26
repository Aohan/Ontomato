/**
 * 维度化子问题与本次分析的维度执行计划。
 */

import type { AnalysisQueryFact } from "../runtime/evidence-types";

/**
 * 维度化后的子问题
 */
export interface DimensionalizedQuestion {
  /** 子问题 ID */
  id: string;
  /** 维度 ID */
  dimensionId: string;
  /** 维度名称 */
  dimensionName: string;
  /** 维度值 */
  dimensionValue: string;
  /** 生成的子问题 */
  subQuestion: string;
  /** 原始问题 */
  originalQuestion: string;
}

/**
 * 带查询结果的子问题（用于持久化）= 计划条目 + 执行事实 + 计划侧的状态文案。
 * 执行字段不在此重复声明，随 AnalysisQueryFact 走。
 */
export interface DimensionalizedQuestionWithResult
  extends DimensionalizedQuestion, AnalysisQueryFact {
  /** 查询状态 */
  status?: "pending" | "running" | "completed" | "failed";
  /** 查询结果状态文本 */
  statusText?: string;
}

/**
 * 本次分析的维度执行计划
 */
export interface PlannedDimension {
  /** 维度 ID */
  dimensionId: string;
  /** 维度名称 */
  dimensionName: string;
  /** 维度值 */
  dimensionValue: string;
  /** 拆分原因 */
  reason?: string;
  /** 子问题列表 */
  subQuestions: DimensionalizedQuestion[];
}

/**
 * 带查询结果的维度计划（用于持久化）
 */
export interface PlannedDimensionWithResults extends Omit<PlannedDimension, "subQuestions"> {
  /** 维度查询状态 */
  status?: "pending" | "running" | "completed" | "partial" | "failed";
  /** 子问题列表（带查询结果） */
  subQuestions: DimensionalizedQuestionWithResult[];
}
