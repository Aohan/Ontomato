import { tApp } from "../../../../i18n";
import type { PendingLateFacts } from "../../../data-query/late-fact";
import type { QueryExecutionFact } from "../../../data-query/query-fact";
import type { AnalysisResult, GraphState, QueryArtifactRef, VisualizationResult } from "../state";
import {
  buildQueryRunId,
  getQueryRunBySource,
  type QueryRun,
} from "../../../data-query/query-run-store";
import { createLogger } from "../../../../logging/logger";
import type { FieldDisplayPlan } from "../../../data-query/adapter";
import { currentDatasetRule } from "./current-dataset";

const logger = createLogger("query-artifact-cache");

export const STANDARD_QUERY_SOURCE_KIND = "query_stage";
export const STANDARD_QUERY_SOURCE_REF = "query";

export function createQueryArtifactRef(input: {
  threadId: string;
  requestSeq: number;
  sourceKind?: string;
  sourceRef?: string;
  queryRunId?: string;
}): QueryArtifactRef {
  const sourceKind = input.sourceKind || STANDARD_QUERY_SOURCE_KIND;
  const sourceRef = input.sourceRef || STANDARD_QUERY_SOURCE_REF;
  return {
    queryRunId: input.queryRunId || buildQueryRunId(input.threadId, input.requestSeq, sourceRef),
    threadId: input.threadId,
    requestSeq: input.requestSeq,
    sourceKind,
    sourceRef,
  };
}

export function createRuntimeArtifactRef(
  kind: "analysis" | "visualization",
  threadId: string,
  requestSeq: number
): string {
  return `${kind}:${threadId}:${requestSeq}`;
}

function queryArtifactKey(ref: QueryArtifactRef): string {
  return `${ref.threadId}:${ref.requestSeq}:${ref.sourceKind}:${ref.sourceRef}`;
}

function selectedDatasetFromQueryResult(queryResult?: QueryExecutionFact): any | undefined {
  const datasets = queryResult?.datasets as Array<{ data?: unknown }> | undefined;
  if (!Array.isArray(datasets) || datasets.length === 0) {
    return undefined;
  }
  return currentDatasetRule()(datasets);
}

function rowsFromDataset(dataset: any): Record<string, unknown>[] | undefined {
  return Array.isArray(dataset?.data) ? (dataset.data as Record<string, unknown>[]) : undefined;
}

function fieldDisplayPlanFromDataset(dataset: any): FieldDisplayPlan | undefined {
  const plan = dataset?.fieldDisplayPlan;
  return plan && typeof plan === "object" && !Array.isArray(plan)
    ? (plan as FieldDisplayPlan)
    : undefined;
}

export function extractRowsFromQueryResult(
  queryResult?: QueryExecutionFact
): Record<string, unknown>[] | undefined {
  return rowsFromDataset(selectedDatasetFromQueryResult(queryResult));
}

export class QueryArtifactCache {
  private readonly queryResults = new Map<string, QueryExecutionFact>();
  private readonly analysisResults = new Map<string, AnalysisResult>();
  private readonly visualizationResults = new Map<string, VisualizationResult>();

  setQueryResult(ref: QueryArtifactRef, queryResult: QueryExecutionFact): void {
    this.queryResults.set(queryArtifactKey(ref), queryResult);
  }

  getQueryResult(ref: QueryArtifactRef | undefined): QueryExecutionFact | undefined {
    return ref ? this.queryResults.get(queryArtifactKey(ref)) : undefined;
  }

  setAnalysisResult(ref: string, analysisResult: AnalysisResult): void {
    this.analysisResults.set(ref, analysisResult);
  }

  getAnalysisResult(ref: string | undefined): AnalysisResult | undefined {
    return ref ? this.analysisResults.get(ref) : undefined;
  }

  setVisualizationResult(ref: string, visualizationResult: VisualizationResult): void {
    this.visualizationResults.set(ref, visualizationResult);
  }

  getVisualizationResult(ref: string | undefined): VisualizationResult | undefined {
    return ref ? this.visualizationResults.get(ref) : undefined;
  }
}

export function getQueryArtifactCache(config?: any): QueryArtifactCache | undefined {
  return config?.configurable?.queryArtifactCache;
}

/** Where this run registers late facts; like the query artifact cache, a request-scoped runtime carrier. */
export function resolvePendingLateFacts(config?: any): PendingLateFacts | undefined {
  return config?.configurable?.pendingLateFacts;
}

export function hasUsableDataReference(state: GraphState): boolean {
  return Boolean(
    state.queryArtifactRef ||
    state.historicalQueryRef ||
    (Array.isArray(state.mockData) && state.mockData.length > 0)
  );
}

export async function resolveCurrentQueryResult(
  state: GraphState,
  config?: any
): Promise<QueryExecutionFact | undefined> {
  if (!state.queryArtifactRef) {
    return undefined;
  }
  const queryResult = getQueryArtifactCache(config)?.getQueryResult(state.queryArtifactRef);
  if (!queryResult) {
    logger.warn(tApp("queryFixed.116"), {
      threadId: state.queryArtifactRef.threadId,
      requestSeq: state.queryArtifactRef.requestSeq,
      sourceKind: state.queryArtifactRef.sourceKind,
      sourceRef: state.queryArtifactRef.sourceRef,
    });
  }
  return queryResult;
}

function latestDatasetFromQueryRun(queryRun?: QueryRun | null): any | undefined {
  const datasets = Array.isArray(queryRun?.datasetsPayload)
    ? queryRun?.datasetsPayload
    : Array.isArray(queryRun?.dataPayload)
      ? queryRun?.dataPayload
      : [];
  return datasets[datasets.length - 1];
}

function extractRowsFromQueryRun(
  queryRun?: QueryRun | null
): Record<string, unknown>[] | undefined {
  const lastDataset = latestDatasetFromQueryRun(queryRun);
  return Array.isArray(lastDataset?.data)
    ? (lastDataset.data as Record<string, unknown>[])
    : undefined;
}

export function hasUsableQueryRun(queryRun?: QueryRun | null): boolean {
  const rows = extractRowsFromQueryRun(queryRun);
  return queryRun?.status === "completed" && Array.isArray(rows) && rows.length > 0;
}

export async function resolveAnalysisData(
  state: GraphState,
  config?: any
): Promise<
  | {
      data: Record<string, unknown>[];
      source: "current_query" | "historical";
      queryResult?: QueryExecutionFact;
      fieldDisplayPlan?: FieldDisplayPlan;
    }
  | undefined
> {
  const currentQueryResult = await resolveCurrentQueryResult(state, config);
  // Rows and the field display plan come from the same selected dataset.
  const currentDataset = selectedDatasetFromQueryResult(currentQueryResult);
  const currentRows = rowsFromDataset(currentDataset);
  const currentDatasets = currentQueryResult?.datasets;
  const currentFieldDisplayPlan = fieldDisplayPlanFromDataset(currentDataset);
  if (currentRows && currentRows.length > 0) {
    return {
      data: currentRows,
      source: "current_query",
      queryResult: currentQueryResult,
      fieldDisplayPlan: currentFieldDisplayPlan,
    };
  }
  if (Array.isArray(currentDatasets) && currentDatasets.length > 0) {
    return {
      data: currentRows || [],
      source: "current_query",
      queryResult: currentQueryResult,
      fieldDisplayPlan: currentFieldDisplayPlan,
    };
  }

  if (state.historicalQueryRef) {
    try {
      const queryRun = await getQueryRunBySource(state.historicalQueryRef);
      const historicalRows = extractRowsFromQueryRun(queryRun);
      if (historicalRows && historicalRows.length > 0) {
        return {
          data: historicalRows,
          source: "historical",
          fieldDisplayPlan: fieldDisplayPlanFromDataset(latestDatasetFromQueryRun(queryRun)),
        };
      }
    } catch (error) {
      logger.error(tApp("queryFixed.117"), {
        threadId: state.historicalQueryRef.threadId,
        requestSeq: state.historicalQueryRef.requestSeq,
        sourceKind: state.historicalQueryRef.sourceKind,
        sourceRef: state.historicalQueryRef.sourceRef,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return undefined;
}

export function resolveRuntimeAnalysisResult(
  state: GraphState,
  config?: any
): AnalysisResult | undefined {
  return getQueryArtifactCache(config)?.getAnalysisResult(state.analysisArtifactRef);
}

export function resolveRuntimeVisualizationResult(
  state: GraphState,
  config?: any
): VisualizationResult | undefined {
  return getQueryArtifactCache(config)?.getVisualizationResult(state.visualizationArtifactRef);
}
