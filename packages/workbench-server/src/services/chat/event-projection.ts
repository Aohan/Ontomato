import type { ChatClientEvent } from "@ontomato/contracts/chat";
import { t } from "../../i18n";
import { createSseErrorEvent } from "../../utils/sse";

export function convertEventForFrontend(event: any): ChatClientEvent | null {
  const { type, node, content } = event;

  if (type === "thinking_state") {
    return {
      type: "thinking_state",
      thinking: content.thinking || content,
      thinkingState: content.thinkingState,
    };
  }

  if (type === "abc_thinking") {
    return {
      type: "thinking_state",
      thinking: content.thinking || content,
      thinkingState: content.thinkingState || content.abcState,
    };
  }

  if (type === "abc_content") {
    return {
      type: "abc_content",
      content: content.content || content,
      loading: content.loading,
    };
  }

  if (type === "abc_analysis") {
    return {
      type: "abc_analysis",
      ...content,
    };
  }

  if (type === "query_datasets") {
    return {
      type: "query_datasets",
      datasets: event.datasets || content?.datasets || [],
      nodeIds: event.nodeIds || content?.nodeIds || [],
    };
  }

  if (type === "abc_progress") {
    return {
      type: "abc_progress",
      progress: content.progress || content,
    };
  }

  if (type === "post_thinking") {
    return {
      type: "post_thinking",
      content: content.content || content,
      label: event.label,
      mode: event.mode,
      qcState: event.qcState,
    };
  }

  if (type === "clarification") {
    return {
      type: "clarification",
      message: content.message,
      options: content.options || [],
    };
  }

  if (
    type === "abc_analysis_start" ||
    type === "abc_analysis_chunk" ||
    type === "abc_analysis_done"
  ) {
    return {
      type,
      ...content,
    };
  }

  if (type === "token") {
    if (node === "analysis") {
      return {
        type: "analysis_token",
        content,
      };
    }

    return {
      type: "token",
      content,
    };
  }

  switch (type) {
    case "progress":
      if (node === "knowledge") {
        return {
          type: "thinking_summary",
          thinkingSummary: content,
        };
      }
      if (node && ["query", "analysis", "visualization"].includes(node)) {
        return {
          type: "chain_start",
          name: getNodeDisplayName(node),
          icon: getNodeIcon(node),
        };
      }
      return null;

    case "thinking":
      if (node === "query" || node === "analysis" || node === "visualization") {
        return {
          type: "thinking_summary",
          thinkingSummary: content,
          thinkingSteps: event.thinkingSteps,
          thinkingState: event.thinkingState,
        };
      }
      return null;

    case "error":
      return createSseErrorEvent(content, event.timestamp);

    case "result":
      if (node === "query" && (content?.markdownTable || content?.execution)) {
        return {
          type: "result",
          content,
        };
      }
      return null;

    default:
      return null;
  }
}

function getNodeDisplayName(node: string): string {
  const names: Record<string, string> = {
    query: t("response.queryData"),
    analysis: t("response.analyzeData"),
    visualization: t("response.generateChart"),
  };
  return names[node] || node;
}

function getNodeIcon(node: string): string {
  const icons: Record<string, string> = {
    query: "🔍",
    analysis: "📈",
    visualization: "📊",
  };
  return icons[node] || "⚡";
}
