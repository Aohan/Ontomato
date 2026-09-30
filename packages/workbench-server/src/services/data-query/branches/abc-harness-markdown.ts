import { getConclusionPrefix, tForLocale } from "../../../i18n";

export const DATA_TABLE_PLACEHOLDER = "<!-- DATA_TABLES -->";

export type HarnessLabels = {
  process: string;
  data: string;
  conclusion: string;
  scope: string;
};

export function getHarnessLabels(locale?: string): HarnessLabels {
  const conclusion = getConclusionPrefix(locale)
    .trim()
    .replace(/[:：]$/, "")
    .trim();
  return {
    process: tForLocale(locale, "query.harness.processHeading"),
    data: tForLocale(locale, "query.harness.dataHeading"),
    conclusion,
    scope: tForLocale(locale, "query.harness.scopeHeading"),
  };
}
export function joinMarkdownSections(sections: string[]): string {
  return sections
    .map((section) => section.trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
}

export function formatHarnessProcessSection(messages: string[], labels: HarnessLabels): string {
  const content = joinMarkdownSections(messages);
  if (!content) return "";
  return `## ${labels.process}\n\n${content}`;
}

export function formatDataResultSection(messages: string[], labels: HarnessLabels): string {
  const content = joinMarkdownSections(messages);
  if (!content) return "";
  return `## ${labels.data}\n\n${content}`;
}

export function stripThinkingTags(text: string): string {
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
}
export function getContentBeforeDataPlaceholder(content: string): string {
  const normalized = stripThinkingTags(content);
  const markerIndex = normalized.indexOf(DATA_TABLE_PLACEHOLDER);
  return markerIndex >= 0 ? normalized.slice(0, markerIndex).trim() : "";
}

export function insertDisplayDataResults(
  content: string,
  dataMessages: string[],
  labels: HarnessLabels
): string {
  const normalized = stripThinkingTags(content);
  const dataResultSection = formatDataResultSection(dataMessages, labels);
  const replacement = dataResultSection ? `${dataResultSection}\n\n---` : "";
  return normalized.replace(DATA_TABLE_PLACEHOLDER, replacement).trim();
}
