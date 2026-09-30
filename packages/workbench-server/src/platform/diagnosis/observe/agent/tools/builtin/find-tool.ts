import fs from "node:fs";
import path from "node:path";
import type { AgentTool } from "../../../../../../core/agent-loop/index";
import { runtimeRoot } from "../../../../../../content/layout";
import { tApp } from "../../../../../../i18n";


const DEFAULT_LIMIT = 1000;
const MAX_OUTPUT_BYTES = 256 * 1024;

export function createFindTool(): AgentTool {
  return {
  name: "find",
  description:
    tApp("diag.observe.agent.tools.builtin.find-tool.0"),
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: tApp("diag.observe.agent.tools.builtin.find-tool.1"),
      },
      path: {
        type: "string",
        description: tApp("diag.observe.agent.tools.builtin.find-tool.2"),
      },
      type: {
        type: "string",
        enum: ["file", "dir"],
        description: tApp("diag.observe.agent.tools.builtin.find-tool.3"),
      },
      maxDepth: {
        type: "number",
        description: tApp("diag.observe.agent.tools.builtin.find-tool.4"),
      },
      limit: {
        type: "number",
        description: tApp("diag.observe.agent.tools.builtin.find-tool.5"),
      },
    },
    required: ["pattern"],
  },
  async execute(_toolCallId, params) {
    try {
      const pattern = params.pattern as string;
      const searchPath = params.path as string | undefined;
      const typeFilter = params.type as "file" | "dir" | undefined;
      const maxDepth = params.maxDepth as number | undefined;
      const limit = params.limit as number | undefined;

      const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);

      const basePath = searchPath
        ? path.isAbsolute(searchPath)
          ? searchPath
          : path.resolve(runtimeRoot(), searchPath)
        : runtimeRoot();

      // Check path exists
      if (!fs.existsSync(basePath)) {
        return {
          content: [{ type: "text", text: tApp("diag.tool.pathMissing", { p0: basePath }) }],
        };
      }

      const stat = fs.statSync(basePath);
      if (!stat.isDirectory()) {
        return {
          content: [{ type: "text", text: tApp("diag.tool.pathNotDirectory", { p0: basePath }) }],
        };
      }

      // Collect matching files
      const results: string[] = [];
      const effectiveMaxDepth = maxDepth ?? 20;
      walkDirectory(
        basePath,
        basePath,
        pattern,
        typeFilter,
        effectiveMaxDepth,
        0,
        results,
        effectiveLimit
      );

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: tApp("diag.observe.agent.tools.builtin.find-tool.8") }],
        };
      }

      // Format as relative paths with posix separators
      const relativePaths = results.map((p) => path.relative(basePath, p).replace(/\\/g, "/"));

      let output = relativePaths.join("\n");

      // Truncate by bytes
      if (Buffer.byteLength(output, "utf-8") > MAX_OUTPUT_BYTES) {
        const lines = output.split("\n");
        const trimmedLines: string[] = [];
        let bytes = 0;
        for (const line of lines) {
          const lineBytes = Buffer.byteLength(line + "\n", "utf-8");
          if (bytes + lineBytes > MAX_OUTPUT_BYTES) break;
          trimmedLines.push(line);
          bytes += lineBytes;
        }
        output = trimmedLines.join("\n");
      }

      // Add notices
      const notices: string[] = [];
      if (results.length >= effectiveLimit) {
        notices.push(
          tApp("diag.observe.agent.tools.builtin.find-tool.9", { p0: effectiveLimit, p1: effectiveLimit * 2 })
        );
      }
      if (notices.length > 0) {
        output += `\n\n[${notices.join(tApp("diag.tool.noticeJoin"))}]`;
      }

      return {
        content: [{ type: "text", text: output }],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: tApp("diag.observe.agent.tools.builtin.find-tool.11", { p0: msg }) }],
      };
    }
  },
};
}

// --- Helpers ---

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "__pycache__",
  ".trellis",
  ".reference",
]);

function walkDirectory(
  rootPath: string,
  currentPath: string,
  pattern: string,
  typeFilter: "file" | "dir" | undefined,
  maxDepth: number,
  currentDepth: number,
  results: string[],
  limit: number
): void {
  if (currentDepth > maxDepth) return;
  if (results.length >= limit) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  // Sort entries alphabetically
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (results.length >= limit) return;

    const fullPath = path.join(currentPath, entry.name);
    const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;

      // Check if directory matches pattern
      if (!typeFilter || typeFilter === "dir") {
        if (matchGlobPath(relativePath, entry.name, pattern)) {
          results.push(fullPath);
        }
      }

      // Recurse
      walkDirectory(
        rootPath,
        fullPath,
        pattern,
        typeFilter,
        maxDepth,
        currentDepth + 1,
        results,
        limit
      );
    } else if (entry.isFile()) {
      if (!typeFilter || typeFilter === "file") {
        if (matchGlobPath(relativePath, entry.name, pattern)) {
          results.push(fullPath);
        }
      }
    }
  }
}

/**
 * Match a path or filename against a glob pattern.
 * For patterns containing '/', matches against the relative path.
 * Otherwise, matches against the filename only.
 */
function matchGlobPath(relativePath: string, fileName: string, pattern: string): boolean {
  // If pattern contains path separator, match against full relative path
  if (pattern.includes("/")) {
    return globToRegex(pattern).test(relativePath);
  }
  // Otherwise match filename only
  return globToRegex(pattern).test(fileName);
}

function globToRegex(pattern: string): RegExp {
  // Handle {a,b} alternation
  if (pattern.includes("{") && pattern.includes("}")) {
    const match = pattern.match(/^(.*?)\{([^}]+)\}(.*)$/);
    if (match) {
      const [, prefix = "", alts, suffix = ""] = match;
      const altPatterns = alts.split(",").map((a) => a.trim());
      const altRegex = altPatterns.map((a) => globPartToRegex(`${prefix}${a}${suffix}`)).join("|");
      try {
        return new RegExp(`^(?:${altRegex})$`, "i");
      } catch {
        return /(?!)/; // never match
      }
    }
  }

  try {
    return new RegExp(`^${globPartToRegex(pattern)}$`, "i");
  } catch {
    return /(?!)/;
  }
}

function globPartToRegex(pattern: string): string {
  let result = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      // ** matches any path segments
      if (pattern[i + 2] === "/") {
        result += "(?:.*/)?";
        i += 3;
      } else {
        result += ".*";
        i += 2;
      }
    } else if (c === "*") {
      // * matches any non-separator characters
      result += "[^/]*";
      i++;
    } else if (c === "?") {
      result += "[^/]";
      i++;
    } else if (c === ".") {
      result += "\\.";
      i++;
    } else {
      result += c;
      i++;
    }
  }
  return result;
}
