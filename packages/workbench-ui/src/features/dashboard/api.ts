import type {
  DashboardListItem,
  DashboardGroup,
  DashboardDetail,
} from "@ontomato/contracts/dashboard";
import { nodeApiGet, nodeApiPost } from "../../utils/api";
import { workbenchContent } from "../../content";

export async function fetchDashboardList(): Promise<DashboardListItem[]> {
  const json = await nodeApiPost("/dashboards/queryList", {});
  return json?.data || [];
}

export async function fetchDashboardGroups(args: {
  id: string;
}): Promise<Pick<DashboardGroup, "id" | "title">[]> {
  const json = await nodeApiPost("/dashboards/groups", args || {});
  return json?.data || [];
}

export async function createDashboard(name: string) {
  const json = await nodeApiPost("/dashboards/create", { name: String(name || "").trim() });
  if (!json?.data?.id) throw new Error(json?.error || workbenchContent().text.createDashboardFailed);
  return { id: String(json.data.id), name: String(json.data.name || "") };
}

export async function createDimension(id: string, dimensionName: string) {
  const json = await nodeApiPost("/dashboards/createDimension", { id, dimensionName });
  return json?.success === true;
}

export async function addChartToDashboard(args: {
  dashboardId: string;
  groupId: string;
  threadId: string;
  requestSeq: number;
  datasetIndex: number;
}) {
  const json = await nodeApiPost("/dashboards/add-chart", args);
  return json?.success === true;
}

export async function createDashboardFromAnalysis(args: {
  threadId: string;
  requestSeq: number;
  name?: string;
  needParameter?: boolean;
}) {
  const json = await nodeApiPost("/dashboards/create-from-analysis", args);
  if (!json?.data?.id) throw new Error(json?.error || workbenchContent().text.createDashboardFailed);
  return { id: String(json.data.id), name: String(json.data.name || "") };
}

export async function fetchDashboardLocalDetail(
  id: string,
  opts?: { signal?: AbortSignal }
): Promise<DashboardDetail | null> {
  const json = await nodeApiGet(`/dashboards/${encodeURIComponent(String(id || ""))}`, {
    signal: opts?.signal,
  });
  return json?.data ?? null;
}

export async function queryDashboardById(args: any) {
  return nodeApiPost("/dashboards/query-by-id", args || {});
}

export async function renameDashboard(id: string, name: string) {
  const json = await nodeApiPost("/dashboards/modify", { id, name });
  return json?.success === true;
}

export async function deleteDashboard(id: string) {
  const json = await nodeApiPost("/dashboards/delete", { id });
  return json?.success === true;
}

export async function modifyDimensionName(id: string, groupId: string, dimensionName: string) {
  const json = await nodeApiPost("/dashboards/modifyDimensionName", { id, groupId, dimensionName });
  return json?.success === true;
}

export async function deleteDimension(id: string, groupId: string) {
  const json = await nodeApiPost("/dashboards/deleteDimension", { id, groupId });
  return json?.success === true;
}

export async function modifyResultSetName(
  id: string,
  chartId: string,
  resultSetName: string,
  _dimensionId?: string,
  _resultSetId?: string
) {
  const json = await nodeApiPost("/dashboards/modifyResultSetName", { id, chartId, resultSetName });
  return json?.success === true;
}

export async function deleteResultSet(id: string, chartId: string) {
  const json = await nodeApiPost("/dashboards/deleteResultSet", { id, chartId });
  return json?.success === true;
}

export async function modifyResultSetChartType(id: string, chartId: string, chartType: string) {
  const json = await nodeApiPost("/dashboards/modifyResultSetChartType", {
    id,
    chartId,
    chartType,
  });
  return json?.success === true;
}

export async function modifyResultSetConditions(
  id: string,
  chartId: string,
  conditions: unknown[]
) {
  const json = await nodeApiPost("/dashboards/modifyResultSetConditions", {
    id,
    chartId,
    conditions,
  });
  return json?.success === true;
}

export async function modifyDashboardLayout(id: string, groups: unknown[]) {
  const json = await nodeApiPost("/dashboards/modifyLayout", { id, groups });
  return json?.success === true;
}

export async function modifyMetricName(id: string, metricId: string, metricName: string) {
  const json = await nodeApiPost("/dashboards/modifyMetricName", { id, metricId, metricName });
  return json?.success === true;
}

export async function deleteMetric(id: string, metricId: string) {
  const json = await nodeApiPost("/dashboards/deleteMetric", { id, metricId });
  return json?.success === true;
}

export async function analyzeChart(args: any) {
  return nodeApiPost("/dashboards/ai/analyze", args || {});
}

export async function getAnswerByDslConditionParam(args: {
  dsl?: Record<string, unknown>;
  abcProgram?: Record<string, unknown>;
  conditions?: unknown[];
  chartType?: string;
  chartTitle?: string;
  fields?: Record<string, unknown>;
  dataPlan?: unknown;
  timeoutMs?: number;
}) {
  return nodeApiPost("/dashboards/getAnswerByDslConditionParam", args || {});
}

export async function getConditionsFromDsls(dsls: Array<Record<string, unknown>>) {
  return nodeApiPost("/dashboards/getConditionsFromDsls", {
    dsls: Array.isArray(dsls) ? dsls : [],
  });
}

export async function getConditionsFromDsl(dsl: Record<string, unknown>) {
  const payload = await getConditionsFromDsls([dsl || {}]);
  const raw = payload?.data?.conditions;
  if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
    return raw[0];
  }
  return Array.isArray(raw) ? raw : [];
}
