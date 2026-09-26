/**
 * 当前请求查询结果里，分析与可视化使用的那个数据集。两版迁出前的规则不同：
 * open-source 取最后一个有行的数据集（都没有行时取最后一个），企业取最后一个。
 * 应用装配其一；行与字段展示计划都取自同一个选中数据集。历史 query run 不经过这里。
 */
type QueryDataset = { data?: unknown };

/** datasets 至少有一个。 */
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
