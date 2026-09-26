import fs from "node:fs";
import path from "node:path";
import type { AgentTool } from "../../../../../../core/agent-loop/index";
import { runtimeRoot } from "../../../../../../content/layout";
import { tApp } from "../../../../../../i18n";


const DEFAULT_LIMIT = 100;
const MAX_LINE_LENGTH = 500;
const MAX_OUTPUT_BYTES = 256 * 1024;

export function createGrepTool(): AgentTool {
  return {
  name: "grep",
  description:
    tApp("diag.observe.agent.tools.builtin.grep-tool.0"),
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: tApp("diag.observe.agent.tools.builtin.grep-tool.1"),
      },
      path: {
        type: "string",
        description: tApp("diag.observe.agent.tools.builtin.grep-tool.2"),
      },
      glob: {
        type: "string",
        description: tApp("diag.observe.agent.tools.builtin.grep-tool.3"),
      },
      ignoreCase: {
        type: "boolean",
        description: tApp("diag.observe.agent.tools.builtin.grep-tool.4"),
      },
      context: {
        type: "number",
        description: tApp("diag.observe.agent.tools.builtin.grep-tool.5"),
      },
      limit: {
        type: "number",
        description: tApp("diag.observe.agent.tools.builtin.grep-tool.6"),
      },
    },
    required: ["pattern"],
  },
  async execute(_toolCallId, params) {
    try {
      const pattern = params.pattern as string;
      const searchPath = params.path as string | undefined;
      const globPattern = params.glob as string | undefined;
      const ignoreCase = params.ignoreCase as boolean | undefined;
      const contextLines = params.context as number | undefined;
      const limit = params.limit as number | undefined;

      const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);
      const ctxLines = contextLines && contextLines > 0 ? contextLines : 0;

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

      // Build regex
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, ignoreCase ? "i" : "");
      } catch {
        return {
          content: [{ type: "text", text: tApp("diag.observe.agent.tools.builtin.grep-tool.7", { p0: pattern }) }],
        };
      }

      const stat = fs.statSync(basePath);
      const files: string[] = [];

      if (stat.isFile()) {
        files.push(basePath);
      } else if (stat.isDirectory()) {
        collectFiles(basePath, files, globPattern, 0);
      }

      // Search files
      const outputLines: string[] = [];
      let matchCount = 0;
      let linesTruncated = false;

      for (const filePath of files) {
        if (matchCount >= effectiveLimit) break;

        let content: string;
        try {
          const buffer = fs.readFileSync(filePath);
          // Skip binary files
          if (isBinaryBuffer(buffer)) continue;
          content = buffer.toString("utf-8");
        } catch {
          continue;
        }

        const fileLines = content.split("\n");
        const relativePath =
          path.relative(basePath, filePath).replace(/\\/g, "/") || path.basename(filePath);

        for (let i = 0; i < fileLines.length; i++) {
          if (matchCount >= effectiveLimit) break;

          if (regex.test(fileLines[i])) {
            matchCount++;

            if (ctxLines > 0) {
              // Show context lines
              const start = Math.max(0, i - ctxLines);
              const end = Math.min(fileLines.length - 1, i + ctxLines);
              for (let j = start; j <= end; j++) {
                const line = truncateLine(fileLines[j]);
                if (line.truncated) linesTruncated = true;
                if (j === i) {
                  outputLines.push(`${relativePath}:${j + 1}: ${line.text}`);
                } else {
                  outputLines.push(`${relativePath}-${j + 1}- ${line.text}`);
                }
              }
              if (end < fileLines.length - 1) {
                outputLines.push("--");
              }
            } else {
              const line = truncateLine(fileLines[i]);
              if (line.truncated) linesTruncated = true;
              outputLines.push(`${relativePath}:${i + 1}: ${line.text}`);
            }
          }
        }
      }

      if (matchCount === 0) {
        return {
          content: [{ type: "text", text: tApp("diag.observe.agent.tools.builtin.grep-tool.8") }],
        };
      }

      let output = outputLines.join("\n");

      // Truncate by bytes if needed
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
      if (matchCount >= effectiveLimit) {
        notices.push(
          tApp("diag.observe.agent.tools.builtin.grep-tool.9", { p0: effectiveLimit, p1: effectiveLimit * 2 })
        );
      }
      if (linesTruncated) {
        notices.push(tApp("diag.observe.agent.tools.builtin.grep-tool.10", { p0: MAX_LINE_LENGTH }));
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
        content: [{ type: "text", text: tApp("diag.observe.agent.tools.builtin.grep-tool.11", { p0: msg }) }],
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

const MAX_DEPTH = 10;

function collectFiles(
  dir: string,
  results: string[],
  globPattern: string | undefined,
  depth: number
): void {
  if (depth > MAX_DEPTH) return;
  if (results.length > 10000) return; // Safety limit

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith(".") && SKIP_DIRS.has(entry)) continue;
    if (SKIP_DIRS.has(entry)) continue;

    const fullPath = path.join(dir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      collectFiles(fullPath, results, globPattern, depth + 1);
    } else if (stat.isFile()) {
      if (globPattern && !matchGlob(entry, globPattern)) continue;
      results.push(fullPath);
    }
  }
}

/**
 * Simple glob matching for file names.
 * Supports *.ext and **\/*.ext patterns (matches against filename only).
 */
function matchGlob(fileName: string, pattern: string): boolean {
  // Extract the file extension pattern
  // Handle patterns like "*.ts", "*.{ts,tsx}", "**/*.ts"
  const simplePattern = pattern.replace(/^\*\*\//, "");

  // Handle {a,b} alternation
  if (simplePattern.includes("{") && simplePattern.includes("}")) {
    const match = simplePattern.match(/^(.*)?\{([^}]+)\}(.*)$/);
    if (match) {
      const [, prefix = "", alts, suffix = ""] = match;
      return alts.split(",").some((alt) => matchGlob(fileName, `${prefix}${alt.trim()}${suffix}`));
    }
  }

  // Convert glob to regex
  const regexStr = simplePattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".");

  try {
    return new RegExp(`^${regexStr}$`, "i").test(fileName);
  } catch {
    return false;
  }
}

function truncateLine(line: string): { text: string; truncated: boolean } {
  if (line.length <= MAX_LINE_LENGTH) {
    return { text: line, truncated: false };
  }
  return {
    text: line.slice(0, MAX_LINE_LENGTH) + "...",
    truncated: true,
  };
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}
