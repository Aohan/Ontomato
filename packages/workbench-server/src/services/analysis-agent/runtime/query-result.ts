import type { QueryFactDatasetPreview as QueryResultDatasetPreview } from "@ontomato/contracts/query-execution";
import type { Dataset, FieldDisplayPlan } from "../../data-query/adapter";
import { toQueryExecutionFact } from "../../data-query/query-fact";
import type { QueryRun } from "../../data-query/query-run-store";
import type { AnalysisQueryFact } from "./evidence-types";
import { tApp } from "../../../i18n";


export type QueryResultRow = Record<string, unknown>;
export type QueryResultData = QueryResultRow[] | QueryResultRow[][];
export type QueryResultDsl = unknown | unknown[];

export interface QueryResultDatasetEntry extends Omit<QueryResultDatasetPreview, "markdownTable"> {
  index: number;
  data: QueryResultRow[];
  dsl?: unknown;
  markdownTable?: string;
  fieldDisplayPlan?: FieldDisplayPlan;
}

export function normalizeQueryResultDatasets(data?: QueryResultData): QueryResultRow[][] {
  if (!Array.isArray(data) || data.length === 0) return [];
  if (data.every((item) => Array.isArray(item))) {
    return data.map((dataset) => (Array.isArray(dataset) ? (dataset as QueryResultRow[]) : []));
  }
  return [data as QueryResultRow[]];
}

export function flattenQueryResultData(data?: QueryResultData): QueryResultRow[] {
  return normalizeQueryResultDatasets(data).flatMap((dataset) => dataset);
}

export function getQueryResultDataCount(data?: QueryResultData): number {
  return normalizeQueryResultDatasets(data).reduce((sum, dataset) => sum + dataset.length, 0);
}

export function buildQueryResultDataFromDatasets(
  datasets: Array<{ data?: QueryResultRow[] }>
): QueryResultData | undefined {
  if (!Array.isArray(datasets) || datasets.length === 0) return undefined;
  const rowsByDataset = datasets.map((dataset) =>
    Array.isArray(dataset?.data) ? (dataset.data as QueryResultRow[]) : []
  );
  return rowsByDataset.length > 1 ? rowsByDataset : rowsByDataset[0];
}

export function buildQueryResultDslFromDatasets(
  datasets: Array<{ dsl?: unknown }>
): QueryResultDsl | undefined {
  if (!Array.isArray(datasets) || datasets.length === 0) return undefined;
  const dsls = datasets.map((dataset) => dataset?.dsl);
  return dsls.length > 1 ? dsls : dsls[0];
}

export function expandQueryResultDatasetEntries(options: {
  data?: QueryResultData;
  dsl?: QueryResultDsl;
  datasets?: Dataset[];
  datasetPreviews?: QueryResultDatasetPreview[];
  baseTitle?: string;
}): QueryResultDatasetEntry[] {
  const { data, dsl, datasets, datasetPreviews, baseTitle } = options;

  if (Array.isArray(datasets) && datasets.length > 0) {
    return datasets
      .map((dataset, index) => {
        const rows = Array.isArray(dataset?.data) ? dataset.data : [];
        if (rows.length === 0) return null;
        return {
          index,
          title:
            datasetPreviews?.[index]?.title ||
            dataset?.subQuestion ||
            dataset?.description ||
            dataset?.name ||
            (datasets.length > 1 ? `${baseTitle || tApp("analysis.runtime.query-result.403")} ${index + 1}` : baseTitle || tApp("analysis.runtime.query-result.403")),
          data: rows,
          dsl: dataset?.dsl,
          markdownTable: datasetPreviews?.[index]?.markdownTable,
          dataCount: rows.length,
          fieldDisplayPlan: dataset.fieldDisplayPlan,
        } satisfies QueryResultDatasetEntry;
      })
      .filter(Boolean) as QueryResultDatasetEntry[];
  }

  const normalizedDatasets = normalizeQueryResultDatasets(data);
  const dslList = Array.isArray(dsl) ? dsl : normalizedDatasets.map(() => dsl);

  return normalizedDatasets
    .map((rows, index) => {
      if (rows.length === 0) return null;
      return {
        index,
        title:
          datasetPreviews?.[index]?.title ||
          (normalizedDatasets.length > 1
            ? `${baseTitle || tApp("analysis.runtime.query-result.403")} ${index + 1}`
            : baseTitle || tApp("analysis.runtime.query-result.403")),
        data: rows,
        dsl: dslList[index],
        markdownTable: datasetPreviews?.[index]?.markdownTable,
        dataCount: rows.length,
      } satisfies QueryResultDatasetEntry;
    })
    .filter(Boolean) as QueryResultDatasetEntry[];
}

/**
 * Reads saved query run facts back into the shape the analysis domain consumes: it only narrows data and DSL on top of the generic read projection,
 * never re-enumerating execution fields.
 */
export function toAnalysisQueryFact(run?: QueryRun | null): AnalysisQueryFact {
  const fact = toQueryExecutionFact(run);
  return {
    ...fact,
    data: fact.data as QueryResultData | undefined,
    dsl: fact.dsl as QueryResultDsl | undefined,
    datasets: fact.datasets as Dataset[] | undefined,
    datasetPreviews: fact.datasetPreviews as QueryResultDatasetPreview[] | undefined,
  };
}
