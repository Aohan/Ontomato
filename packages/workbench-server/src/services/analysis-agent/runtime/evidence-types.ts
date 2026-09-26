import type { QueryFactDatasetPreview as QueryResultDatasetPreview } from "@ontomato/contracts/query-execution";
/**
 * 证据层：标准化的子问题查询结果，供图表与报告消费，并带来源追踪。
 */

import type { Dataset, FieldDisplayPlan } from "../../data-query/adapter";
import type { QueryResultData, QueryResultDsl } from "./query-result";
import type { QueryExecutionFact } from "../../data-query/query-fact";

/**
 * 证据层数据结构 - 标准化查询结果供图表和报告消费
 */
export interface AnalysisEvidence {
  /** 子问题 ID */
  questionId: string;
  /** 子问题文本 */
  questionText: string;
  /** 维度 ID */
  dimensionId: string;
  /** 维度名称 */
  dimensionName: string;
  /** 查询状态 */
  status: "completed" | "failed";
  /** 数据 */
  data: any[];
  /** 数据条数 */
  dataCount: number;
  /** 面向用户回答时使用的字段展示计划 */
  fieldDisplayPlan?: FieldDisplayPlan;
  /** Markdown 表格 */
  markdownTable?: string;
  /** 关键发现 */
  keyFindings?: string[];
  /** ABC 拆分后的子问题 */
  abcSubQuestions?: string[];
  /** 错误信息 */
  error?: string;
}

/**
 * 分析域消费的执行事实：与 data-query 的 QueryExecutionFact 同一批字段，只窄化数据与
 * DSL 的形状。分析域所有查询结果类型都在它之上做加法，不再各自声明执行字段。
 */
export interface AnalysisQueryFact extends Omit<
  QueryExecutionFact,
  "data" | "dsl" | "datasets" | "datasetPreviews"
> {
  /** 查询结果数据 */
  data?: QueryResultData;
  /** DSL 信息 */
  dsl?: QueryResultDsl;
  /** 数据集 */
  datasets?: Dataset[];
  /** 多数据集预览 */
  datasetPreviews?: QueryResultDatasetPreview[];
}

/**
 * 维度查询结果 = 执行事实 + 分析域附加的计划身份与业务执行状态。
 */
export interface DimensionQueryResult extends AnalysisQueryFact {
  /** 子问题稳定 ID */
  questionId: string;
  /** 维度 ID */
  dimensionId: string;
  /** 维度名称 */
  dimensionName: string;
  /** 维度值 */
  dimensionValue: string;
  /** 子问题 */
  subQuestion: string;
  /** 查询状态 */
  status: "pending" | "in_progress" | "completed" | "failed";
  /** 错误信息 */
  error?: string;
}
