import type { AnalysisTask } from "../task-types";
import { buildDeepAnalysisMarkdown } from "../task/task-result";
import { exportMarkdownPdf } from "./pdf-export";

/** 能否导出只看这一处：定时规则、非报告任务、最新运行正文为空都不可导出。 */
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

/** `<任务名>_YYYY-MM-DDTHH-mm-ss.pdf`，时间取服务器本地时间。 */
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
