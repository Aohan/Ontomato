import { workbenchProduct } from "../../../product/installed";
import { AssertionError } from "node:assert";
import { createLogger } from "../../../logging/logger";
import type {
  AnalysisActivity,
  AnalysisActivityStatus,
  AnalysisEvidenceQuestion,
  AnalysisSection,
  DeepAnalysisTaskPayload,
} from "@ontomato/contracts/analysis-presentation";
import { qualifiedTable } from "../../postgres";
import type { QueryableClient } from "../helpers";
import { DIMENSION_REPORT_TITLE_POLICY } from "../../../config/report-title-policy";
import { t } from "../../../i18n";

export const PRESENTATION_CONTRACT_VERSION = "20260908_presentation_contract_v1";
export const PRESENTATION_CONTRACT_NAME = "generic analysis presentation contract";
const logger = createLogger("postgres:presentation-migration");

function records<T extends Record<string, any>>(value: T[], field: string): T[] {
  if (!Array.isArray(value) || value.some((v) => !v || typeof v !== "object" || Array.isArray(v)))
    throw new AssertionError({ message: workbenchProduct().migrationCopy.recordsMustBeObjects(field), operator: "legacy-records" });
  return value;
}

export async function ensurePresentationContractSchema(client: QueryableClient): Promise<void> {
  await client.query(
    `ALTER TABLE ${qualifiedTable("analysis_tasks")} ADD COLUMN IF NOT EXISTS request_seq INTEGER`
  );
}

/** Old fields are read only at this migration boundary; the runtime path accepts only the shared contract. */
function convertPayload(
  row: {
    id: string;
    status: string;
    created_at: string;
    updated_at: string;
    result_summary?: string;
    analysis_payload: Record<string, any>;
  },
  oldActivities: AnalysisActivity[]
): DeepAnalysisTaskPayload {
  const old = row.analysis_payload || {};
  const mode = old.executionMode === "loop" ? "loop" : "dimension";
  const status: AnalysisActivityStatus =
    row.status === "completed" || row.status === "failed" || row.status === "cancelled"
      ? row.status
      : "running";
  const startedAt = Number(row.created_at);
  const finishedAt = Number(row.updated_at);
  let revision = 0;
  const activityStatus = (value?: string): AnalysisActivityStatus => {
    if (value === "completed" || value === "failed" || value === "cancelled") return value;
    return status === "running" ? "running" : status === "cancelled" ? "cancelled" : "failed";
  };
  const question = (q: Record<string, any>, fallbackId: string): AnalysisEvidenceQuestion => {
    const questionId = q.questionId || q.id || fallbackId;
    const state =
      q.status === "pending" && status === "running"
        ? "pending"
        : activityStatus(q.status || (q.done ? "completed" : "pending"));
    return {
      questionId,
      question: q.question || q.subQuestion || q.text || "",
      status: state,
      statusText: q.statusText,
      dataCount: q.dataCount,
      error: q.error || (state === "failed" ? q.statusText : undefined),
      execution: q.execution,
    };
  };
  const activities: AnalysisActivity[] =
    mode === "loop"
      ? records(oldActivities, "activities").map((a) => ({
          ...a,
          revision: ++revision,
          status: activityStatus(a.status),
          finishedAt: a.finishedAt ?? (status !== "running" ? finishedAt : undefined),
          ...(a.questions
            ? {
                questions: records(a.questions, `activities[${a.activityId}].questions`).map(
                  (q, i) => question(q, `legacy:${a.activityId}:${i}`)
                ),
              }
            : {}),
        }))
      : [];
  const addActivity = (
    fields: Pick<AnalysisActivity, "activityId" | "kind" | "status"> & Partial<AnalysisActivity>
  ) => {
    const activity: AnalysisActivity = {
      seq: activities.length + 1,
      revision: ++revision,
      startedAt,
      ...fields,
    };
    if (activity.status !== "running") activity.finishedAt = finishedAt;
    activities.push(activity);
  };
  const dimensions = records(
    old.plannedDimensions || old.thinkingTree || [],
    "plannedDimensions/thinkingTree"
  );
  if (mode === "dimension" && dimensions.length) {
    addActivity({
      activityId: "plan",
      kind: "plan",
      status: "completed",
      dimensions: dimensions.map((d, i) => ({
        dimensionId: d.dimensionId || d.id || `legacy:${i}`,
        name: d.dimensionName || d.dimName || d.name || "",
        value: d.dimensionValue || d.value,
        reason: d.reason,
        questions: records(d.subQuestions || d.questions || [], `dimensions[${i}].questions`).map(
          (q, j) => {
            const normalized = question(q, `legacy:${d.dimensionId || d.id || i}:${j}`);
            return { questionId: normalized.questionId, question: normalized.question };
          }
        ),
      })),
    });
    for (const [i, d] of dimensions.entries()) {
      const groupId = d.dimensionId || d.id || `legacy:${i}`;
      const questions = (d.subQuestions || d.questions || []).map(
        (q: Record<string, any>, j: number) =>
          question(q, `legacy:${d.dimensionId || d.id || i}:${j}`)
      ) as AnalysisEvidenceQuestion[];
      addActivity({
        activityId: `evidence:${groupId}`,
        kind: "evidence",
        groupId,
        questions,
        status: questions.some((q) => q.status === "running" || q.status === "pending")
          ? "running"
          : questions.some((q) => q.status === "completed")
            ? "completed"
            : activityStatus(d.status),
      });
    }
  }
  const sections: AnalysisSection[] = records(old.dimensionReports || [], "dimensionReports").map(
    (r: Record<string, any>, order: number) => {
      const groupId = r.dimensionId || r.id || `legacy:${order}`;
      const markdown = String(r.report || "");
      const title =
        DIMENSION_REPORT_TITLE_POLICY === "ensure" && !markdown.trimStart().startsWith("## ")
          ? `${r.dimensionName || ""}${r.dimensionValue ? `${workbenchProduct().migrationCopy.dimensionValueSeparator}${r.dimensionValue}` : ""}`
          : undefined;
      const section: AnalysisSection = {
        sectionId: groupId,
        title: title || undefined,
        titleLevel: 2,
        order,
        markdown,
        status: typeof r.success === "boolean" ? (r.success ? "success" : "failed") : undefined,
        error: r.error,
        revision: ++revision,
      };
      addActivity({
        activityId: `chapter:${groupId}`,
        groupId,
        kind: "chapter",
        chapter: title,
        status:
          r.success === true ? "completed" : r.success === false ? "failed" : activityStatus(),
        error: r.error,
      });
      return section;
    }
  );
  const report = old.summaryReport ?? old.summary ?? old.report ?? "";
  if (report) {
    sections.push({
      sectionId: mode === "loop" ? "report" : "summary",
      title: mode === "dimension" ? workbenchProduct().migrationCopy.summaryTitle : undefined,
      titleLevel: 1,
      order: sections.length,
      markdown: String(report),
      status: status === "running" ? undefined : "success",
      revision: ++revision,
    });
    if (mode === "dimension")
      addActivity({
        activityId: "chapter:summary",
        kind: "chapter",
        chapter: workbenchProduct().migrationCopy.summaryTitle,
        status: status === "running" ? "running" : "completed",
      });
  }
  const charts = [
    ...records(old.dimensionCharts || [], "dimensionCharts"),
    ...records(old.summaryCharts || [], "summaryCharts"),
  ].map((chart: Record<string, any>) => {
    const { dimensionId, dimensionName: _name, dimensionValue: _value, ...result } = chart;
    return {
      ...result,
      scopeId: mode === "loop" ? "report" : dimensionId,
    } as DeepAnalysisTaskPayload["charts"][number];
  });
  if (mode === "dimension") {
    for (const scopeId of new Set(charts.map((c) => c.scopeId))) {
      addActivity({
        activityId: `chart:${scopeId}`,
        kind: "chart",
        status: "completed",
        groupId: scopeId === "summary" ? undefined : scopeId,
        charts: charts
          .filter((c) => c.scopeId === scopeId)
          .map(({ chartId, title }) => ({ chartId, title })),
      });
    }
  }
  const chartDiagnostics = records(old.chartDiagnostics || [], "chartDiagnostics").map((d) => {
    const { scopeType: _type, scopeName: _name, ...diagnostic } = d;
    return {
      ...diagnostic,
      scopeId: mode === "loop" ? "report" : d.scopeId,
    } as DeepAnalysisTaskPayload["chartDiagnostics"][number];
  });
  const questions = activities.flatMap((a) => a.questions || []);
  const settled = questions.filter((q) => q.status !== "running" && q.status !== "pending").length;
  const reports = sections.filter((s) => s.sectionId !== "summary" && s.status).length;
  const done =
    mode === "loop"
      ? activities.filter((a) => a.status !== "running").length
      : status !== "running"
        ? 100
        : dimensions.length
          ? Math.round(
              12 +
                (questions.length ? Math.round((58 * settled) / questions.length) : 0) +
                Math.round((27 * reports) / dimensions.length)
            )
          : 0;
  const current = [...activities].reverse().find((a) => a.status === "running");
  return {
    executionMode: mode,
    runState: {
      status,
      revision: ++revision,
      progress: {
        done,
        ...(mode === "dimension" ? { total: 100 } : {}),
        label:
          mode === "dimension"
            ? t(
                !dimensions.length
                  ? "analysis.progress.framework"
                  : questions.some((q) => q.status !== "completed" && q.status !== "failed")
                    ? "analysis.progress.collection"
                    : sections.length
                      ? "analysis.progress.report"
                      : "analysis.progress.analysis"
              )
            : current?.narrative || current?.topic || current?.chapter || "",
      },
      ...(status === "failed" && row.result_summary ? { error: row.result_summary } : {}),
    },
    activities,
    sections,
    charts,
    chartDiagnostics,
    ...(old.finalAnswer !== undefined ? { finalAnswer: old.finalAnswer } : {}),
  };
}

export async function migratePresentationContract(
  client: QueryableClient
): Promise<{ tasks: number; activities: number; terminalSkips: string[] }> {
  const terminalSkips: string[] = [];
  const rows = await client.query(`SELECT * FROM ${qualifiedTable("analysis_tasks")} t
    WHERE (analysis_payload IS NOT NULL AND NOT analysis_payload ? 'runState')
       OR (analysis_payload IS NULL AND EXISTS (SELECT 1 FROM ${qualifiedTable("analysis_task_events")} e WHERE e.task_id = t.id AND e.source_kind = 'analysis_loop_activity'))
    ORDER BY id`);
  for (const row of rows.rows) {
    const events = await client.query(
      `SELECT payload FROM ${qualifiedTable("analysis_task_events")} WHERE task_id = $1 AND source_kind = 'analysis_loop_activity' ORDER BY event_seq, id`,
      [row.id]
    );
    if (!row.analysis_payload && events.rows.length)
      row.analysis_payload = { executionMode: "loop" };
    let payload: DeepAnalysisTaskPayload;
    try {
      payload = convertPayload(
        row,
        events.rows.map((e) => e.payload)
      );
    } catch (error) {
      if (!(error instanceof AssertionError) || error.operator !== "legacy-records") throw error;
      const reason = workbenchProduct().migrationCopy.conversionFailed(error.message);
      const old = row.analysis_payload || {};
      const report = [
        ...(Array.isArray(old.dimensionReports)
          ? old.dimensionReports.map((r: any) => r?.report)
          : []),
        [old.summaryReport, old.summary, old.report].find((v) => typeof v === "string" && v.trim()),
      ]
        .filter((v) => typeof v === "string" && v.trim())
        .join("\n\n");
      payload = convertPayload(
        {
          ...row,
          status: row.status === "running" ? "failed" : row.status,
          analysis_payload: { executionMode: old.executionMode, summaryReport: report },
        },
        []
      );
      payload.runState.error = reason;
      for (const section of payload.sections) section.markdown = `${reason}\n\n${section.markdown}`;
      payload.activities = [];
      terminalSkips.push(row.id);
      logger.warn(reason, { taskId: row.id });
    }
    const requestSeq = row.analysis_payload?.requestSeq;
    await client.query(
      `UPDATE ${qualifiedTable("analysis_tasks")} SET analysis_payload = $2::jsonb, request_seq = $3 WHERE id = $1`,
      [row.id, JSON.stringify(payload), Number.isInteger(requestSeq) ? requestSeq : null]
    );
  }
  const deleted = await client.query(
    `DELETE FROM ${qualifiedTable("analysis_task_events")} WHERE source_kind = 'analysis_loop_activity'`
  );
  return {
    tasks: rows.rowCount ?? rows.rows.length,
    activities: deleted.rowCount ?? 0,
    terminalSkips,
  };
}
