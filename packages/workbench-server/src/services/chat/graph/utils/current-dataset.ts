/**
 * The dataset from the current request's query results that analysis and visualization use. The pre-migration rules differed per edition:
 * open-source takes the last dataset with rows (or the last one when none has rows), the enterprise edition takes the last one.
 * The app assembles one of them; rows and the field display plan both come from the same selected dataset. Historical query runs never pass through here.
 */
type QueryDataset = { data?: unknown };

/** datasets contains at least one entry. */
export type CurrentDatasetRule = <T extends QueryDataset>(datasets: T[]) => T;

export const lastDataset: CurrentDatasetRule = (datasets) => datasets[datasets.length - 1];

export const lastDatasetWithRows: CurrentDatasetRule = (datasets) =>
  [...datasets].reverse().find((dataset) => Array.isArray(dataset?.data) && dataset.data.length > 0) ??
  datasets[datasets.length - 1];

let installed: CurrentDatasetRule | undefined;

export function installCurrentDatasetRule(rule: CurrentDatasetRule): void {
  installed = rule;
}

export function currentDatasetRule(): CurrentDatasetRule {
  if (!installed) throw new Error("Current dataset rule is not installed");
  return installed;
}
