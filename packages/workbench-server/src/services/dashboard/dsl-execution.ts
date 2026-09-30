import { config } from "../../config/application";
import { t, tApp } from "../../i18n";
import {
  applyFieldDisplayNames,
  applyFieldDisplayPlan,
  createFieldDisplayPlan,
} from "../data-query/adapter";
import { batchAppendChartFieldMapper } from "./planning/core/chart-recommender";
import { buildDatasetProfile } from "./planning/core/utils";
import { HttpError } from "../../utils/errors";
import { backendPost, BackendResponseError } from "../../utils/backend-client";
import { buildAbcProgramQueryPayload, normalizeAbcProgram } from "./abc-program";
export const ABC_PROGRAM_DASHBOARD_TIMEOUT_MS = 300_000;
export function wrapDashboardBackendError(error: unknown, messageKey: string) {
  if (!(error instanceof BackendResponseError || error instanceof SyntaxError)) return error;
  return new Error(
    t(messageKey, {
      status: error instanceof BackendResponseError ? error.status : 502,
      detail:
        error instanceof BackendResponseError
          ? error.detail
          : t("api.backendRequestFailed", { message: error.message }),
    }),
    { cause: error }
  );
}
function applySimpleConditions(
  rows: Array<Record<string, unknown>>,
  conditions: unknown
): Array<Record<string, unknown>> {
  const list = Array.isArray(conditions) ? conditions : [];
  const limit = list.find((item: any) => String(item?.type || "").toUpperCase() === "LIMIT");
  const max = Number(limit?.originSample ?? limit?.value ?? 0);
  return Number.isFinite(max) && max > 0 ? rows.slice(0, max) : rows;
}
function extractRowsFromDslResult(payload: any): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((item) => item && typeof item === "object");
  }
  if (Array.isArray(payload?.data[0]?.answer)) {
    return payload.data[0].answer.filter((item: unknown) => item && typeof item === "object");
  }
  if (Array.isArray(payload?.data)) {
    return payload.data.filter((item: unknown) => item && typeof item === "object");
  }
  if (Array.isArray(payload?.answer)) {
    return payload.answer.filter((item: unknown) => item && typeof item === "object");
  }

  return [];
}
function extractRowsFromBackendPayload(payload: any): Array<Record<string, unknown>> {
  if (Array.isArray(payload?.data)) {
    return payload.data.filter((item: unknown) => item && typeof item === "object");
  }
  return extractRowsFromDslResult(payload);
}

async function inferChartFields(
  chartType: string,
  chartName: string,
  rows: Array<Record<string, unknown>>
) {
  const profile = buildDatasetProfile({
    datasetKey: "runtime",
    subQuestion: chartName,
    dsl: {},
    data: rows,
  });
  const mapped = await batchAppendChartFieldMapper(
    [
      {
        datasetKey: "runtime",
        name: chartName || tApp("queryFixed.149"),
        type: chartType || "bar",
      },
    ],
    [profile]
  );
  return mapped.charts?.[0]?.fields || {};
}
export async function getDashboardConditions(dsls: unknown[], tk: string, locale?: string) {
  if (!dsls.length) {
    throw new HttpError(400, t("api.dslsCannotBeEmpty"));
  }

  const backendUrl = config.dataQuery.baseUrl;
  if (!backendUrl) {
    throw new Error(
      t("api.getConditionsFailed", {
        status: 500,
        detail: t("api.backendNotConfigured"),
      })
    );
  }
  const endpoint = "/dashboard/getConditionsFromDsls";
  let payload: any;
  try {
    const response = await backendPost(
      endpoint,
      `${backendUrl.replace(/\/$/, "")}${endpoint}`,
      { dsls },
      { token: tk, locale }
    );
    payload = (response.headers.get("content-type") || "").includes("application/json")
      ? JSON.parse(response.text)
      : response.text;
  } catch (error) {
    throw wrapDashboardBackendError(error, "api.getConditionsFailed");
  }
  const conditions = Array.isArray(payload?.data) ? payload.data : [];
  return { conditions };
}
export async function queryDashboardData(body: any, tk: string, locale?: string) {
  const dsl =
    body?.dsl && typeof body.dsl === "object" && !Array.isArray(body.dsl) ? body.dsl : null;
  const abcProgram = normalizeAbcProgram(body?.abcProgram);
  const conditions = Array.isArray(body?.conditions) ? body.conditions : [];
  const timeoutMs = Number(
    body?.timeoutMs || (abcProgram ? ABC_PROGRAM_DASHBOARD_TIMEOUT_MS : 30000)
  );

  if (!dsl && !abcProgram) {
    throw new HttpError(400, t("api.dslCannotBeEmpty"));
  }

  const backendUrl = config.dataQuery.baseUrl;
  if (!backendUrl) {
    throw new Error(
      t("api.executionFailed", {
        status: 500,
        detail: t("api.backendNotConfigured"),
      })
    );
  }
  const endpoint = abcProgram
    ? "/abcProgram/queryDataByDashboard"
    : "/dashboard/getAnswerByDslConditionParam";
  let payload: any;
  try {
    const response = await backendPost(
      endpoint,
      `${backendUrl.replace(/\/$/, "")}${endpoint}`,
      abcProgram
        ? buildAbcProgramQueryPayload(abcProgram, conditions)
        : { dsl, params: conditions },
      { token: tk, timeoutMs, locale }
    );
    payload = (response.headers.get("content-type") || "").includes("application/json")
      ? JSON.parse(response.text)
      : response.text;
  } catch (error) {
    throw wrapDashboardBackendError(error, "api.executionFailed");
  }

  const rows = abcProgram
    ? extractRowsFromBackendPayload(payload)
    : applySimpleConditions(extractRowsFromDslResult(payload.data), conditions);
  const chartType = String(body?.chartType || "bar").trim();
  const chartTitle = String(body?.chartTitle || body?.name || tApp("queryFixed.149")).trim();
  const inputFields =
    body?.fields && typeof body.fields === "object" && !Array.isArray(body.fields)
      ? body.fields
      : null;
  const fields =
    inputFields && Object.keys(inputFields).length > 0
      ? inputFields
      : await inferChartFields(chartType, chartTitle, rows);
  const fieldDisplayPlan = await createFieldDisplayPlan(rows, {
    subQuestion: chartTitle || tApp("queryFixed.149"),
    outputKeyDescriptionMDTable:
      typeof payload?.outputKeyDescriptionMDTable === "string"
        ? payload.outputKeyDescriptionMDTable
        : undefined,
    code: abcProgram?.code,
    locale,
  });
  const uiRows = applyFieldDisplayNames(
    applyFieldDisplayPlan(rows, fieldDisplayPlan, locale),
    fieldDisplayPlan
  );

  return {
    data: uiRows,
    rawData: rows,
    fields,
    dsl: dsl || {},
    abcProgram: abcProgram || undefined,
  };
}
