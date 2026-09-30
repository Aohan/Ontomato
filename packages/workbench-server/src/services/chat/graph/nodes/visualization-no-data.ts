import { t } from "../../../../i18n";

/**
 * The "no chart generated" notice the visualization node emits directly when the query returns 0 rows (open-source pre-migration behavior):
 * rendering is not invoked; the notice image is written and the node ends. The enterprise edition keeps the generic render path and assembles null.
 */
export type NoDataVisualization = () => { title: string; message: string; html: string };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    };
    return entities[char] || char;
  });
}

function createNoDataVisualizationHtml(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#606266;background:#fff}main{max-width:720px;margin:0 auto;padding:20px 0}h2{margin:0 0 8px;font-size:16px;font-weight:600;color:#303133}p{margin:0;line-height:1.6}</style></head><body><main><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></main></body></html>`;
}

export const noDataChart: NoDataVisualization = () => {
  const title = t("viz.noDataChartTitle");
  const message = t("viz.noDataChartMessage");
  return { title, message, html: createNoDataVisualizationHtml(title, message) };
};

let installed: NoDataVisualization | null | undefined;

export function installNoDataVisualization(visualization: NoDataVisualization | null): void {
  installed = visualization;
}

export function noDataVisualization(): NoDataVisualization | null {
  if (installed === undefined) throw new Error("No-data visualization is not installed");
  return installed;
}
