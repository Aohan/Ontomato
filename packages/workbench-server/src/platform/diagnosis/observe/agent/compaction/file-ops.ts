/**
 * File-operation extraction for compaction summaries.
 *
 * Ported from PI's `harness/compaction/utils.ts`, adapted to data-agent's
 * three message roles. The diagnosis agent's read/write/edit builtin tools all
 * take `args.path`, exactly like PI's, so the extraction logic is unchanged.
 */

import type { AgentMessage } from "../../../../../core/agent-loop/types";

/* ================================================================== */
/*  File operations                                                    */
/* ================================================================== */

/** File paths touched within a compaction range. Mirrors PI's FileOperations. */
export interface FileOperations {
  /** Files read but not necessarily modified. */
  read: Set<string>;
  /** Files written by full-file write operations. */
  written: Set<string>;
  /** Files modified by edit operations. */
  edited: Set<string>;
}

/** Create an empty file-operation accumulator. */
export function createFileOps(): FileOperations {
  return { read: new Set(), written: new Set(), edited: new Set() };
}

/**
 * Add file operations from an assistant message's tool calls to an accumulator.
 * Recognizes the `read` / `write` / `edit` tools (all keyed by `args.path`).
 * Mirrors PI's extractFileOpsFromMessage.
 */
export function extractFileOpsFromMessage(message: AgentMessage, fileOps: FileOperations): void {
  if (message.role !== "assistant") return;

  for (const block of message.content) {
    if (block.type !== "toolCall") continue;
    const args = block.arguments;
    if (!args) continue;
    const path = typeof args.path === "string" ? args.path : undefined;
    if (!path) continue;

    switch (block.name) {
      case "read":
        fileOps.read.add(path);
        break;
      case "write":
        fileOps.written.add(path);
        break;
      case "edit":
        fileOps.edited.add(path);
        break;
    }
  }
}

/**
 * Compute sorted read-only and modified file lists. A file that was written or
 * edited is "modified"; reads of modified files are dropped. Mirrors PI's
 * computeFileLists.
 */
export function computeFileLists(fileOps: FileOperations): {
  readFiles: string[];
  modifiedFiles: string[];
} {
  const modified = new Set([...fileOps.edited, ...fileOps.written]);
  const readFiles = [...fileOps.read].filter((f) => !modified.has(f)).sort();
  const modifiedFiles = [...modified].sort();
  return { readFiles, modifiedFiles };
}

/**
 * Format file lists as the `<read-files>` / `<modified-files>` summary tags
 * appended to a compaction summary. Returns "" when both lists are empty.
 * Mirrors PI's formatFileOperations.
 */
export function formatFileOperations(readFiles: string[], modifiedFiles: string[]): string {
  const sections: string[] = [];
  if (readFiles.length > 0) {
    sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
  }
  if (modifiedFiles.length > 0) {
    sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
  }
  if (sections.length === 0) return "";
  return `\n\n${sections.join("\n\n")}`;
}
