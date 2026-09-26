import type { AbcProgramDashboard, AbcProgramOutKeyRef } from "@ontomato/contracts/dashboard";
import type { QueryRun } from "./query-run-store";
import { t } from "../../i18n";

export interface QueryRunDatasetArtifact {
  datasetKey: string;
  title: string;
  rows: Array<Record<string, unknown>>;
  dsl?: unknown;
  abcProgram?: AbcProgramDashboard;
  subQuestion?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asAbcProgram(value: unknown): AbcProgramDashboard | undefined {
  if (!isRecord(value)) return undefined;
  const title = typeof value.title === "string" ? value.title : "";
  const code = typeof value.code === "string" ? value.code : "";
  const outKeyRefs = Array.isArray(value.outKeyRefs) ? value.outKeyRefs : [];
  const parameters = Array.isArray(value.parameters) ? value.parameters : null;
  if (!title || !code || outKeyRefs.length === 0 || !parameters) return undefined;
  return {
    title,
    code,
    outKeyRefs: outKeyRefs as AbcProgramOutKeyRef[],
    parameters: parameters as NonNullable<AbcProgramDashboard["parameters"]>,
  };
}

function getDatasetArray(run: QueryRun): unknown[] {
  const candidates = [run.datasetsPayload, run.dataPayload];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function getAbcProgramForDataset(
  run: QueryRun,
  index: number,
  title: string
): AbcProgramDashboard | undefined {
  const codes = Array.isArray(run.abcCodes) ? run.abcCodes : [];
  const outKeyRefsList = Array.isArray(run.abcOutKeyRefs) ? run.abcOutKeyRefs : [];
  const code = typeof codes[index] === "string" ? codes[index] : "";
  const outKeyRefs = Array.isArray(outKeyRefsList[index])
    ? (outKeyRefsList[index] as AbcProgramOutKeyRef[])
    : [];
  if (!code || outKeyRefs.length === 0) return undefined;
  return {
    title,
    code,
    outKeyRefs,
  };
}

export function extractDatasetsFromQueryRun(run: QueryRun): QueryRunDatasetArtifact[] {
  const datasets = getDatasetArray(run);
  if (datasets.length === 0) return [];

  const looksLikeRows =
    datasets.every(isRecord) && !datasets.some((item) => Array.isArray(item.data));
  if (looksLikeRows) {
    return [
      {
        datasetKey: run.sourceRef || run.id,
        title: run.question || t("response.dataTable", { n: 1 }),
        rows: asRows(datasets),
        dsl: run.dslPayload,
        abcProgram: getAbcProgramForDataset(
          run,
          0,
          run.question || t("response.dataTable", { n: 1 })
        ),
        subQuestion: run.question,
      },
    ];
  }

  return datasets
    .map((dataset: any, index: number) => {
      const rows = asRows(dataset?.data);
      if (rows.length === 0) return null;
      const subQuestion =
        dataset?.subQuestion || dataset?.name || dataset?.description || run.question;
      return {
        datasetKey: `${run.sourceRef || run.id}-dataset-${index}`,
        title: subQuestion || t("response.dataTable", { n: index + 1 }),
        rows,
        dsl: dataset?.dsl || run.dslPayload,
        abcProgram:
          asAbcProgram(dataset?.abcProgram) ||
          getAbcProgramForDataset(
            run,
            index,
            subQuestion || t("response.dataTable", { n: index + 1 })
          ),
        subQuestion,
      } satisfies QueryRunDatasetArtifact;
    })
    .filter(Boolean) as QueryRunDatasetArtifact[];
}

export function extractDslTextFromQueryRun(run: QueryRun): string {
  if (run.dslText) return run.dslText;
  if (run.dslPayload !== undefined && run.dslPayload !== null) {
    return JSON.stringify(run.dslPayload, null, 2);
  }

  const firstDataset = extractDatasetsFromQueryRun(run).find((dataset) => dataset.dsl);
  return firstDataset?.dsl ? JSON.stringify(firstDataset.dsl, null, 2) : "";
}
