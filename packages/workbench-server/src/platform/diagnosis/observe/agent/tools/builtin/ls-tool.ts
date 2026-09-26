import fs from "node:fs";
import path from "node:path";
import type { AgentTool } from "../../../../../../core/agent-loop/index";
import { runtimeRoot } from "../../../../../../content/layout";
import { tApp } from "../../../../../../i18n";


const DEFAULT_LIMIT = 500;

export function createLsTool(): AgentTool {
  return {
  name: "ls",
  description:
    tApp("diag.observe.agent.tools.builtin.ls-tool.0"),
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: tApp("diag.observe.agent.tools.builtin.ls-tool.1"),
      },
      long: {
        type: "boolean",
        description: tApp("diag.observe.agent.tools.builtin.ls-tool.2"),
      },
      limit: {
        type: "number",
        description: tApp("diag.observe.agent.tools.builtin.ls-tool.3"),
      },
    },
  },
  async execute(_toolCallId, params) {
    try {
      const dirPath = params.path as string | undefined;
      const longMode = params.long as boolean | undefined;
      const limit = params.limit as number | undefined;

      const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);

      const absolutePath = dirPath
        ? path.isAbsolute(dirPath)
          ? dirPath
          : path.resolve(runtimeRoot(), dirPath)
        : runtimeRoot();

      // Check path exists
      if (!fs.existsSync(absolutePath)) {
        return {
          content: [{ type: "text", text: tApp("diag.tool.pathMissing", { p0: absolutePath }) }],
        };
      }

      const stat = fs.statSync(absolutePath);
      if (!stat.isDirectory()) {
        return {
          content: [{ type: "text", text: tApp("diag.tool.pathNotDirectory", { p0: absolutePath }) }],
        };
      }

      // Read entries
      let entries: string[];
      try {
        entries = fs.readdirSync(absolutePath);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text", text: tApp("diag.observe.agent.tools.builtin.ls-tool.4", { p0: msg }) }],
        };
      }

      // Sort alphabetically, case-insensitive
      entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

      if (entries.length === 0) {
        return {
          content: [{ type: "text", text: tApp("diag.observe.agent.tools.builtin.ls-tool.5") }],
        };
      }

      // Format entries
      const lines: string[] = [];
      let entryLimitReached = false;

      for (const entry of entries) {
        if (lines.length >= effectiveLimit) {
          entryLimitReached = true;
          break;
        }

        const fullPath = path.join(absolutePath, entry);
        let entryStat: fs.Stats;
        try {
          entryStat = fs.statSync(fullPath);
        } catch {
          // Skip entries we can't stat
          continue;
        }

        const isDir = entryStat.isDirectory();
        const suffix = isDir ? "/" : "";

        if (longMode) {
          const size = isDir ? "-" : formatSize(entryStat.size);
          const mtime = formatDate(entryStat.mtime);
          lines.push(`${mtime}  ${size.padStart(8)}  ${entry}${suffix}`);
        } else {
          lines.push(`${entry}${suffix}`);
        }
      }

      let output = lines.join("\n");

      // Add notice
      if (entryLimitReached) {
        output += tApp("diag.observe.agent.tools.builtin.ls-tool.6", { p0: effectiveLimit, p1: effectiveLimit * 2 });
      }

      return {
        content: [{ type: "text", text: output }],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: tApp("diag.observe.agent.tools.builtin.ls-tool.7", { p0: msg }) }],
      };
    }
  },
};
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}`;
}
