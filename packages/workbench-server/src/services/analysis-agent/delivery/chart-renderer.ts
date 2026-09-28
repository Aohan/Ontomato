import { echartDir } from "../../../content/layout";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createLogger } from "../../../logging/logger";
import { replaceChartMarkers } from "../report/chart-marker";
import { getBrowser } from "./browser";
import { tApp } from "../../../i18n";


const logger = createLogger("chart-renderer");


const CHART_VIEWPORT_WIDTH = 1000;
const CHART_VIEWPORT_HEIGHT = 500;

let chartRuntimeScriptPromise: Promise<string> | null = null;

async function getChartRuntimeScript() {
  if (!chartRuntimeScriptPromise) {
    chartRuntimeScriptPromise = readFile(path.join(echartDir(), "echarts.min.js"), "utf-8");
  }
  return chartRuntimeScriptPromise;
}

function escapeInlineScript(value: string) {
  return String(value || "").replace(/<\/script/gi, "<\\/script");
}

function inlineChartRuntime(html: string, echartsScript: string) {
  let normalizedHtml = String(html || "").trim();
  const inlineScriptTag = `<script>${escapeInlineScript(echartsScript)}</script>`;

  if (
    /<script\b[^>]*src=["'][^"']*echarts(?:\.min)?\.js["'][^>]*>\s*<\/script>/i.test(normalizedHtml)
  ) {
    normalizedHtml = normalizedHtml.replace(
      /<script\b[^>]*src=["'][^"']*echarts(?:\.min)?\.js["'][^>]*>\s*<\/script>/i,
      inlineScriptTag
    );
  } else if (normalizedHtml.includes("echarts.init(")) {
    if (/<\/head>/i.test(normalizedHtml)) {
      normalizedHtml = normalizedHtml.replace(/<\/head>/i, `${inlineScriptTag}\n</head>`);
    } else {
      normalizedHtml = `${inlineScriptTag}\n${normalizedHtml}`;
    }
  }

  return normalizedHtml;
}

function ensureChartDocument(html: string) {
  const normalizedHtml = String(html || "").trim();
  if (/<html[\s>]/i.test(normalizedHtml)) {
    return normalizedHtml;
  }

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
      }
    </style>
  </head>
  <body>
${normalizedHtml}
  </body>
</html>`;
}

export async function renderChartHtmlToDataUrl(
  html: string,
  timeoutMs: number = 30_000
): Promise<string> {
  const browser = await getBrowser();
  const echartsScript = await getChartRuntimeScript();

  const chartPage = await browser.newPage({
    viewport: { width: CHART_VIEWPORT_WIDTH, height: CHART_VIEWPORT_HEIGHT },
    deviceScaleFactor: 2,
  });

  try {
    const content = ensureChartDocument(inlineChartRuntime(html, echartsScript));
    await chartPage.setContent(content, {
      waitUntil: "load",
      timeout: timeoutMs,
    });

    await chartPage.waitForFunction(
      () => {
        const graphic = document.querySelector("#chart canvas, #chart svg, canvas, svg");
        if (!graphic) return false;
        const rect = graphic.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      },
      undefined,
      { timeout: Math.min(timeoutMs, 15_000) }
    );

    await chartPage.evaluate(async () => {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }

      const chartRoot = document.getElementById("chart");
      const echartsRef = (window as any).echarts;
      const chartInstance =
        chartRoot && echartsRef?.getInstanceByDom ? echartsRef.getInstanceByDom(chartRoot) : null;

      if (chartInstance?.resize) {
        chartInstance.resize();
      }

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    await chartPage.waitForTimeout(500);

    const screenshot = await chartPage.screenshot({
      type: "png",
      animations: "disabled",
    });

    return `data:image/png;base64,${screenshot.toString("base64")}`;
  } finally {
    await chartPage.close();
  }
}

export async function renderChartsToDataUrls(
  chartHtmls: Record<string, string>,
  timeoutMs: number = 30_000
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [chartId, html] of Object.entries(chartHtmls)) {
    try {
      result[chartId] = await renderChartHtmlToDataUrl(html, timeoutMs);
    } catch (err) {
      logger.error(tApp("analysis.delivery.chart-renderer.22"), {
        chartId,
        error: err instanceof Error ? err.message : String(err),
      });
      result[chartId] = "";
    }
  }
  return result;
}

export async function replaceChartMarkersWithImages(
  markdown: string,
  chartDataUrls: Record<string, string>
): Promise<string> {
  const availableChartIds = Object.entries(chartDataUrls)
    .filter(([, dataUrl]) => Boolean(dataUrl))
    .map(([chartId]) => chartId);

  return replaceChartMarkers(
    markdown,
    ({ chartId }) => {
      const dataUrl = chartDataUrls[chartId];
      return dataUrl
        ? tApp("analysis.delivery.chart-renderer.23", { dataUrl: dataUrl })
        : undefined;
    },
    {
      onUnmatched: (markers) => {
        logger.warn(tApp("analysis.delivery.chart-renderer.24"), {
          unmatchedMarkers: markers.map((marker) => `${marker.scope}:${marker.chartId}`),
          availableChartIds,
        });
      },
    }
  );
}

export async function convertInlineChartBlocks(
  markdown: string,
  timeoutMs: number = 30_000
): Promise<string> {
  return walkChartBlocks(markdown, (chartHtml, chartIndex) =>
    renderChartHtmlToDataUrl(chartHtml, timeoutMs).then(
      (dataUrl) =>
        tApp("analysis.delivery.chart-renderer.25", { dataUrl: dataUrl, value: chartIndex + 1 })
    )
  );
}

export async function walkChartBlocks(
  source: string,
  onChart: (chartHtml: string, chartIndex: number) => Promise<string>
): Promise<string> {
  const normalizedSource = String(source || "");
  if (!normalizedSource.includes("```html")) {
    return normalizedSource;
  }

  const chartBlockRegex = /```html\s*\n([\s\S]*?)\n```/g;
  const segments: string[] = [];
  let lastIndex = 0;
  let chartIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = chartBlockRegex.exec(normalizedSource)) !== null) {
    segments.push(normalizedSource.slice(lastIndex, match.index));

    const chartHtml = String(match[1] || "").trim();
    const looksLikeVisualization =
      chartHtml.includes("<!DOCTYPE html>") || chartHtml.includes("echarts.init(");

    if (!looksLikeVisualization) {
      segments.push(match[0]);
    } else {
      try {
        const replacement = await onChart(chartHtml, chartIndex);
        segments.push(replacement);
        chartIndex += 1;
      } catch {
        segments.push(match[0]);
      }
    }

    lastIndex = match.index + match[0].length;
  }

  segments.push(normalizedSource.slice(lastIndex));
  return segments.join("");
}
