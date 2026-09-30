import { marked } from "../../../../../utils/marked";
import type { ChartSpec, TableData, VisualizationHTML } from "../types";
import { normalizeMermaidSrc } from "../../../utils/mermaid";
import { workbenchContent } from "../../../../../content";

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function extractVisualizationHTML(markdown: string): VisualizationHTML | null {
  const htmlRegex = /```html\s*\n([\s\S]*?)\n```/;
  const match = markdown.match(htmlRegex);

  if (!match) return null;

  const html = match[1].trim();

  // Check whether it's a rendering placeholder
  if (html.includes("visualization-loading")) {
    return {
      html,
      type: "visualization",
      meta: { loading: true },
    };
  }

  if ((html && html.includes("<!DOCTYPE html>")) || html.includes("echarts")) {
    return {
      html,
      type: "visualization",
      meta: {},
    };
  }

  return null;
}

export function extractVisualizationBlocks(markdown: string): Array<{
  html: string;
  fullMatch: string;
  index: number;
}> {
  const blocks: Array<{ html: string; fullMatch: string; index: number }> = [];
  const htmlRegex = /```html\s*\n([\s\S]*?)\n```/g;
  let match: RegExpExecArray | null;

  while ((match = htmlRegex.exec(markdown)) !== null) {
    const html = match[1].trim();
    if (!html) continue;
    if (!(html.includes("<!DOCTYPE html>") || html.includes("echarts"))) continue;
    blocks.push({
      html,
      fullMatch: match[0],
      index: match.index,
    });
  }

  return blocks;
}

export function extractSubgraphBlocks(markdown: string): Array<{
  subgraph: unknown;
  fullMatch: string;
  index: number;
}> {
  const blocks: Array<{ subgraph: unknown; fullMatch: string; index: number }> = [];
  // Created on every call (the exec loop depends on lastIndex); the fence name comes from the app value.
  const subgraphRegex = new RegExp(
    `\`\`\`${workbenchContent().subgraphFence}\\s*\\n([\\s\\S]*?)\\n\`\`\``,
    "g"
  );
  let match: RegExpExecArray | null;

  while ((match = subgraphRegex.exec(markdown)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      const subgraph = parsed?.subgraph ?? parsed;
      if (!subgraph || typeof subgraph !== "object") continue;
      blocks.push({
        subgraph,
        fullMatch: match[0],
        index: match.index,
      });
    } catch {
      continue;
    }
  }

  return blocks;
}

export function extractChartSpec(markdown: string): ChartSpec | null {
  const jsonRegex = /```json\s*\n([\s\S]*?)\n```/;
  const match = markdown.match(jsonRegex);

  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]);
    if (parsed.chartType && parsed.title && parsed.data && Array.isArray(parsed.data)) {
      return {
        chartType: parsed.chartType,
        title: parsed.title || "",
        xField: parsed.xField || "",
        yField: parsed.yField || "",
        seriesField: parsed.seriesField || "",
        data: parsed.data,
        reason: parsed.reason || "",
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function extractAllTables(markdown: string): TableData[] {
  const tables: TableData[] = [];
  const tableRegex = /\|(.+)\|\n\|[-\s|:]+\|\n((?:\|.+\|\n?)+)/g;
  let match;
  let id = 0;

  while ((match = tableRegex.exec(markdown)) !== null) {
    const headers = match[1]
      .split("|")
      .map((h) => h.trim())
      .filter(Boolean);

    const rowsStr = match[2].trim();
    const rows = rowsStr.split("\n").map((row) =>
      row
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean)
    );

    const beforeTable = markdown.substring(0, match.index);
    const titleMatch = beforeTable.match(/#{1,4}\s+([^\n]+)\s*$/);
    const title = titleMatch ? titleMatch[1].trim() : "";

    const contextBefore = beforeTable.slice(-200).toLowerCase();
    let chartType: TableData["chartType"] = "bar";
    const intent = workbenchContent().chartIntentKeywords;
    const mentions = (words: readonly string[]) => words.some((word) => contextBefore.includes(word));
    if (mentions(intent.trend)) {
      chartType = "line";
    } else if (mentions(intent.proportion)) {
      chartType = "pie";
    } else if (mentions(intent.correlation)) {
      chartType = "scatter";
    }

    tables.push({
      id: id++,
      headers,
      rows,
      chartType,
      title,
      beforeContent: beforeTable,
    });
  }

  return tables;
}

export function checkVisualizationRequest(markdown: string): boolean {
  return workbenchContent().chartIntentKeywords.visualization.some((k) => markdown.includes(k));
}

export function renderMarkdown(content: string): string {
  let cleaned = content
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<warning>[\s\S]*?<\/warning>/g, "")
    .replace(/<system-reminder>[\s\S]*/g, "")
    .replace(/<warning>[\s\S]*/g, "")
    .replace(/<system-reminder>/g, "")
    .replace(/<\/system-reminder>/g, "")
    .replace(/<warning>/g, "")
    .replace(/<\/warning>/g, "");

  const renderer = new marked.Renderer();

  const originalCode = renderer.code.bind(renderer);
  renderer.code = function (token): string {
    const { text, lang } = token;
    if (lang === "mermaid") {
      const normalized = normalizeMermaidSrc(text);
      return `<div class="mermaid" data-mermaid-src="${escapeAttr(normalized)}">${normalized}</div>`;
    }

    return originalCode(token);
  };

  const originalTable = renderer.table.bind(renderer);
  renderer.table = function (token: any): string {
    const tableHtml = originalTable(token);
    return `<div class="data-result-table-wrapper">${tableHtml}</div>`;
  };

  renderer.image = function ({
    href,
    title,
    text,
  }: {
    href: string;
    title?: string | null;
    text?: string;
  }) {
    const src = href || "";
    const caption = title || text || "";
    return `<img src="${escapeAttr(src)}" alt="${escapeAttr(text || "")}" title="${escapeAttr(caption)}" data-lightbox-group="message-content" data-caption="${escapeAttr(caption)}" class="message-inline-image" />`;
  };

  return marked.parse(cleaned, { renderer, breaks: true, gfm: true }) as string;
}
