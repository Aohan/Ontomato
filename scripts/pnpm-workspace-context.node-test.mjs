import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { collectMetadataContext, copyWorkspace } from "./pnpm-workspace-context.mjs";

// Local identity only; the user's Git configuration and real repositories are never touched.
const GIT = ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid"];

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...GIT, ...args], { encoding: "utf8" });
}

function text(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function json(path, value) {
  text(path, `${JSON.stringify(value, null, 2)}\n`);
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function repository(root, name, { lock = true } = {}) {
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  text(join(root, ".gitignore"), "node_modules/\n.build/\n");
  json(join(root, "package.json"), { name, private: true });
  text(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n  - "apps/*"\n');
  if (lock) text(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
}

function commit(root, message) {
  git(root, "add", "-A");
  git(root, "commit", "-qm", message);
}

function pair(dir) {
  const publicRoot = join(dir, "ontomato");
  const privateRoot = join(dir, "enterprise");
  repository(publicRoot, "ontomato");
  json(join(publicRoot, "apps/workbench/package.json"), { name: "@ontomato/workbench" });
  json(join(publicRoot, "packages/core/package.json"), { name: "@ontomato/core" });
  text(join(publicRoot, "src/index.ts"), "export {};\n");
  text(join(publicRoot, ".env"), "SECRET=1\n");
  text(join(publicRoot, ".npmrc"), "strict=true\n");
  json(join(publicRoot, "node_modules/left/package.json"), { name: "left" });
  json(join(publicRoot, ".build/cache/package.json"), { name: "cache" });
  commit(publicRoot, "public fixture");
  git(publicRoot, "add", "-f", "node_modules/left/package.json", ".build/cache/package.json");
  git(publicRoot, "commit", "-qm", "force-tracked dependency and build directories");

  repository(privateRoot, "enterprise");
  json(join(privateRoot, "apps/workbench/package.json"), { name: "@enterprise/workbench" });
  commit(privateRoot, "private fixture");
  return { publicRoot, privateRoot };
}

function workspaceFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "p4-n4a-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, ...pair(dir) };
}

const sourcesOf = ({ publicRoot, privateRoot }) => [
  { id: "ontomato", root: publicRoot },
  { id: "enterprise", root: privateRoot },
];

const collect = (sources, workspaceId, destination) =>
  collectMetadataContext({ sources, workspaceId, appImporter: "apps/workbench", destination });

test("collects only package metadata from two adjacent Git roots", (t) => {
  const fixture = workspaceFixture(t);
  const destination = join(fixture.dir, "context");
  const record = collect(sourcesOf(fixture), "enterprise", destination);

  assert.deepEqual(
    readFileSync(join(destination, "sources/ontomato/package.json")),
    readFileSync(join(fixture.publicRoot, "package.json")),
  );
  assert.equal(existsSync(join(destination, "sources/ontomato/pnpm-workspace.yaml")), true);
  assert.equal(existsSync(join(destination, "sources/ontomato/pnpm-lock.yaml")), true);
  assert.equal(existsSync(join(destination, "sources/ontomato/packages/core/package.json")), true);
  assert.equal(existsSync(join(destination, "sources/enterprise/apps/workbench/package.json")), true);
  for (const absent of ["node_modules", ".build", "src", ".env", ".npmrc"])
    assert.equal(existsSync(join(destination, "sources/ontomato", absent)), false, absent);
  assert.equal(record.workspaceId, "enterprise");
  assert.equal(record.appImporter, "apps/workbench");
  assert.equal(record.application, "@enterprise/workbench");
});

test("records HEAD, dirty state and content hashes for tracked and untracked metadata", (t) => {
  const fixture = workspaceFixture(t);
  json(join(fixture.publicRoot, "apps/new-app/package.json"), { name: "@ontomato/new-app" });
  const destination = join(fixture.dir, "context");
  const record = collect(sourcesOf(fixture), "enterprise", destination);

  const [publicSource, privateSource] = record.sources;
  assert.equal(publicSource.head, git(fixture.publicRoot, "rev-parse", "HEAD").trim());
  assert.equal(privateSource.head, git(fixture.privateRoot, "rev-parse", "HEAD").trim());
  assert.equal(publicSource.worktreeDirty, true);
  assert.equal(privateSource.worktreeDirty, false);
  const paths = publicSource.candidates.map((candidate) => candidate.path);
  assert.deepEqual(paths, [...paths].sort());
  assert.equal(paths.includes("apps/new-app/package.json"), true);
  assert.equal(
    publicSource.candidates.find((candidate) => candidate.path === "pnpm-lock.yaml").sha256,
    digest(join(fixture.publicRoot, "pnpm-lock.yaml")),
  );
  assert.deepEqual(JSON.parse(readFileSync(join(destination, "inputs.json"), "utf8")), record);
  assert.equal(record.application, "@enterprise/workbench");
});

test("copies the current bytes of a modified candidate and reports the worktree dirty", (t) => {
  const fixture = workspaceFixture(t);
  text(join(fixture.privateRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n# edited\n");
  const destination = join(fixture.dir, "context");
  const record = collect(sourcesOf(fixture), "ontomato", destination);

  assert.equal(record.sources[1].worktreeDirty, true);
  assert.equal(record.application, "@ontomato/workbench");
  assert.deepEqual(
    readFileSync(join(destination, "sources/enterprise/pnpm-lock.yaml")),
    readFileSync(join(fixture.privateRoot, "pnpm-lock.yaml")),
  );
});

test("rejects a source root without the three root metadata files", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "p4-n4a-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, "ontomato");
  repository(root, "ontomato", { lock: false });
  commit(root, "fixture without lock");
  assert.throws(
    () => collect([{ id: "ontomato", root }], "ontomato", join(dir, "context")),
    /missing root metadata pnpm-lock\.yaml/,
  );
});

test("rejects an unknown workspace source and a root that is not a Git work tree root", (t) => {
  const fixture = workspaceFixture(t);
  const sources = sourcesOf(fixture);
  assert.throws(
    () => collect(sources, "workbench", join(fixture.dir, "context")),
    /unknown workspace source: workbench/,
  );
  const nested = join(fixture.publicRoot, "apps");
  assert.throws(
    () => collect([{ id: "enterprise", root: nested }], "enterprise", join(fixture.dir, "c2")),
    /must be a Git work tree root/,
  );
});

test("rejects unsafe or duplicate source ids", (t) => {
  const fixture = workspaceFixture(t);
  assert.throws(
    () => collect([{ id: "../escape", root: fixture.publicRoot }], "../escape", join(fixture.dir, "c1")),
    /single safe directory name/,
  );
  assert.throws(
    () =>
      collect(
        [
          { id: "ontomato", root: fixture.publicRoot },
          { id: "ontomato", root: fixture.privateRoot },
        ],
        "ontomato",
        join(fixture.dir, "c2"),
      ),
    /duplicate source id: ontomato/,
  );
});

test("rejects a metadata symlink that leaves the source root", (t) => {
  const fixture = workspaceFixture(t);
  json(join(fixture.dir, "outside-package.json"), { name: "@outside/escape" });
  mkdirSync(join(fixture.publicRoot, "apps/evil"), { recursive: true });
  symlinkSync(join(fixture.dir, "outside-package.json"), join(fixture.publicRoot, "apps/evil/package.json"));
  assert.throws(
    () => collect([{ id: "ontomato", root: fixture.publicRoot }], "ontomato", join(fixture.dir, "context")),
    /escapes its source root/,
  );
});

test("refuses a non-empty destination without touching existing files", (t) => {
  const fixture = workspaceFixture(t);
  const destination = join(fixture.dir, "context");
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, "keep.txt"), "keep\n");
  assert.throws(
    () => collect(sourcesOf(fixture), "enterprise", destination),
    /destination must be empty/,
  );
  assert.deepEqual(readdirSync(destination), ["keep.txt"]);
  assert.equal(readFileSync(join(destination, "keep.txt"), "utf8"), "keep\n");
});

test("fails and keeps outputs when candidates change between the two passes", (t) => {
  const fixture = workspaceFixture(t);
  // Output written inside the source root is one deterministic way candidates change mid-collection.
  const destination = join(fixture.publicRoot, "context-out");
  assert.throws(
    () => collect([{ id: "ontomato", root: fixture.publicRoot }], "ontomato", destination),
    /changed while collecting metadata/,
  );
  assert.equal(existsSync(join(destination, "sources/ontomato/package.json")), true);
  assert.deepEqual(
    readFileSync(join(destination, "sources/ontomato/package.json")),
    readFileSync(join(fixture.publicRoot, "package.json")),
  );
});

// copyWorkspace owner selection (Manager is the second consumer). The two
// sources carry a Manager app/package next to other packages, tests, local
// env files and docs; only Git-visible inputs of the named owners may enter.
function managerPair(t) {
  const fixture = workspaceFixture(t);
  const { publicRoot, privateRoot } = fixture;
  json(join(publicRoot, "apps/ontology-manager/package.json"), { name: "@ontomato/ontology-manager-app" });
  text(join(publicRoot, "apps/ontology-manager/src/main.ts"), "export const app = 1;\n");
  text(join(publicRoot, "apps/ontology-manager/src/__tests__/main.test.ts"), "test;\n");
  text(join(publicRoot, "apps/ontology-manager/.env.local"), "TOKEN=1\n");
  text(join(publicRoot, "apps/ontology-manager/README.md"), "# doc\n");
  json(join(publicRoot, "packages/ontology-manager/package.json"), { name: "@ontomato/ontology-manager" });
  text(join(publicRoot, "packages/ontology-manager/src/index.ts"), "export {};\n");
  text(join(publicRoot, "packages/core/src/core.ts"), "export {};\n");
  text(join(publicRoot, "apps/workbench/src/server.ts"), "export {};\n");
  commit(publicRoot, "public manager fixture");
  json(join(privateRoot, "apps/ontology-manager/package.json"), { name: "@enterprise/ontology-manager-app" });
  text(join(privateRoot, "apps/ontology-manager/src/main.ts"), "export const enterprise = 1;\n");
  text(join(privateRoot, "apps/workbench/src/server.ts"), "export {};\n");
  commit(privateRoot, "private manager fixture");
  return fixture;
}

function stage(fixture, owners) {
  const context = join(fixture.dir, "context");
  const app = { sources: sourcesOf(fixture) };
  const record = collectMetadataContext({
    sources: app.sources,
    workspaceId: "enterprise",
    appImporter: "apps/ontology-manager",
    destination: context,
  });
  return { context, app, record, copy: () => copyWorkspace(app, context, record, owners) };
}

function filesUnder(root, prefix = "") {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? filesUnder(root, rel) : [rel];
    })
    .sort();
}

const MANAGER_OWNERS = {
  ontomato: ["apps/ontology-manager", "packages/ontology-manager"],
  enterprise: ["apps/ontology-manager"],
};

test("named owners per source id get their sources; every other package keeps only captured metadata", (t) => {
  const fixture = managerPair(t);
  const { context, record, copy } = stage(fixture, MANAGER_OWNERS);
  // A manifest edited after collection must not reach the context: metadata
  // comes only from the captured bytes.
  json(join(fixture.publicRoot, "packages/core/package.json"), { name: "@ontomato/core", edited: true });
  copy();
  assert.deepEqual(filesUnder(join(context, "workspace")), [
    "enterprise/apps/ontology-manager/package.json",
    "enterprise/apps/ontology-manager/src/main.ts",
    "enterprise/apps/workbench/package.json",
    "enterprise/package.json",
    "enterprise/pnpm-lock.yaml",
    "enterprise/pnpm-workspace.yaml",
    "ontomato/apps/ontology-manager/package.json",
    "ontomato/apps/ontology-manager/src/main.ts",
    "ontomato/apps/workbench/package.json",
    "ontomato/package.json",
    "ontomato/packages/core/package.json",
    "ontomato/packages/ontology-manager/package.json",
    "ontomato/packages/ontology-manager/src/index.ts",
    "ontomato/pnpm-lock.yaml",
    "ontomato/pnpm-workspace.yaml",
  ]);
  for (const source of record.sources)
    for (const candidate of source.candidates) {
      const copied = join(context, "workspace", source.id, candidate.path);
      if (!existsSync(copied)) continue;
      assert.equal(digest(copied), candidate.sha256, `${source.id}/${candidate.path}`);
    }
  assert.equal(record.application, "@enterprise/ontology-manager-app");
});

test("without owners the workbench keeps every JS owner of the record", (t) => {
  const fixture = managerPair(t);
  const { context, copy } = stage(fixture, undefined);
  copy();
  for (const rel of [
    "ontomato/packages/core/src/core.ts",
    "ontomato/apps/workbench/src/server.ts",
    "ontomato/packages/ontology-manager/src/index.ts",
    "enterprise/apps/workbench/src/server.ts",
  ])
    assert.equal(existsSync(join(context, "workspace", rel)), true, rel);
});

test("a source without named owners or an owner that is not its package is rejected", (t) => {
  const fixture = managerPair(t);
  const missing = stage(fixture, { ontomato: MANAGER_OWNERS.ontomato });
  assert.throws(missing.copy, /no source owners named for enterprise/);
  rmSync(missing.context, { recursive: true, force: true });
  const wrong = stage(fixture, { ...MANAGER_OWNERS, enterprise: ["packages/ontology-manager"] });
  assert.throws(wrong.copy, /source enterprise has no package packages\/ontology-manager/);
});
