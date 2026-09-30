import { marked } from "./marked";
import { withSkillResourceCredentials } from "../features/skills/utils/skill-resource";

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderMarkdown(text: string): string {
  if (!text) return "";

  // Extract ```html blocks (visualization/chart HTML) and render as iframes
  const htmlRegex = /```html\s*\n([\s\S]*?)\n```/g;
  let result = text;
  const blocks: Array<{ html: string; fullMatch: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = htmlRegex.exec(text)) !== null) {
    const html = match[1].trim();
    if (
      html &&
      (html.includes("<!DOCTYPE html>") ||
        html.includes("echarts") ||
        html.includes("chart-container"))
    ) {
      blocks.push({ html, fullMatch: match[0] });
    }
  }

  for (const block of blocks) {
    const escaped = escapeAttr(withSkillResourceCredentials(block.html));
    const iframeHtml = `<div class="chart-section"><div class="chart-wrapper"><iframe srcdoc="${escaped}" class="visualization-iframe" sandbox="allow-scripts allow-same-origin" style="width:100%;height:400px;border:1px solid #e2e8f0;border-radius:8px;"></iframe></div></div>`;
    result = result.replace(block.fullMatch, iframeHtml);
  }

  return marked.parse(result) as string;
}

export function stripMarkdown(text: string): string {
  if (!text) return "";
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/[#*`>|~[\]()]/g, "")
    .replace(/\n+/g, " ")
    .trim();
}
