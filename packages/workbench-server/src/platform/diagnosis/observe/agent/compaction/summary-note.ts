import type { AgentMessage } from "../../../../../core/agent-loop/types";
import {
  computeFileLists,
  createFileOps,
  extractFileOpsFromMessage,
  formatFileOperations,
} from "./file-ops";

const READ_TAG = /<read-files>\n([\s\S]*?)\n<\/read-files>/g;
const MODIFIED_TAG = /<modified-files>\n([\s\S]*?)\n<\/modified-files>/g;

function absorb(pattern: RegExp, text: string, into: Set<string>): void {
  for (const match of text.matchAll(pattern)) {
    for (const line of match[1].split("\n")) {
      if (line) into.add(line);
    }
  }
}

/** Diagnosis file paths appended to a compaction summary. The loop does not know these tools. */
export function diagnosisSummaryNote(messages: AgentMessage[], previousSummary?: string): string {
  const fileOps = createFileOps();
  if (previousSummary) {
    absorb(READ_TAG, previousSummary, fileOps.read);
    absorb(MODIFIED_TAG, previousSummary, fileOps.edited);
  }
  for (const message of messages) {
    extractFileOpsFromMessage(message, fileOps);
    if (message.role === "toolResult") continue;
    for (const part of message.content) {
      if (part.type !== "text") continue;
      absorb(READ_TAG, part.text, fileOps.read);
      absorb(MODIFIED_TAG, part.text, fileOps.edited);
    }
  }
  const { readFiles, modifiedFiles } = computeFileLists(fileOps);
  return formatFileOperations(readFiles, modifiedFiles);
}
