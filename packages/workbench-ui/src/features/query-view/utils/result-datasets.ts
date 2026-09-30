import type { QueryExecutionFacts } from "../../../types/chat";
import type { ResultDataset, ResultTechnicalFact } from "../components/MessageContent/types";

/**
 * Query execution facts → result datasets and technical details for display.
 *
 * The standard query and analysis entries, the shared execution view, and the standalone body card
 * all take the same derivation from here, instead of each judging "whether there is a result".
 */

type Translate = (key: string, named?: Record<string, unknown>) => string;

function isRecordRow(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Result datasets preserve order: name, row count, rows, and DSL come from the dataset itself, and
 * the post-calculation program and field lineage are given by dataset index — both query branches
 * push datasets, abcCodes, and abcOutKeyRefs within the same loop, so the index is the
 * correspondence; the position in the sub-question array is not guessed from. Zero-row datasets are
 * also kept, so their details are not lost when the body has no table.
 */
export function buildResultDatasets(
  facts: QueryExecutionFacts | undefined,
  t: Translate
): ResultDataset[] {
  const datasets = facts?.datasets;
  if (Array.isArray(datasets)) {
    const codes = facts?.abcCodes;
    const outKeyRefs = facts?.abcOutKeyRefs;
    return datasets.map((dataset, index) => ({
      id: `dataset-${index}`,
      title:
        dataset?.subQuestion ||
        dataset?.name ||
        dataset?.description ||
        `${t("hotData.dataTable")}_${index + 1}`,
      rows: Array.isArray(dataset?.data) ? dataset.data : [],
      dsl: dataset?.dsl,
      subQuestion: dataset?.subQuestion,
      code: codes?.[index] || undefined,
      outKeyRefs: outKeyRefs?.[index],
    }));
  }
  // Persisted legacy rows may have only flattened data rows without a structured dataset: same
  // semantics as the flattened branch of the server's extractDatasetsFromQueryRun, keeping this
  // downloadable data.
  const data = facts?.data;
  const rows = Array.isArray(data) ? data.filter(isRecordRow) : [];
  if (rows.length === 0) return [];
  const dsl = facts?.dsl;
  return [
    {
      id: "dataset-0",
      title: `${t("hotData.dataTable")}_1`,
      rows,
      dsl: Array.isArray(dsl) ? undefined : dsl,
      subQuestion: undefined,
    },
  ];
}

/** Whether there is a result dataset to present (the same criterion as whether buildResultDatasets is empty). */
export function hasResultDatasets(facts: QueryExecutionFacts | undefined): boolean {
  if (!facts) return false;
  if (Array.isArray(facts.datasets)) return facts.datasets.length > 0;
  return Array.isArray(facts.data) && facts.data.some(isRecordRow);
}

/**
 * Whether there is existing technical output that cannot attach to a dataset. The same criterion as
 * whether buildTechnicalFacts is empty, ensuring the shared execution view and the standalone body
 * card reach the same conclusion about "whether the result body renders".
 */
export function hasTechnicalFacts(facts: QueryExecutionFacts | undefined, t: Translate): boolean {
  return buildTechnicalFacts(facts, t).length > 0;
}

/**
 * Organizes two-level decomposition technical facts without datasets into compact detail entries.
 * The arrays of code, lineage, and two-level DSL are taken in saved order; when the dataset identity
 * is missing, a neutral index is used without guessing the name from the sub-question index.
 */
export function buildTechnicalFacts(
  facts: QueryExecutionFacts | undefined,
  t: Translate
): ResultTechnicalFact[] {
  const dsls = facts?.abcDsls;
  const codes = facts?.abcCodes;
  const outKeyRefs = facts?.abcOutKeyRefs;
  const total = Math.max(dsls?.length || 0, codes?.length || 0, outKeyRefs?.length || 0);
  const entries: ResultTechnicalFact[] = [];

  for (let index = 0; index < total; index += 1) {
    const dsl = dsls?.[index] || undefined;
    const code = codes?.[index] || undefined;
    const refs = outKeyRefs?.[index];
    if (!dsl && !code && !(refs?.length || 0)) continue;
    entries.push({
      key: `technical-${index}`,
      title: `${t("common.detail")} ${index + 1}`,
      dsl,
      code,
      outKeyRefs: refs,
    });
  }

  return entries;
}
