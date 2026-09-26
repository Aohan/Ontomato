import { randomUUID } from "node:crypto";

import { getCheckpointer } from "../../infrastructure/connection";
import { t } from "../../i18n";
import { HttpError } from "../../utils/errors";
import { normalizeAbcProgram } from "./abc-program";
import { ensureDashboard, findGroup, requireDashboardId, requireGroupId } from "./access";
import { resolveDashboardDatasets } from "./create-from-analysis";
import { createDashboardPlanningChain } from "./planning/index";
import { createDashboard, deleteDashboard, getDashboard, saveDashboard } from "./store";
export async function createEmptyDashboard(ownerId: string, domainId: string, body: any) {
  const name = String(body?.name || "").trim();
  if (!name) throw new HttpError(400, "name is required");
  const detail = await createDashboard({ ownerId, domainId, name, groups: [] });
  return { id: detail.id, name: detail.name };
}
export async function createDashboardDimension(ownerId: string, domainId: string, body: any) {
  const id = requireDashboardId(body?.id);
  const detail = ensureDashboard(ownerId, await getDashboard(ownerId, domainId, id));
  const groupTitle = String(body?.dimensionName || "").trim();
  if (!groupTitle) throw new HttpError(400, "dimensionName is required");
  detail.groups.push({ id: randomUUID(), title: groupTitle, charts: [], metrics: [] });
  await saveDashboard(ownerId, domainId, detail);
}
export async function addDashboardChart(ownerId: string, domainId: string, body: any) {
  const dashboardId = String(body?.dashboardId || "").trim();
  const groupId = requireGroupId(body?.groupId);
  const threadId = String(body?.threadId || "").trim();
  const requestSeq = Number(body?.requestSeq);
  const datasetIndex = Number(body?.datasetIndex ?? 0);
  if (!dashboardId) throw new HttpError(400, "dashboardId is required");
  if (!threadId) throw new HttpError(400, "threadId is required");
  if (!Number.isInteger(requestSeq) || requestSeq < 0)
    throw new HttpError(400, "requestSeq is required");

  const checkpointer = getCheckpointer();
  if (!checkpointer) throw new HttpError(500, t("api.checkpointerNotInitialized"));
  await checkpointer.verifyThreadAccess(threadId, ownerId, domainId);
  const { datasets } = await resolveDashboardDatasets(threadId, requestSeq);
  if (!datasets.length) throw new HttpError(400, t("api.noAvailableDashboardData"));
  const targetDataset = datasets[datasetIndex];
  if (!targetDataset) throw new HttpError(400, t("api.noAvailableDashboardData"));

  const detail = ensureDashboard(ownerId, await getDashboard(ownerId, domainId, dashboardId));
  const group = findGroup(detail, groupId);

  const chain = createDashboardPlanningChain();
  const planned = await chain.invoke({
    mode: "append",
    datasets: [targetDataset],
    existingChartTypes: detail.groups.flatMap((item) =>
      item.charts.map((chart) => String(chart.chartType || "")).filter(Boolean)
    ),
  });

  const validCharts = (
    Array.isArray((planned as any)?.charts) ? (planned as any).charts : []
  ).filter(() => {
    const rows = Array.isArray(targetDataset.data) ? targetDataset.data : [];
    if (rows.length <= 1) return false;
    if (rows.length > 0 && Object.keys(rows[0]).length <= 1) return false;
    return true;
  });

  const metrics = Array.isArray((planned as any)?.metrics) ? (planned as any).metrics : [];

  group.charts.push(
    ...validCharts.map((chart: any) => ({
      id: randomUUID(),
      name: String(chart?.name || targetDataset.subQuestion),
      chartType: String(chart?.type || "bar"),
      fields: chart?.fields || {},
      dataPlan: chart?.dataPlan,
      dsl: targetDataset.dsl,
      abcProgram: targetDataset.abcProgram,
      source: {
        ...targetDataset.source,
        datasetKey: targetDataset.datasetKey,
        subQuestion: targetDataset.subQuestion,
      },
      layout: { colSpan: 12, rowSpan: 1 },
    }))
  );

  group.metrics.push(
    ...metrics.map((metric: any) => ({
      id: randomUUID(),
      name: String(metric?.name || targetDataset.subQuestion),
      unit: String(metric?.unit || ""),
      agg: metric?.agg,
      valueField: metric?.valueField,
      dataPlan: metric?.dataPlan,
      dsl: targetDataset.dsl,
      abcProgram: targetDataset.abcProgram,
      source: {
        ...targetDataset.source,
        datasetKey: targetDataset.datasetKey,
        subQuestion: targetDataset.subQuestion,
      },
      layout: { colSpan: 6, rowSpan: 1 },
    }))
  );

  await saveDashboard(ownerId, domainId, detail);
}
export async function renameDashboard(ownerId: string, domainId: string, body: any) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id))
  );
  const name = String(body?.name || "").trim();
  if (!name) throw new HttpError(400, "name is required");
  detail.name = name;
  await saveDashboard(ownerId, domainId, detail);
}
export async function deleteDashboardById(ownerId: string, domainId: string, body: any) {
  await deleteDashboard(ownerId, domainId, requireDashboardId(body?.id));
}
export async function renameDashboardDimension(ownerId: string, domainId: string, body: any) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id))
  );
  const group = findGroup(detail, requireGroupId(body?.groupId));
  group.title = String(body?.dimensionName || "").trim();
  await saveDashboard(ownerId, domainId, detail);
}
export async function deleteDashboardDimension(ownerId: string, domainId: string, body: any) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id))
  );
  const groupId = requireGroupId(body?.groupId);
  detail.groups = detail.groups.filter((group) => group.id !== groupId);
  await saveDashboard(ownerId, domainId, detail);
}
export async function renameDashboardChart(ownerId: string, domainId: string, body: any) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id))
  );
  const chartId = String(body?.chartId || "").trim();
  const name = String(body?.resultSetName || "").trim();
  for (const group of detail.groups) {
    const chart = group.charts.find((item) => item.id === chartId);
    if (chart) chart.name = name;
  }
  await saveDashboard(ownerId, domainId, detail);
}
export async function deleteDashboardChart(ownerId: string, domainId: string, body: any) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id))
  );
  const chartId = String(body?.chartId || "").trim();
  for (const group of detail.groups) {
    group.charts = group.charts.filter((item) => item.id !== chartId);
  }
  await saveDashboard(ownerId, domainId, detail);
}
export async function changeDashboardChartType(ownerId: string, domainId: string, body: any) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id))
  );
  const chartId = String(body?.chartId || "").trim();
  const chartType = String(body?.chartType || "").trim();
  for (const group of detail.groups) {
    const chart = group.charts.find((item) => item.id === chartId);
    if (chart) {
      chart.chartType = chartType;
      chart.fields = undefined;
    }
  }
  await saveDashboard(ownerId, domainId, detail);
}
export async function updateDashboardChartConditions(ownerId: string, domainId: string, body: any) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id))
  );
  const chartId = String(body?.chartId || "").trim();
  const conditions = Array.isArray(body?.conditions) ? body.conditions : [];
  for (const group of detail.groups) {
    const chart = group.charts.find((item) => item.id === chartId);
    if (chart) chart.conditions = conditions;
  }
  await saveDashboard(ownerId, domainId, detail);
}
export async function replaceDashboardLayout(ownerId: string, domainId: string, body: any) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id))
  );
  const groups = Array.isArray(body?.groups) ? body.groups : [];
  detail.groups = groups.map((group: any) => ({
    id: String(group?.id || randomUUID()),
    title: String(group?.title || "").trim(),
    charts: Array.isArray(group?.charts)
      ? group.charts.map((chart: any) => ({
          id: String(chart?.id || randomUUID()),
          name: String(chart?.name || "").trim(),
          chartType: String(chart?.type || chart?.chartType || "bar"),
          fields: chart?.fields || {},
          dataPlan: chart?.dataPlan,
          conditions: Array.isArray(chart?.conditions) ? chart.conditions : [],
          abcProgram:
            normalizeAbcProgram(chart?.abcProgram) ||
            detail.groups.flatMap((item) => item.charts).find((item) => item.id === chart?.id)
              ?.abcProgram,
          dsl:
            chart?.dsl ||
            detail.groups.flatMap((item) => item.charts).find((item) => item.id === chart?.id)
              ?.dsl ||
            {},
          source:
            detail.groups.flatMap((item) => item.charts).find((item) => item.id === chart?.id)
              ?.source || {},
          layout: chart?.layout,
        }))
      : [],
    metrics: Array.isArray(group?.metrics)
      ? group.metrics.map((metric: any) => ({
          id: String(metric?.id || randomUUID()),
          name: String(metric?.name || "").trim(),
          unit: String(metric?.unit || "").trim(),
          agg: metric?.agg,
          valueField: metric?.valueField,
          dataPlan: metric?.dataPlan,
          abcProgram:
            normalizeAbcProgram(metric?.abcProgram) ||
            detail.groups.flatMap((item) => item.metrics).find((item) => item.id === metric?.id)
              ?.abcProgram,
          dsl:
            detail.groups.flatMap((item) => item.metrics).find((item) => item.id === metric?.id)
              ?.dsl || {},
          source:
            detail.groups.flatMap((item) => item.metrics).find((item) => item.id === metric?.id)
              ?.source || {},
          layout: metric?.layout,
        }))
      : [],
  }));
  await saveDashboard(ownerId, domainId, detail);
}
export async function renameDashboardMetric(ownerId: string, domainId: string, body: any) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id))
  );
  const metricId = String(body?.metricId || "").trim();
  const metricName = String(body?.metricName || "").trim();
  for (const group of detail.groups) {
    const metric = group.metrics.find((item) => item.id === metricId);
    if (metric) metric.name = metricName;
  }
  await saveDashboard(ownerId, domainId, detail);
}
export async function deleteDashboardMetric(ownerId: string, domainId: string, body: any) {
  const detail = ensureDashboard(
    ownerId,
    await getDashboard(ownerId, domainId, requireDashboardId(body?.id))
  );
  const metricId = String(body?.metricId || "").trim();
  for (const group of detail.groups) {
    group.metrics = group.metrics.filter((item) => item.id !== metricId);
  }
  await saveDashboard(ownerId, domainId, detail);
}
