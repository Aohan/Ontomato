import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { bindingIndex, linkPlan, snapshotIndex, writeStage } from "./runtime-layout.mjs";

function place(root, rel, version) {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version: version || "0" }));
  return dir;
}

function bindings() {
  return {
    a: {
      dependencies: { express: "express@4.0.0" },
      optionalDependencies: {},
      links: { "@probe/b": "b" },
    },
    b: {
      dependencies: { express: "express@5.0.0" },
      optionalDependencies: {},
      links: {},
    },
  };
}

function index() {
  return {
    "express@4.0.0": "node_modules/.pnpm/express@4.0.0_hash/node_modules/express",
    "express@5.0.0": "node_modules/.pnpm/express@5.0.0_hash/node_modules/express",
  };
}

test("index reads the linked store path and rejects paths outside it", () => {
  const root = mkdtempSync(join(tmpdir(), "p4-n2-layout-"));
  const outside = mkdtempSync(join(tmpdir(), "p4-n2-outside-"));
  try {
    const storeDir = "node_modules/.pnpm/express@4.0.0_not-a-computed-hash/node_modules/express";
    place(root, storeDir);
    place(root, "node_modules/.pnpm/needed@1.0.0/node_modules/needed");
    symlinkSync(
      "../../needed@1.0.0/node_modules/needed",
      join(root, "node_modules/.pnpm/express@4.0.0_not-a-computed-hash/node_modules/needed"),
    );
    mkdirSync(join(root, "apps/app/node_modules"), { recursive: true });
    symlinkSync(resolve(root, storeDir), join(root, "apps/app/node_modules/express"));
    const graph = {
      packages: {
        "express@4.0.0": { dependencies: { needed: "needed@1.0.0" }, optionalDependencies: {} },
        "needed@1.0.0": { dependencies: {}, optionalDependencies: {} },
      },
      skipped: ["fsevents@2.3.3"],
      bindings: {
        "apps/app": {
          dependencies: { express: "express@4.0.0" },
          optionalDependencies: {},
          links: {},
        },
      },
    };
    const found = snapshotIndex(root, root, graph);
    assert.equal(found["express@4.0.0"], storeDir);
    assert.equal(found["needed@1.0.0"], "node_modules/.pnpm/needed@1.0.0/node_modules/needed");
    graph.packages["absent@1.0.0"] = { dependencies: {}, optionalDependencies: {} };
    assert.throws(() => snapshotIndex(root, root, graph), /index missing absent@1.0.0/);
    delete graph.packages["absent@1.0.0"];
    graph.skipped.push("express@4.0.0");
    assert.throws(() => snapshotIndex(root, root, graph), /skipped package was indexed/);
    graph.skipped.pop();
    place(outside, "express");
    symlinkSync(join(outside, "express"), join(root, "apps/app/node_modules/escaped"));
    graph.bindings["apps/app"].dependencies.escaped = "escaped@1.0.0";
    graph.packages["escaped@1.0.0"] = { dependencies: {}, optionalDependencies: {} };
    assert.throws(() => snapshotIndex(root, root, graph), /escapes/);
    delete graph.bindings["apps/app"].dependencies.escaped;
    delete graph.packages["escaped@1.0.0"];
    const other = place(root, "node_modules/.pnpm/express@4.0.0_other/node_modules/express");
    mkdirSync(join(root, "packages/lib/node_modules"), { recursive: true });
    symlinkSync(other, join(root, "packages/lib/node_modules/express"));
    graph.bindings["packages/lib"] = {
      dependencies: { express: "express@4.0.0" },
      optionalDependencies: {},
      links: {},
    };
    assert.throws(() => snapshotIndex(root, root, graph), /inconsistent/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

// The app builder installs for the build host: another architecture's optional
// binary in the target graph is absent there, and the stage never links it.
test("the stage index resolves only direct dependencies, so an absent transitive platform package is not looked up", () => {
  const root = mkdtempSync(join(tmpdir(), "p4-n2-binding-"));
  try {
    const storeDir = "node_modules/.pnpm/esbuild@0.27.4/node_modules/esbuild";
    place(root, storeDir);
    mkdirSync(join(root, "apps/app/node_modules"), { recursive: true });
    symlinkSync(resolve(root, storeDir), join(root, "apps/app/node_modules/esbuild"));
    const graph = {
      packages: {
        "esbuild@0.27.4": {
          dependencies: {},
          optionalDependencies: { "@esbuild/linux-x64": "@esbuild/linux-x64@0.27.4" },
        },
        "@esbuild/linux-x64@0.27.4": { dependencies: {}, optionalDependencies: {} },
      },
      skipped: [],
      bindings: {
        "apps/app": { dependencies: { esbuild: "esbuild@0.27.4" }, optionalDependencies: {}, links: {} },
      },
    };
    assert.deepEqual(bindingIndex(root, root, graph), { "esbuild@0.27.4": storeDir });
    assert.throws(() => snapshotIndex(root, root, graph), /ENOENT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plan rejects colliding directories and store paths that normalize outside", () => {
  const dirs = { a: "pkg/a", b: "pkg/b" };
  const plan = linkPlan(bindings(), dirs, index());
  assert.deepEqual(
    plan.links.map((link) => link.store || link.own),
    [
      "pkg/b",
      index()["express@4.0.0"],
      index()["express@5.0.0"],
    ],
  );
  assert.throws(() => linkPlan(bindings(), { a: "pkg/x", b: "pkg/./x" }, index()), /collide/);
  assert.throws(() => linkPlan(bindings(), { a: "pkg/x", b: "pkg/x" }, index()), /collide/);
  assert.throws(
    () => linkPlan(bindings(), { a: "pkg/node_modules/a", b: "pkg/b" }, index()),
    /node_modules/,
  );
  assert.throws(() => linkPlan(bindings(), { a: "../out", b: "pkg/b" }, index()), /outside the stage/);
  const escaped = index();
  escaped["express@4.0.0"] = "node_modules/../../outside";
  assert.throws(() => linkPlan(bindings(), dirs, escaped), /escapes/);
});

test("multi-version links resolve to different store packages and a bad stage writes nothing", () => {
  const store = mkdtempSync(join(tmpdir(), "p4-n2-store-"));
  const stage = mkdtempSync(join(tmpdir(), "p4-n2-stage-"));
  const host = mkdtempSync(join(tmpdir(), "p4-n2-host-"));
  try {
    const e4 = index()["express@4.0.0"];
    const e5 = index()["express@5.0.0"];
    place(store, e4, "4.0.0");
    place(store, e5, "5.0.0");
    mkdirSync(join(stage, "pkg/b"), { recursive: true });
    const plan = linkPlan(bindings(), { a: "pkg/a", b: "pkg/b" }, index());
    writeStage(stage, store, plan);
    const version = (rel) => JSON.parse(readFileSync(join(stage, rel), "utf8")).version;
    assert.equal(version("pkg/a/node_modules/express/package.json"), "4.0.0");
    assert.equal(version("pkg/b/node_modules/express/package.json"), "5.0.0");
    assert.equal(
      realpathSync(join(stage, "pkg/a/node_modules/@probe/b")),
      realpathSync(join(stage, "pkg/b")),
    );
    assert.throws(() => writeStage(stage, store, plan), /already exists/);
    const blocked = mkdtempSync(join(tmpdir(), "p4-n2-block-"));
    mkdirSync(join(blocked, "pkg/b/node_modules"), { recursive: true });
    writeFileSync(join(blocked, "pkg/b/node_modules/express"), "taken");
    assert.throws(() => writeStage(blocked, store, plan), /already exists/);
    assert.equal(existsSync(join(blocked, "pkg/a/node_modules/express")), false);
    const banned = join(host, "node_modules");
    mkdirSync(banned);
    assert.throws(() => writeStage(banned, store, plan), /node_modules/);
    assert.equal(existsSync(join(banned, "pkg")), false);
    rmSync(blocked, { recursive: true, force: true });
  } finally {
    rmSync(store, { recursive: true, force: true });
    rmSync(stage, { recursive: true, force: true });
    rmSync(host, { recursive: true, force: true });
  }
});
