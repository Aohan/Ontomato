import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { finalizeRuntime } from "./install-runtime.mjs";
import { snapshotIndex } from "./runtime-layout.mjs";

const EXPRESS = "express@4.22.1";
const SDK = "@modelcontextprotocol+sdk@1.29.0";

function manifest(root, path, name) {
  mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, path, "package.json"), `${JSON.stringify({ name })}\n`);
}

// Mirrors the installed shape N1d verified: the virtual store under
// /opt/runtime/node_modules/.pnpm, pnpm's own hoist links beside it.
function installed(t) {
  const dir = mkdtempSync(join(tmpdir(), "p4-n4b-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sources = join(dir, "src");
  const runtime = join(dir, "runtime");
  const store = join(runtime, "node_modules/.pnpm");
  const hoist = join(store, "node_modules");
  const server = join(sources, "ontomato/packages/workbench-server");
  const ui = join(sources, "ontomato/packages/workbench-ui");
  const keptMember = join(sources, "ontomato/packages/kept-in-store");
  const enterprise = join(sources, "enterprise/packages/workbench-server-enterprise");
  const express = join(store, `${EXPRESS}/node_modules/express`);
  const sdk = join(store, `${SDK}/node_modules/@modelcontextprotocol/sdk`);
  manifest(sources, "ontomato/packages/workbench-server", "@ontomato/workbench-server");
  manifest(sources, "ontomato/packages/workbench-ui", "@ontomato/workbench-ui");
  manifest(sources, "ontomato/packages/kept-in-store", "@ontomato/kept-in-store");
  manifest(sources, "ontomato/packages/not-hoisted", "@ontomato/not-hoisted");
  manifest(sources, "enterprise/packages/workbench-server-enterprise", "@enterprise/workbench-server-enterprise");
  manifest(store, `${EXPRESS}/node_modules/express`, "express");
  manifest(store, `${SDK}/node_modules/@modelcontextprotocol/sdk`, "@modelcontextprotocol/sdk");
  writeFileSync(join(store, "lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(join(runtime, "node_modules/.modules.yaml"), "hoistPattern: []\n");
  mkdirSync(join(hoist, ".bin"), { recursive: true });
  writeFileSync(join(hoist, ".bin/tsx"), "#!/bin/sh\n");
  mkdirSync(join(hoist, "@ontomato"), { recursive: true });
  mkdirSync(join(hoist, "@enterprise"), { recursive: true });
  mkdirSync(join(hoist, "@modelcontextprotocol"), { recursive: true });
  symlinkSync(server, join(hoist, "@ontomato/workbench-server"));
  // pnpm writes relative links too.
  symlinkSync(relative(join(hoist, "@ontomato"), ui), join(hoist, "@ontomato/workbench-ui"));
  // A member-named entry that resolves inside the store is an installed
  // package, not that member's own link, so it stays.
  symlinkSync(express, join(hoist, "@ontomato/kept-in-store"));
  // A third party can publish under a scope that also holds own members.
  symlinkSync(sdk, join(hoist, "@ontomato/third-party"));
  // This scope holds only an own member, so it must disappear with it.
  symlinkSync(enterprise, join(hoist, "@enterprise/workbench-server-enterprise"));
  symlinkSync(sdk, join(hoist, "@modelcontextprotocol/sdk"));
  return {
    dir,
    sources,
    runtime,
    store,
    hoist,
    index: {
      "express@4.22.1": `node_modules/.pnpm/${EXPRESS}/node_modules/express`,
      "@modelcontextprotocol/sdk@1.29.0": `node_modules/.pnpm/${SDK}/node_modules/@modelcontextprotocol/sdk`,
    },
    members: [
      { name: "@ontomato/workbench-server", absolute: server },
      { name: "@ontomato/workbench-ui", absolute: ui },
      { name: "@ontomato/kept-in-store", absolute: keptMember },
      { name: "@enterprise/workbench-server-enterprise", absolute: enterprise },
      { name: "@ontomato/not-hoisted", absolute: join(sources, "ontomato/packages/not-hoisted") },
    ],
  };
}

const finalize = (fixture, members = fixture.members) =>
  finalizeRuntime({ runtimeRoot: fixture.runtime, members, index: fixture.index });

test("indexes the fixed store relative to the runtime root, as the contract consumes it", (t) => {
  const root = mkdtempSync(join(tmpdir(), "p4-n4b-index-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  manifest(root, "node_modules/.pnpm/express@4.22.1/node_modules/express", "express");
  manifest(root, "src/apps/workbench", "@ontomato/workbench");
  mkdirSync(join(root, "src/apps/workbench/node_modules"), { recursive: true });
  symlinkSync(
    join(root, "node_modules/.pnpm/express@4.22.1/node_modules/express"),
    join(root, "src/apps/workbench/node_modules/express"),
  );
  const graph = {
    packages: { "express@4.22.1": { dependencies: {}, optionalDependencies: {} } },
    skipped: [],
    bindings: {
      "apps/workbench": {
        dependencies: { express: "express@4.22.1" },
        optionalDependencies: {},
        links: {},
      },
    },
  };
  assert.deepEqual(snapshotIndex(join(root, "src"), root, graph), {
    "express@4.22.1": "node_modules/.pnpm/express@4.22.1/node_modules/express",
  });
});

test("removes pnpm's own workspace links and locks, keeping third-party links and bins", (t) => {
  const fixture = installed(t);
  finalize(fixture);
  assert.equal(existsSync(join(fixture.store, "lock.yaml")), false);
  assert.equal(existsSync(join(fixture.runtime, "node_modules/.modules.yaml")), false);
  assert.equal(existsSync(join(fixture.hoist, "@ontomato/workbench-server")), false);
  assert.equal(existsSync(join(fixture.hoist, "@ontomato/workbench-ui")), false);
  // A scope that only held own members leaves; a scope with a third-party
  // entry keeps it.
  assert.equal(existsSync(join(fixture.hoist, "@enterprise")), false);
  assert.equal(lstatSync(join(fixture.hoist, "@ontomato")).isDirectory(), true);
  assert.equal(lstatSync(join(fixture.hoist, "@ontomato/kept-in-store")).isSymbolicLink(), true);
  assert.equal(lstatSync(join(fixture.hoist, "@ontomato/third-party")).isSymbolicLink(), true);
  assert.equal(lstatSync(join(fixture.hoist, "@modelcontextprotocol/sdk")).isSymbolicLink(), true);
  assert.equal(existsSync(join(fixture.hoist, ".bin/tsx")), true);
  assert.equal(
    readFileSync(join(fixture.sources, "ontomato/packages/workbench-server/package.json"), "utf8").length > 0,
    true,
  );
});

test("succeeds when pnpm left no .modules.yaml at the store root", (t) => {
  const fixture = installed(t);
  rmSync(join(fixture.runtime, "node_modules/.modules.yaml"));
  finalize(fixture);
  assert.equal(existsSync(join(fixture.runtime, "node_modules/.modules.yaml")), false);
});

test("rejects a runtime link that leaves the runtime", (t) => {
  const fixture = installed(t);
  manifest(fixture.dir, "outside/package", "@outside/leak");
  symlinkSync(join(fixture.dir, "outside/package"), join(fixture.hoist, "leak"));
  assert.throws(() => finalize(fixture), /runtime link leaves the runtime/);
});

test("keeps a same-named link to another source directory and lets the link check reject it", (t) => {
  const fixture = installed(t);
  manifest(fixture.sources, "ontomato/packages/impostor", "@ontomato/impostor");
  const link = join(fixture.hoist, "@ontomato/workbench-server");
  rmSync(link);
  symlinkSync(join(fixture.sources, "ontomato/packages/impostor"), link);
  assert.throws(() => finalize(fixture), /runtime link leaves the runtime/);
  assert.equal(lstatSync(link).isSymbolicLink(), true);
});

test("rejects a source link nested inside an installed store package", (t) => {
  const fixture = installed(t);
  manifest(fixture.sources, "ontomato/packages/core", "@ontomato/core");
  const nested = join(fixture.store, `${EXPRESS}/node_modules/express/node_modules`);
  mkdirSync(nested, { recursive: true });
  symlinkSync(join(fixture.sources, "ontomato/packages/core"), join(nested, "core"));
  assert.throws(() => finalize(fixture), /runtime link leaves the runtime/);
});

test("rejects a store directory missing from the production index", (t) => {
  const fixture = installed(t);
  fixture.index["zod@3.25.76"] = "node_modules/.pnpm/zod@3.25.76/node_modules/zod";
  assert.throws(() => finalize(fixture), /virtual store does not match the production index/);
});

test("rejects an installed store directory outside the production selection", (t) => {
  const fixture = installed(t);
  manifest(
    fixture.store,
    "workbench-ui@0.1.0/node_modules/@ontomato/workbench-ui",
    "@ontomato/workbench-ui",
  );
  assert.throws(() => finalize(fixture), /virtual store does not match the production index/);
});
