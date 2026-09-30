import { tApp } from "../../i18n";
import type { QcState } from "@ontomato/contracts/query-thinking";
export function buildQcMarkdown(state: QcState): string {
  let content = "";

  for (const step of state.steps) {
    if (step.summary && step.meaning) {
      content += `<details><summary>${step.summary}</summary>\n\n${step.meaning}\n</details>\n\n`;
    } else if (step.summary) {
      content += `${step.summary}\n\n`;
    } else if (step.meaning) {
      content += tApp("queryFixed.264", { v0: (step.meaning) });
    }
  }

  const result = state.result;
  if (result && (result.conclusion || result.score !== undefined || result.fittedQuestion)) {
    content += "---\n\n";
    if (result.conclusion) {
      content += `${result.conclusion}\n\n`;
    }
    if (result.score !== undefined) {
      content += tApp("queryFixed.265", { v0: (result.score) });
    }
    if (result.fittedQuestion) {
      content += tApp("queryFixed.266", { v0: (result.fittedQuestion) });
    }
  }

  return content;
}
