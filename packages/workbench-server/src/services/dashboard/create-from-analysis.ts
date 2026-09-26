import type {
  DashboardChartEntry,
  DashboardGroup,
  DashboardMetricEntry,
} from "@ontomato/contracts/dashboard";
import { randomUUID } from "node:crypto";

import { config } from "../../config/application";
import { backendPost } from "../../utils/backend-client";
import { getCheckpointer } from "../../infrastructure/connection";
import { t, tApp } from "../../i18n";
import { HttpError } from "../../utils/errors";
import { extractDatasetsFromQueryRun } from "../data-query/query-run-artifacts";
import { listQueryRuns } from "../data-query/query-run-store";
import { normalizeAbcProgram, normalizeAbcProgramParametersForUi } from "./abc-program";
import { ABC_PROGRAM_DASHBOARD_TIMEOUT_MS, wrapDashboardBackendError } from "./dsl-execution";
import { createDashboardPlanningChain } from "./planning/index";
import { createDashboard } from "./store";
import type { DashboardDatasetInput } from "./types";
export async function resolveDashboardDatasets(
  threadId: string,
  requestSeq: number
): Promise<{ datasets: DashboardDatasetInput[] }> {
  const queryRuns = await listQueryRuns(threadId, requestSeq);
  let datasetIndex = 0;
  const datasets: DashboardDatasetInput[] = [];

  for (const run of queryRuns) {
    for (const artifact of extractDatasetsFromQueryRun(run)) {
      const dsl =
        artifact.dsl && typeof artifact.dsl === "object" && !Array.isArray(artifact.dsl)
          ? (artifact.dsl as Record<string, unknown>)
          : null;
      if ((!dsl && !artifact.abcProgram) || artifact.rows.length === 0) continue;

      datasets.push({
        datasetKey: artifact.datasetKey || `${run.sourceRef}-dataset-${datasetIndex}`,
        subQuestion: artifact.title,
        data: artifact.rows,
        dsl: dsl || {},
        abcProgram: artifact.abcProgram,
        source: { threadId, requestSeq, datasetIndex },
      });
      datasetIndex += 1;
    }
  }

  return { datasets };
}
export async function createDashboardFromAnalysis(
  ownerId: string,
  domainId: string,
  body: any,
  tk: string,
  locale: string
) {
  const threadId = String(body?.threadId || "").trim();
  const requestSeq = Number(body?.requestSeq);
  if (!threadId) throw new HttpError(400, "threadId is required");
  if (!Number.isInteger(requestSeq) || requestSeq < 0) {
    throw new HttpError(400, "requestSeq is required");
  }

  const checkpointer = getCheckpointer();
  if (!checkpointer) throw new HttpError(500, t("api.checkpointerNotInitialized"));
  await checkpointer.verifyThreadAccess(threadId, ownerId, domainId);
  const { datasets } = await resolveDashboardDatasets(threadId, requestSeq);
  if (!datasets.length) throw new HttpError(400, t("api.noAvailableDashboardData"));
  const needParameter = body?.needParameter === true;

  const groupsFromReq = Array.isArray(body?.groups) ? body.groups : [];
  let groups: DashboardGroup[];
  let plannedName = "";
  if (groupsFromReq.length) {
    groups = groupsFromReq;
  } else if (datasets.some((dataset) => dataset.abcProgram)) {
    const charts: DashboardChartEntry[] = [];

    for (const dataset of datasets) {
      if (!dataset.abcProgram) continue;
      const backendUrl = config.dataQuery.baseUrl;
      if (!backendUrl) {
        throw new Error(
          t("api.executionFailed", {
            status: 500,
            detail: t("api.backendNotConfigured"),
          })
        );
      }
      const endpoint = "/dashboard/createFromABCProgram";
      let payload: any;
      try {
        const response = await backendPost(
          endpoint,
          `${backendUrl.replace(/\/$/, "")}${endpoint}`,
          {
            question: dataset.subQuestion || dataset.abcProgram.title,
            code: dataset.abcProgram.code,
            outKeyRefs: dataset.abcProgram.outKeyRefs,
            needParameter,
          },
          { token: tk, timeoutMs: ABC_PROGRAM_DASHBOARD_TIMEOUT_MS, locale }
        );
        payload = (response.headers.get("content-type") || "").includes("application/json")
          ? JSON.parse(response.text)
          : response.text;
      } catch (error) {
        throw wrapDashboardBackendError(error, "api.executionFailed");
      }

      const program = normalizeAbcProgram(payload?.data) || dataset.abcProgram;
      const title = program.title || dataset.subQuestion || tApp("queryFixed.149");
      const parameters = normalizeAbcProgramParametersForUi(program.parameters);
      charts.push({
        id: randomUUID(),
        name: title,
        chartType: "bar",
        fields: {},
        dataPlan: { mode: "raw" },
        dsl: {},
        abcProgram: { ...program, parameters },
        conditions: parameters,
        source: {
          ...dataset.source,
          datasetKey: dataset.datasetKey,
          subQuestion: dataset.subQuestion,
        },
        layout: { colSpan: 12, rowSpan: 1 },
      });
      if (!plannedName && program.title) plannedName = program.title;
    }

    if (!charts.length) throw new HttpError(400, t("api.noAvailableDashboardData"));
    groups = [
      {
        id: randomUUID(),
        title: plannedName || "ABC Program",
        charts,
        metrics: [],
      },
    ];
  } else {
    const chain = createDashboardPlanningChain();
    const planned = await chain.invoke({ mode: "dashboard", datasets });
    plannedName = String((planned as any)?.name || "").trim();
    groups = (planned as any)?.groups?.map((group: any) => {
      const charts = (Array.isArray(group?.charts) ? group.charts : [])
        .filter((chart: any) => {
          const source = datasets.find((item) => item.datasetKey === chart.datasetKey);
          if (!source) return false;
          const rows = Array.isArray(source.data) ? source.data : [];
          if (rows.length <= 1) return false;
          if (rows.length > 0 && Object.keys(rows[0]).length <= 1) return false;
          return true;
        })
        .map((chart: any) => {
          const source = datasets.find((item) => item.datasetKey === chart.datasetKey);
          return {
            id: randomUUID(),
            name: String(chart?.name || ""),
            chartType: String(chart?.type || "bar"),
            fields: chart?.fields || {},
            dataPlan: chart?.dataPlan,
            dsl: source?.dsl || {},
            source: {
              ...source?.source,
              datasetKey: source?.datasetKey,
              subQuestion: source?.subQuestion,
            },
            layout: { colSpan: 12, rowSpan: 1 },
          } satisfies DashboardChartEntry;
        });

      const metrics = (Array.isArray(group?.metrics) ? group.metrics : []).map((metric: any) => {
        const source = datasets.find((item) => item.datasetKey === metric.datasetKey);
        return {
          id: randomUUID(),
          name: String(metric?.name || ""),
          unit: String(metric?.unit || ""),
          agg: metric?.agg,
          valueField: metric?.valueField,
          dataPlan: metric?.dataPlan,
          dsl: source?.dsl || {},
          source: {
            ...source?.source,
            datasetKey: source?.datasetKey,
            subQuestion: source?.subQuestion,
          },
          layout: { colSpan: 6, rowSpan: 1 },
        } satisfies DashboardMetricEntry;
      });

      return {
        id: randomUUID(),
        title: String(group?.title || tApp("queryFixed.150")),
        charts,
        metrics,
      };
    });
  }

  const detail = await createDashboard({
    ownerId,
    domainId,
    id: String(body?.id || randomUUID()),
    name:
      String(body?.name || "").trim() ||
      plannedName ||
      tApp("queryFixed.148", { v0: (new Date().toISOString().slice(0, 10)) }),
    source: { threadId, requestSeq },
    groups,
  });
  return { id: detail.id, name: detail.name };
}
