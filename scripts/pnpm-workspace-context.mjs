// pnpm workspace build context shared by the workbench and Manager builders.
// Host-side metadata context collector (N4a): copies only package and
// workspace/lock metadata from explicit Git source roots into a new exclusive
// destination. It does not resolve workspace members, parse workspace YAML,
// run pnpm, or write runtime compatibility metadata. copyWorkspace then adds
// the owners' Git-visible sources next to the captured metadata.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { canonical, output } from "./build-support.mjs";

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

// Build inputs only, at any depth: never the store, history, outputs, tests
// or secrets. Mirrors the N4a forbidden set plus the test/env exclusions the
// app stage allows.
const WORKSPACE_EXCLUDE = new Set([
  "node_modules",
  ".git",
  ".build",
  "dist",
  "target",
  "coverage",
  "__tests__",
]);
// Only N4a-visible files enter the workspace copy: git tracked plus new
// unignored files, further limited to the build's actual inputs (root
// metadata, apps and packages). Ignored build outputs, local configs and
// out-of-source docs never enter the context; resource markdown under the
// package resource dirs is kept. No second packlist: git is the authority.
const WORKSPACE_ROOT_FILES = new Set(["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"]);
const RESOURCE_DIRS = new Set(["prompts", "skills", "data", "resources"]);

function workspaceAllowed(path) {
  const parts = path.split("/");
  if (parts.length === 1) return WORKSPACE_ROOT_FILES.has(path);
  if (parts[0] !== "apps" && parts[0] !== "packages") return false;
  if (parts.some((part) => WORKSPACE_EXCLUDE.has(part))) return false;
  const base = parts.at(-1);
  if (base === ".env" || base === ".npmrc" || base.startsWith(".env.")) return false;
  return !(base.endsWith(".md") && !parts.some((part) => RESOURCE_DIRS.has(part)));
}

// A Manager build names its owners per source id; the workbench passes none
// and keeps every JS owner of the record. A named owner must be a package of
// that source in the record, so a wrong or missing name fails instead of
// shipping a context without that package's sources.
function selectOwners(id, owned, owners) {
  if (owners === undefined) return owned;
  const named = owners[id];
  if (named === undefined) throw new Error(`no source owners named for ${id}`);
  for (const dir of named)
    if (!owned.has(dir)) throw new Error(`source ${id} has no package ${dir}`);
  return new Set(named);
}

export function copyWorkspace(app, context, record, owners) {
  const listed = new Map(record.sources.map((source) => [source.id, source]));
  for (const source of app.sources) {
    const entry = listed.get(source.id);
    if (!entry) throw new Error(`collector record has no source: ${source.id}`);
    // All metadata comes from the collector's captured bytes, never a
    // second live read: a manifest or lock edited after collection must not
    // silently change this build's inputs. N4a owns that listing.
    const captured = new Set(entry.candidates.map((candidate) => candidate.path));
    for (const rel of captured) {
      if (!workspaceAllowed(rel)) continue;
      const from = join(context, "sources", source.id, rel);
      if (!existsSync(from)) throw new Error(`collector metadata is missing: ${source.id}/${rel}`);
      const dest = join(context, "workspace", source.id, rel);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(from, dest);
    }
    // Scope follows the record: only directories that own a non-root
    // package.json manifest in the captured listing. A Java tree (pom
    // without package.json) never appears there, so it never enters.
    const owned = new Set();
    for (const candidate of entry.candidates) {
      if (WORKSPACE_ROOT_FILES.has(candidate.path)) continue;
      if (!candidate.path.endsWith("/package.json")) continue;
      owned.add(candidate.path.slice(0, -"/package.json".length));
    }
    const selected = selectOwners(source.id, owned, owners);
    const files = output("git", [
      "-C",
      source.root,
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ])
      .split("\0")
      .filter((path) => path !== "");
    for (const rel of files) {
      if (!workspaceAllowed(rel)) continue;
      // Metadata already came from the captured bytes above; a live
      // second read here would silently overwrite it.
      if (captured.has(rel)) continue;
      if (![...selected].some((dir) => rel.startsWith(`${dir}/`)))
        continue;
      const dest = join(context, "workspace", source.id, rel);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(join(source.root, rel), dest);
    }
  }
}
