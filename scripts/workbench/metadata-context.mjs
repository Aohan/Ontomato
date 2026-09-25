// Host-side metadata context collector for the workbench runtime build (N4a).
// Copies only package and workspace/lock metadata from explicit Git source roots
// into a new exclusive destination. It does not resolve workspace members, parse
// workspace YAML, run pnpm, or write runtime compatibility metadata.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { canonical } from "../build-support.mjs";

const ROOT_METADATA = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"];
// Build and dependency directories, matching both product repositories' .gitignore.
const FORBIDDEN = new Set(["node_modules", ".git", ".build", "dist", "target", "coverage"]);

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function isCandidate(path) {
  if (path.split("/").slice(0, -1).some((part) => FORBIDDEN.has(part))) return false;
  return ROOT_METADATA.includes(path) || path.endsWith("/package.json");
}

// Read through the real path so a metadata symlink cannot leave the source root.
function readInside(root, path) {
  const real = realpathSync(join(root, path));
  const outside = relative(root, real);
  if (outside.startsWith("..") || isAbsolute(outside))
    throw new Error(`metadata path escapes its source root: ${path}`);
  return readFileSync(real);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sourceMetadata(root) {
  const listed = git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  const contents = new Map();
  const candidates = listed
    .split("\0")
    .filter(isCandidate)
    .sort()
    .map((path) => {
      const bytes = readInside(root, path);
      contents.set(path, bytes);
      return { path, sha256: sha256(bytes) };
    });
  return {
    facts: {
      head: git(root, ["rev-parse", "HEAD"]).trim(),
      worktreeDirty: git(root, ["status", "--porcelain", "-z"]).length > 0,
      candidates,
    },
    contents,
  };
}

function resolveSourceRoot(root) {
  const real = realpathSync(root);
  const top = realpathSync(git(real, ["rev-parse", "--show-toplevel"]).trim());
  if (top !== real) throw new Error(`source root must be a Git work tree root: ${root}`);
  return real;
}

function assertSourceId(id) {
  if (typeof id !== "string" || id === "" || id === "." || id === ".." || /[/\\]/.test(id))
    throw new Error(`source id must be a single safe directory name: ${id}`);
}

function readSources(sources, workspaceId) {
  if (!Array.isArray(sources) || sources.length === 0)
    throw new Error("sources must be a non-empty array");
  const ids = new Set();
  const resolved = sources.map((source) => {
    assertSourceId(source.id);
    if (ids.has(source.id)) throw new Error(`duplicate source id: ${source.id}`);
    ids.add(source.id);
    return { id: source.id, root: resolveSourceRoot(source.root) };
  });
  if (!ids.has(workspaceId)) throw new Error(`unknown workspace source: ${workspaceId}`);
  return resolved;
}

function assertRootMetadata(id, candidates) {
  const paths = new Set(candidates.map((candidate) => candidate.path));
  for (const path of ROOT_METADATA)
    if (!paths.has(path)) throw new Error(`source ${id} is missing root metadata ${path}`);
}

function prepareDestination(destination) {
  if (existsSync(destination)) {
    if (!statSync(destination).isDirectory())
      throw new Error(`destination is not a directory: ${destination}`);
    if (readdirSync(destination).length > 0)
      throw new Error(`destination must be empty: ${destination}`);
  } else {
    mkdirSync(destination, { recursive: true });
  }
}

export function collectMetadataContext({ sources, workspaceId, appImporter, destination }) {
  if (typeof appImporter !== "string" || appImporter === "")
    throw new Error("appImporter must be a workspace-relative path");
  if (typeof destination !== "string" || destination === "")
    throw new Error("destination must be a path");
  const resolved = readSources(sources, workspaceId);
  prepareDestination(destination);

  const collected = resolved.map((source) => ({ source, ...sourceMetadata(source.root) }));
  for (const entry of collected) assertRootMetadata(entry.source.id, entry.facts.candidates);

  const workspace = collected.find((entry) => entry.source.id === workspaceId);
  const manifest = workspace.contents.get(`${appImporter}/package.json`);
  if (manifest === undefined)
    throw new Error(`workspace source ${workspaceId} has no ${appImporter}/package.json`);
  const application = JSON.parse(manifest).name;
  if (typeof application !== "string" || application === "")
    throw new Error(`${appImporter}/package.json has no package name`);

  for (const entry of collected) {
    for (const [path, bytes] of entry.contents) {
      const target = join(destination, "sources", entry.source.id, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
  }

  for (const entry of collected) {
    const after = sourceMetadata(entry.source.root).facts;
    if (canonical(after) !== canonical(entry.facts))
      throw new Error(`source ${entry.source.id} changed while collecting metadata`);
  }

  const record = {
    workspaceId,
    appImporter,
    application,
    sources: collected.map((entry) => ({
      id: entry.source.id,
      head: entry.facts.head,
      worktreeDirty: entry.facts.worktreeDirty,
      candidates: entry.facts.candidates,
    })),
  };
  writeFileSync(join(destination, "inputs.json"), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}
