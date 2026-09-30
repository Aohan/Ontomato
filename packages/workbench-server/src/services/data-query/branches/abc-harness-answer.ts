import { createModel } from "../../../config/model-factory";
import { modelAgentName } from "../../../logging/model-agents";
import { renderPrompt } from "../../../core/prompts/loader";
import { applyFieldDisplayPlan, type Dataset } from "../adapter";
import { tForLocale, tApp } from "../../../i18n";
import { buildModelDataView } from "../../../utils/model-data-view";
import { logger } from "./abc-harness-diagnostics";
import {
  DATA_TABLE_PLACEHOLDER,
  getContentBeforeDataPlaceholder,
  insertDisplayDataResults,
  stripThinkingTags,
  type HarnessLabels,
} from "./abc-harness-markdown";
import { chunkText, pushStableContent } from "./abc-harness-stream";

function buildHarnessDataEvidence(datasets: Dataset[], locale?: string): string {
  return datasets
    .map((dataset, index) => {
      const displayRows = dataset.fieldDisplayPlan
        ? applyFieldDisplayPlan(dataset.data, dataset.fieldDisplayPlan, locale)
        : dataset.data;
      const dataView = buildModelDataView(displayRows);
      const name =
        dataset.name || tForLocale(locale, "query.datasetFallbackTitle", { index: index + 1 });

      return [
        `datasetName=${JSON.stringify(name)}`,
        `fieldDisplayPlan=${JSON.stringify(dataset.fieldDisplayPlan || {})}`,
        `dataView=${JSON.stringify(dataView)}`,
      ].join("\n");
    })
    .join("\n\n");
}
export async function polishHarnessAnswer(params: {
  originalQuestion: string;
  fallbackContent: string;
  harnessProcess: string;
  datasets: Dataset[];
  displayDataMessages: string[];
  pushContent: (content: string, loading: boolean) => void;
  signal?: AbortSignal;
  locale?: string;
  labels: HarnessLabels;
}): Promise<string> {
  const {
    originalQuestion,
    fallbackContent,
    harnessProcess,
    datasets,
    displayDataMessages,
    pushContent,
    signal,
    locale,
    labels,
  } = params;
  if (!fallbackContent.trim()) return fallbackContent;

  const prompt = renderPrompt(
    "data-query.abc-harness-answer.user",
    {
      originalQuestion,
      harnessProcess: harnessProcess || tForLocale(locale, "query.nodeTable.none"),
      dataEvidence: buildHarnessDataEvidence(datasets, locale),
      conclusionHeading: `## ${labels.conclusion}`,
      scopeHeading: `## ${labels.scope}`,
      processHeading: `## ${labels.process}`,
      dataPlaceholder: DATA_TABLE_PLACEHOLDER,
    },
    locale
  );

  try {
    const model = await createModel({ temperature: 0.2, agentName: modelAgentName("abcHarnessAnswer") });
    const stream = await model.stream([{ role: "user", content: prompt }], { signal });
    let polished = "";
    let lastPushedStablePrefix = "";

    for await (const chunk of stream) {
      const text = chunkText(chunk.content);
      if (!text) continue;
      polished += text;
      const stablePrefix = getContentBeforeDataPlaceholder(polished);
      if (stablePrefix && stablePrefix !== lastPushedStablePrefix) {
        lastPushedStablePrefix = stablePrefix;
        pushContent(stablePrefix, true);
      }
    }

    polished = stripThinkingTags(polished);
    if (!polished) {
      pushStableContent(fallbackContent, pushContent);
      return fallbackContent;
    }
    const finalContent = insertDisplayDataResults(polished, displayDataMessages, labels);
    pushContent(finalContent, false);
    return finalContent;
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && (error.name === "AbortError" || /abort/i.test(error.message)))
    ) {
      throw error;
    }
    logger.warn(tApp("queryFixed.202"), {
      error: error instanceof Error ? error.message : String(error),
    });
    pushStableContent(fallbackContent, pushContent);
    return fallbackContent;
  }
}
