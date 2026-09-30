import { knowledgeDir } from "../../../../content/layout";
import type { KnowledgeTreeNode, KnowledgeMarkdownFile } from "@ontomato/contracts/diagnosis";
import fs from "node:fs";
import path from "node:path";
import { parseSkillMarkdownFrontmatter } from "../../../../core/skills/manifest";

const LEGACY_ENTRY_DIRS = new Set(["builtin", "custom"]);

export const KNOWLEDGE_INDEX_RELATIVE_PATH = "data/knowledge/index.md";

export class KnowledgePathError extends Error {}
export class KnowledgeNotFoundError extends Error {}

function toKnowledgePath(filePath: string, rootDir: string): string {
  return path.relative(rootDir, filePath).replace(/\\/g, "/");
}

function normalizeInputPath(input?: string): string {
  const normalized = (input || "index.md").replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized || "index.md";
}

function assertInsideRoot(filePath: string, rootDir: string): void {
  const relative = path.relative(rootDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new KnowledgePathError("Path is outside knowledge root");
  }
}

export function resolveKnowledgePath(input?: string, rootDir = knowledgeDir()): string {
  const relativePath = normalizeInputPath(input);
  if (relativePath.includes("\0")) {
    throw new KnowledgePathError("Invalid knowledge path");
  }

  const resolved = path.resolve(rootDir, relativePath);
  assertInsideRoot(resolved, rootDir);
  return resolved;
}

function isMarkdownFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".md");
}

function sortEntries(entries: fs.Dirent[]): fs.Dirent[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

function buildNode(filePath: string, rootDir: string): KnowledgeTreeNode | null {
  const stat = fs.statSync(filePath);
  const name = path.basename(filePath);
  const relativePath = toKnowledgePath(filePath, rootDir);

  if (stat.isDirectory()) {
    const entries = sortEntries(fs.readdirSync(filePath, { withFileTypes: true })).filter(
      (entry) => {
        if (entry.name.startsWith(".")) return false;
        if (relativePath === "" && entry.isDirectory() && LEGACY_ENTRY_DIRS.has(entry.name))
          return false;
        return true;
      }
    );
    const children = entries
      .map((entry) => buildNode(path.join(filePath, entry.name), rootDir))
      .filter((node): node is KnowledgeTreeNode => Boolean(node));
    const indexFile = path.join(filePath, "index.md");
    const hasIndex = fs.existsSync(indexFile);

    if (!hasIndex && children.length === 0 && relativePath !== "") {
      return null;
    }

    return {
      name: relativePath === "" ? "knowledge" : name,
      path: relativePath,
      type: "directory",
      hasIndex,
      ...(hasIndex ? { indexPath: toKnowledgePath(indexFile, rootDir) } : {}),
      children,
    };
  }

  if (!stat.isFile() || !isMarkdownFile(filePath)) return null;

  return {
    name,
    path: relativePath,
    type: "file",
  };
}

export function listKnowledgeTree(rootDir = knowledgeDir()): KnowledgeTreeNode {
  if (!fs.existsSync(rootDir)) {
    return {
      name: "knowledge",
      path: "",
      type: "directory",
      hasIndex: false,
      children: [],
    };
  }

  return (
    buildNode(rootDir, rootDir) || {
      name: "knowledge",
      path: "",
      type: "directory",
      hasIndex: false,
      children: [],
    }
  );
}

function resolveReadableMarkdown(input?: string, rootDir = knowledgeDir()): string {
  const target = resolveKnowledgePath(input, rootDir);
  if (!fs.existsSync(target)) {
    throw new KnowledgeNotFoundError("Knowledge file not found");
  }

  const stat = fs.statSync(target);
  const filePath = stat.isDirectory() ? path.join(target, "index.md") : target;
  assertInsideRoot(filePath, rootDir);

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || !isMarkdownFile(filePath)) {
    throw new KnowledgeNotFoundError("Knowledge markdown file not found");
  }

  return filePath;
}

function extractTitle(content: string, filePath: string): string {
  try {
    const parsed = parseSkillMarkdownFrontmatter(content);
    const frontmatter = parsed?.frontmatter;
    if (
      typeof frontmatter === "object" &&
      frontmatter !== null &&
      "title" in frontmatter &&
      typeof frontmatter.title === "string" &&
      frontmatter.title.trim()
    ) {
      return frontmatter.title.trim();
    }
  } catch {
    // Invalid frontmatter falls through to the existing heading and filename titles.
  }

  const heading = content.match(/^#\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim();

  return path.basename(filePath, path.extname(filePath));
}

export function readKnowledgeMarkdown(
  input?: string,
  rootDir = knowledgeDir()
): KnowledgeMarkdownFile {
  const filePath = resolveReadableMarkdown(input, rootDir);
  const content = fs.readFileSync(filePath, "utf-8");
  const stat = fs.statSync(filePath);

  return {
    path: toKnowledgePath(filePath, rootDir),
    title: extractTitle(content, filePath),
    content,
    updatedAt: stat.mtime.toISOString(),
  };
}
