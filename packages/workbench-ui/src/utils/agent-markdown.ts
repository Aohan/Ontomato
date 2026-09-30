import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/core";

/* Register languages on-demand */
import json from "highlight.js/lib/languages/json";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import sql from "highlight.js/lib/languages/sql";
import bash from "highlight.js/lib/languages/bash";
import markdown from "highlight.js/lib/languages/markdown";
import xml from "highlight.js/lib/languages/xml";

hljs.registerLanguage("json", json);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("xml", xml);

/* Module-level singleton */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  highlight(str: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const result = hljs.highlight(str, { language: lang, ignoreIllegals: true });
        return `<pre class="hljs-code-block"><code class="hljs language-${lang}">${result.value}</code></pre>`;
      } catch {
        /* fall through */
      }
    }
    /* Auto-detect fallback */
    try {
      const result = hljs.highlightAuto(str);
      return `<pre class="hljs-code-block"><code class="hljs">${result.value}</code></pre>`;
    } catch {
      /* fall through */
    }
    return `<pre class="hljs-code-block"><code class="hljs">${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

/**
 * Fix unclosed code fences during streaming.
 *
 * When the stream is still in progress the last code block may be unclosed.
 * We detect an odd number of triple-backtick fences and append a closing one.
 */
function fixUnclosedFences(src: string): string {
  const fencePattern = /^```/gm;
  let count = 0;
  while (fencePattern.exec(src) !== null) count++;
  if (count % 2 !== 0) {
    return src + "\n```";
  }
  return src;
}

/**
 * Render a markdown string to HTML, handling streaming edge cases.
 */
export function renderAgentMarkdown(content: string): string {
  if (!content) return "";
  const fixed = fixUnclosedFences(content);
  return md.render(fixed);
}

/** Render a complete JSON object or array as a formatted code block, with Markdown fallback. */
export function renderAgentMarkdownWithJsonFormatting(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return renderAgentMarkdown(content);
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object") return renderAgentMarkdown(content);
    return renderAgentMarkdown(`\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``);
  } catch {
    return renderAgentMarkdown(content);
  }
}
