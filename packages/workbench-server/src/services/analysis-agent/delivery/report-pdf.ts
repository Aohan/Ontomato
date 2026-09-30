import type { AnalysisTask } from "../task-types";
import { buildDeepAnalysisMarkdown } from "../task/task-result";
import { exportMarkdownPdf } from "./pdf-export";

/** The single decision point for exportability: schedule rules, non-report tasks, and an empty latest-run body are all non-exportable. */
export function analysisReportPdfSource(owned: {
  task: Pick<AnalysisTask, "name" | "reportDeliverableEnabled" | "analysisPayload">;
  rule?: object;
}): { title: string; markdown: string } | null {
  if (owned.rule) return null;
  if (owned.task.reportDeliverableEnabled === false) return null;
  const payload = owned.task.analysisPayload;
  if (!payload) return null;
  const markdown = buildDeepAnalysisMarkdown(payload);
  if (!markdown.trim()) return null;
  return { title: owned.task.name, markdown };
}

/** `<task name>_YYYY-MM-DDTHH-mm-ss.pdf`, with the timestamp taken from server local time. */
function analysisReportPdfFileName(taskName: string, now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${taskName}_${stamp}.pdf`;
}

export async function exportAnalysisReportPdf(
  source: { title: string; markdown: string },
  now: Date
) {
  const bytes = await exportMarkdownPdf({
    title: source.title,
    markdown: source.markdown,
    renderInlineCharts: true,
  });
  return { bytes, fileName: analysisReportPdfFileName(source.title, now) };
}
