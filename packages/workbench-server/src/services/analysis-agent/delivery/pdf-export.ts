import { marked } from "./marked";
import { t } from "../../../i18n";
import { renderChartHtmlToDataUrl, walkChartBlocks } from "./chart-renderer";
import { getBrowser } from "./browser";
import { tApp } from "../../../i18n";


export interface ExportMarkdownPdfInput {
  markdown: string;
  title?: string;
  timeoutMs?: number;
  renderInlineCharts?: boolean;
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildChartImageHtml(dataUrl: string, index: number) {
  const alt = escapeHtml(tApp("analysis.delivery.pdf-export.26", { value: index + 1 }));
  return [
    `<div class="pdf-chart-card">`,
    `  <div class="pdf-chart-card__header">`,
    tApp("analysis.delivery.pdf-export.27"),
    `  </div>`,
    `  <div class="pdf-chart-card__body">`,
    `    <img src="${dataUrl}" alt="${alt}" />`,
    `  </div>`,
    `</div>`,
  ].join("\n");
}

async function convertInlineCharts(markdown: string, timeoutMs: number) {
  return walkChartBlocks(markdown, (chartHtml, chartIndex) =>
    renderChartHtmlToDataUrl(chartHtml, timeoutMs).then((dataUrl) =>
      buildChartImageHtml(dataUrl, chartIndex)
    )
  );
}

function buildPdfHtml(title: string, bodyHtml: string) {
  const safeTitle = escapeHtml(title);

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle || t("report.defaultTitle")}</title>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
      }

      body {
        font-family: "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #111827;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .pdf-page {
        width: 760px;
        margin: 0 auto;
        padding: 0;
        font-size: 12px;
        line-height: 1.7;
        overflow-wrap: break-word;
        word-break: break-word;
      }

      .pdf-page * {
        box-sizing: border-box;
      }

      .pdf-page h1 { font-size: 20px; margin: 0 0 14px; }
      .pdf-page h2 { font-size: 16px; margin: 18px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
      .pdf-page h3 { font-size: 14px; margin: 14px 0 8px; }
      .pdf-page h4 { font-size: 13px; margin: 12px 0 6px; }
      .pdf-page p { margin: 8px 0; }
      .pdf-page ul, .pdf-page ol { margin: 8px 0 8px 20px; }
      .pdf-page li { margin: 4px 0; }

      .pdf-page blockquote {
        margin: 10px 0;
        padding: 8px 12px;
        border-left: 3px solid #93c5fd;
        background: #f8fafc;
      }

      .pdf-page pre {
        margin: 10px 0 14px;
        padding: 10px 12px;
        border-radius: 8px;
        background: #f3f4f6;
        white-space: pre-wrap;
      }

      .pdf-page code {
        font-family: "SFMono-Regular", ui-monospace, Menlo, monospace;
      }

      .pdf-page table {
        width: 100%;
        border-collapse: collapse;
        margin: 12px 0 16px;
        table-layout: fixed;
        background: #ffffff;
      }

      .pdf-page th,
      .pdf-page td {
        border: 1px solid #d1d5db;
        padding: 8px 10px;
        text-align: left;
        vertical-align: top;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .pdf-page th {
        background: #f3f4f6;
        font-weight: 600;
      }

      .pdf-page .pdf-chart-card {
        margin: 12px 0 18px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        overflow: hidden;
        background: #ffffff;
        page-break-inside: avoid;
      }

      .pdf-page .pdf-chart-card__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: 1px solid #d1d5db;
      }

      .pdf-page .pdf-chart-card__title {
        font-weight: 500;
        color: #111827;
      }

      .pdf-page .pdf-chart-card__body {
        padding: 10px;
      }

      .pdf-page .pdf-chart-card__body img {
        display: block;
        width: 100%;
        height: auto;
        margin: 0;
        border: none;
        border-radius: 4px;
        background: #ffffff;
      }
    </style>
  </head>
  <body>
    <div class="pdf-page">${bodyHtml}</div>
  </body>
</html>`;
}

export async function exportMarkdownPdf(input: ExportMarkdownPdfInput) {
  const markdown = String(input.markdown || "").trim();
  if (!markdown) {
    throw new Error(t("api.noReportToExport"));
  }

  const browser = await getBrowser();
  const page = await browser.newPage();
  const timeoutMs = input.timeoutMs ?? 30_000;

  try {
    const sourceMarkdown = input.renderInlineCharts
      ? await convertInlineCharts(markdown, timeoutMs)
      : markdown;
    const html = buildPdfHtml(
      input.title || t("report.defaultTitle"),
      marked.parse(sourceMarkdown) as string
    );
    await page.setContent(html, {
      waitUntil: "load",
      timeout: timeoutMs,
    });

    await page.emulateMedia({ media: "screen" });
    await page.addStyleTag({
      content: "@page { size: A4; margin: 16mm 14mm 18mm; }",
    });

    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", right: "14mm", bottom: "18mm", left: "14mm" },
    });
  } finally {
    await page.close();
  }
}
