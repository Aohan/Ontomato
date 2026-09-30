import fs from "node:fs";
import path from "node:path";
import type { AgentTool } from "../../../../../../core/agent-loop/index";
import { runtimeRoot } from "../../../../../../content/layout";
import { tApp } from "../../../../../../i18n";


const MAX_LINES = 2000;
const MAX_BYTES = 256 * 1024;

function isBinaryBuffer(buffer: Buffer): boolean {
  // Check the first 8KB for null bytes (common binary indicator)
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export function createReadTool(): AgentTool {
  return {
  name: "read",
  description:
    tApp("diag.observe.agent.tools.builtin.read-tool.0"),
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: tApp("diag.observe.agent.tools.builtin.read-tool.1"),
      },
      offset: {
        type: "number",
        description: tApp("diag.observe.agent.tools.builtin.read-tool.2"),
      },
      limit: {
        type: "number",
        description: tApp("diag.observe.agent.tools.builtin.read-tool.3"),
      },
    },
    required: ["path"],
  },
  async execute(_toolCallId, params) {
    try {
      const filePath = params.path as string;
      const offset = params.offset as number | undefined;
      const limit = params.limit as number | undefined;

      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(runtimeRoot(), filePath);

      // Check file exists
      if (!fs.existsSync(absolutePath)) {
        return {
          content: [{ type: "text", text: tApp("diag.tool.fileMissing", { p0: filePath }) }],
        };
      }

      const stat = fs.statSync(absolutePath);
      if (stat.isDirectory()) {
        return {
          content: [
            { type: "text", text: tApp("diag.observe.agent.tools.builtin.read-tool.4", { p0: filePath }) },
          ],
        };
      }

      // Read file
      const buffer = fs.readFileSync(absolutePath);

      // Binary check
      if (isBinaryBuffer(buffer)) {
        const size = stat.size;
        return {
          content: [
            {
              type: "text",
              text: tApp("diag.observe.agent.tools.builtin.read-tool.5", { p0: formatSize(size), p1: filePath }),
            },
          ],
        };
      }

      const textContent = buffer.toString("utf-8");
      const allLines = textContent.split("\n");
      const totalLines = allLines.length;

      // Apply offset (1-indexed)
      const startLine = offset ? Math.max(0, offset - 1) : 0;
      const startLineDisplay = startLine + 1;

      if (startLine >= totalLines) {
        return {
          content: [
            {
              type: "text",
              text: tApp("diag.observe.agent.tools.builtin.read-tool.6", { p0: offset, p1: totalLines }),
            },
          ],
        };
      }

      // Apply limit
      let selectedLines: string[];
      let userLimited = false;
      if (limit !== undefined) {
        const endLine = Math.min(startLine + limit, totalLines);
        selectedLines = allLines.slice(startLine, endLine);
        userLimited = endLine < totalLines;
      } else {
        selectedLines = allLines.slice(startLine);
      }

      // Apply truncation limits
      let truncated = false;
      let truncationReason = "";
      if (selectedLines.length > MAX_LINES) {
        selectedLines = selectedLines.slice(0, MAX_LINES);
        truncated = true;
        truncationReason = tApp("diag.observe.agent.tools.builtin.read-tool.7", { p0: MAX_LINES });
      }

      // Check byte limit
      let outputText = selectedLines
        .map((line, i) => `${startLineDisplay + i}\t${line}`)
        .join("\n");

      const byteLength = Buffer.byteLength(outputText, "utf-8");
      if (byteLength > MAX_BYTES) {
        // Trim line by line until under limit
        while (
          selectedLines.length > 1 &&
          Buffer.byteLength(
            selectedLines.map((line, i) => `${startLineDisplay + i}\t${line}`).join("\n"),
            "utf-8"
          ) > MAX_BYTES
        ) {
          selectedLines.pop();
        }
        outputText = selectedLines.map((line, i) => `${startLineDisplay + i}\t${line}`).join("\n");
        truncated = true;
        truncationReason = tApp("diag.observe.agent.tools.builtin.read-tool.8", { p0: formatSize(MAX_BYTES) });
      }

      const endLineDisplay = startLineDisplay + selectedLines.length - 1;

      // Build footer
      if (truncated) {
        const nextOffset = endLineDisplay + 1;
        outputText += tApp("diag.observe.agent.tools.builtin.read-tool.9", {
          p0: startLineDisplay,
          p1: endLineDisplay,
          p2: totalLines,
          p3: truncationReason,
          p4: nextOffset,
        });
      } else if (userLimited && startLine + (limit ?? 0) < totalLines) {
        const remaining = totalLines - (startLine + (limit ?? 0));
        const nextOffset = endLineDisplay + 1;
        outputText += tApp("diag.observe.agent.tools.builtin.read-tool.10", { p0: remaining, p1: nextOffset });
      }

      return {
        content: [{ type: "text", text: outputText }],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: tApp("diag.observe.agent.tools.builtin.read-tool.11", { p0: msg }) }],
      };
    }
  },
};
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
