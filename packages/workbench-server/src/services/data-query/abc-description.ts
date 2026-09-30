import type { AbcAnalysisEvent } from "@ontomato/contracts/chat";
import { createModel } from "../../config/model-factory";
import { modelAgentName } from "../../logging/model-agents";
import { t } from "../../i18n";
import { renderPrompt } from "../../core/prompts/loader";
import { createLogger } from "../../logging/logger";

const logger = createLogger("abc-description");

export interface AbcProgressCallback {
  (event: AbcAnalysisEvent): void;
}

export function makeAnalysisTransition(subQuestion: string): string {
  return t("query.abc.transition.analysis", { sq: (subQuestion || "").trim() });
}

export function makeResultTransition(subQuestion?: string): string {
  const sq = (subQuestion || "").trim();
  return sq ? t("query.abc.transition.result", { sq }) : "";
}

export async function streamAbcAnalysis(
  originalQuestion: string,
  subQuestion: string,
  subgraphDesc: string,
  _modelOptions: any,
  onProgress: AbcProgressCallback,
  signal?: AbortSignal,
  transitionText?: string
): Promise<string> {
  try {
    const model = await createModel({ temperature: 0.3, agentName: modelAgentName("abcDescription") });

    const prompt = renderPrompt("data-query.abc-description.user", {
      originalQuestion,
      subgraphDesc,
    });

    onProgress({
      type: "abc_analysis_start",
      subQuestion,
    });

    const transition = transitionText || makeAnalysisTransition(subQuestion);
    let fullContent = transition + "\n\n";

    onProgress({
      type: "abc_analysis_chunk",
      subQuestion,
      content: transition,
    });

    const stream = await model.stream(prompt, { signal });

    for await (const chunk of stream) {
      const text = chunk.content;
      if (typeof text === "string") {
        fullContent += text;
        onProgress({
          type: "abc_analysis_chunk",
          subQuestion,
          content: fullContent,
        });
      }
    }

    onProgress({
      type: "abc_analysis_done",
      subQuestion,
    });

    return fullContent;
  } catch (error) {
    logger.error("[ABC Description] Error:", error);
    return transitionText ? `${transitionText}\n\n` : makeAnalysisTransition(subQuestion);
  }
}
