import { computed, type Ref } from "vue";
import { type ContentPart } from "../components/MessageContent/types";
import {
  extractChartSpec,
  extractSubgraphBlocks,
  extractVisualizationHTML,
  extractVisualizationBlocks,
  extractAllTables,
} from "../components/MessageContent/utils/markdown";

export function useContentParser(
  content: Ref<string>,
  visualizationHTML: Ref<string | undefined>,
  visualizationLoading: Ref<boolean | undefined>
) {
  const contentParts = computed<ContentPart[]>(() => {
    if (!content.value && !visualizationHTML.value && !visualizationLoading.value) return [];

    const parts: ContentPart[] = [];

    if (visualizationHTML.value) {
      if (content.value.trim()) {
        parts.push({ type: "text", content: content.value });
      }
      parts.push({
        type: "visualization",
        content: "",
        visualization: {
          type: "visualization",
          html: visualizationHTML.value,
          meta: { loading: false },
        },
      });
      return parts;
    } else if (visualizationLoading.value) {
      if (content.value.trim()) {
        parts.push({ type: "text", content: content.value });
      }
      parts.push({
        type: "visualization",
        content: "",
        visualization: {
          type: "visualization",
          html: "",
          meta: { loading: true },
        },
      });
      return parts;
    }

    if (!content.value) return [];

    function appendPlainContent(text: string) {
      if (!text.trim()) return;

      const vizBlocks = extractVisualizationBlocks(text);
      if (vizBlocks.length > 0) {
        let cursor = 0;
        for (const block of vizBlocks) {
          if (block.index > cursor) {
            const beforeHtml = text.substring(cursor, block.index);
            if (beforeHtml.trim()) {
              parts.push({ type: "text", content: beforeHtml });
            }
          }

          parts.push({
            type: "visualization",
            content: block.fullMatch,
            visualization: {
              type: "visualization",
              html: block.html,
              meta: {},
            },
          });

          cursor = block.index + block.fullMatch.length;
        }

        if (cursor < text.length) {
          const afterHtml = text.substring(cursor);
          if (afterHtml.trim()) {
            parts.push({ type: "text", content: afterHtml });
          }
        }

        return;
      }

      const vizHTML = extractVisualizationHTML(text);
      if (vizHTML) {
        parts.push({ type: "visualization", content: text, visualization: vizHTML });
        return;
      }

      const chartSpec = extractChartSpec(text);
      if (chartSpec) {
        const jsonRegex = /```json\s*\n[\s\S]*?\n```/;
        const match = text.match(jsonRegex);

        if (match && match.index !== undefined) {
          const beforeJson = text.substring(0, match.index);
          const afterJson = text.substring(match.index + match[0].length);

          if (beforeJson.trim()) {
            parts.push({ type: "text", content: beforeJson });
          }

          parts.push({ type: "chart", content: match[0], chart: chartSpec });

          if (afterJson.trim()) {
            parts.push({ type: "text", content: afterJson });
          }

          return;
        }
      }

      let lastIndex = 0;
      const tableRegex = /\|(.+)\|\n\|[-\s|:]+\|\n((?:\|.+\|\n?)+)/g;
      let match;
      let tableIndex = 0;
      const tables = extractAllTables(text).filter((table) => {
        const before = table.beforeContent || "";
        const lastOpen = before.lastIndexOf("<details");
        const lastClose = before.lastIndexOf("</details>");
        return lastOpen <= lastClose;
      });

      while ((match = tableRegex.exec(text)) !== null) {
        const before = text.substring(0, match.index);
        const lastOpen = before.lastIndexOf("<details");
        const lastClose = before.lastIndexOf("</details>");
        if (lastOpen > lastClose) {
          continue;
        }

        if (match.index > lastIndex) {
          parts.push({
            type: "text",
            content: text.substring(lastIndex, match.index),
          });
        }

        if (tableIndex < tables.length) {
          let tableContent = match[0];
          let nextIndex = match.index + match[0].length;
          const trailing = text.slice(nextIndex);
          const detailsMatch = trailing.match(/^\s*<details[\s\S]*?<\/details>/);

          if (detailsMatch) {
            tableContent += detailsMatch[0];
            nextIndex += detailsMatch[0].length;
            tableRegex.lastIndex = nextIndex;
          }

          parts.push({
            type: "table",
            content: tableContent,
            table: tables[tableIndex],
          });
          tableIndex++;
          lastIndex = nextIndex;
          continue;
        }

        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < text.length) {
        parts.push({
          type: "text",
          content: text.substring(lastIndex),
        });
      }
    }

    const subgraphBlocks = extractSubgraphBlocks(content.value);
    if (subgraphBlocks.length > 0) {
      let cursor = 0;
      for (const block of subgraphBlocks) {
        if (block.index > cursor) {
          appendPlainContent(content.value.substring(cursor, block.index));
        }

        parts.push({
          type: "subgraph",
          content: block.fullMatch,
          subgraph: block.subgraph,
        });

        cursor = block.index + block.fullMatch.length;
      }

      if (cursor < content.value.length) {
        appendPlainContent(content.value.substring(cursor));
      }

      return parts;
    }

    appendPlainContent(content.value);

    return parts;
  });

  return {
    contentParts,
  };
}
