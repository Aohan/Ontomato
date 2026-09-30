import assert from "node:assert/strict";
import { test } from "node:test";
import { fingerprint } from "../build-support.mjs";
import { productionGraph } from "./production-graph.mjs";

const linux = { os: ["linux"], cpu: ["arm64"] };

function manifests() {
  return {
    "apps/app": {
      name: "@app/app",
      version: "0.1.0",
      dependencies: { express: "4", "@app/lib": "workspace:*" },
      optionalDependencies: { fsevents: "2", leftpad: "1" },
      devDependencies: { typescript: "5" },
    },
    "packages/lib": {
      name: "@app/lib",
      version: "0.1.0",
      dependencies: { express: "5", aliased: "npm:@other/pkg@1.0.0", sdk: "1" },
    },
  };
}

function lock() {
  return {
    lockfileVersion: "9.0",
    importers: {
      "apps/app": {
        dependencies: {
          express: { specifier: "4", version: "4.0.0" },
          "@app/lib": { specifier: "workspace:*", version: "link:../../packages/lib" },
        },
        devDependencies: { typescript: { specifier: "5", version: "5.0.0" } },
        optionalDependencies: {
          fsevents: { specifier: "2", version: "2.3.3" },
          leftpad: { specifier: "1", version: "1.0.0" },
        },
      },
      "packages/lib": {
        dependencies: {
          express: { specifier: "5", version: "5.0.0" },
          aliased: { specifier: "npm:@other/pkg@1.0.0", version: "@other/pkg@1.0.0" },
          sdk: { specifier: "1", version: "1.0.0(zod@3.0.0)" },
        },
      },
    },
    packages: {
      "express@4.0.0": { resolution: { integrity: "sha512-four" }, peerDependencies: { zod: "^3" } },
      "express@5.0.0": { resolution: { integrity: "sha512-five" }, hasBin: true },
      "fsevents@2.3.3": { resolution: { integrity: "sha512-fs" }, os: ["darwin"] },
      "leftpad@1.0.0": { resolution: { integrity: "sha512-left" }, ...linux },
      "@other/pkg@1.0.0": { resolution: { integrity: "sha512-other" }, requiresBuild: true },
      "sdk@1.0.0": { resolution: { integrity: "sha512-sdk" }, peerDependencies: { zod: "^3" } },
      "zod@3.0.0": { resolution: { integrity: "sha512-zod" } },
      "needed@1.0.0": { resolution: { integrity: "sha512-need" }, ...linux },
    },
    snapshots: {
      "express@4.0.0": { dependencies: { needed: "1.0.0" } },
      "express@5.0.0": {},
      "fsevents@2.3.3": {},
      "leftpad@1.0.0": {},
      "@other/pkg@1.0.0": {},
      "sdk@1.0.0(zod@3.0.0)": { dependencies: { zod: "3.0.0" } },
      "zod@3.0.0": {},
      "needed@1.0.0": {},
    },
  };
}

test("versions, peer snapshots and declaration matches stay on the third-party graph", () => {
  const graph = productionGraph(lock(), "apps/app", manifests(), "arm64");
  assert.equal(graph.bindings["apps/app"].dependencies.express, "express@4.0.0");
  assert.equal(graph.bindings["packages/lib"].dependencies.express, "express@5.0.0");
  assert.equal(graph.bindings["packages/lib"].dependencies.sdk, "sdk@1.0.0(zod@3.0.0)");
  assert.equal(graph.packages["sdk@1.0.0(zod@3.0.0)"].dependencies.zod, "zod@3.0.0");
  assert.equal(graph.bindings["packages/lib"].dependencies.aliased, "@other/pkg@1.0.0");
  assert.equal(graph.bindings["apps/app"].optionalDependencies.leftpad, "leftpad@1.0.0");
  assert.equal(graph.bindings["apps/app"].dependencies.typescript, undefined);
  assert.equal(graph.bindings["apps/app"].links["@app/lib"], "packages/lib");
  assert.deepEqual(graph.skipped, ["fsevents@2.3.3"]);
  assert.equal(graph.packages["express@4.0.0"].integrity, "sha512-four");
  assert.equal(Object.hasOwn(graph.packages, "@app/app"), false);
  assert.throws(() => productionGraph(lock(), "apps/app", manifests(), "x64"), /not linux\/x64/);
  const outside = manifests();
  delete outside["packages/lib"];
  assert.throws(() => productionGraph(lock(), "apps/app", outside, "arm64"), /outside the manifest map/);
  const renamed = manifests();
  renamed["packages/lib"].name = "@app/other";
  assert.throws(() => productionGraph(lock(), "apps/app", renamed, "arm64"), /does not match manifest/);
  const drifted = manifests();
  drifted["apps/app"].dependencies.express = "^5";
  assert.throws(() => productionGraph(lock(), "apps/app", drifted, "arm64"), /specifier mismatch/);
  const added = manifests();
  added["apps/app"].dependencies.added = "1";
  assert.throws(() => productionGraph(lock(), "apps/app", added, "arm64"), /dependencies differ/);
  const extra = lock();
  extra.importers["apps/app"].dependencies.extra = { specifier: "1", version: "1.0.0" };
  assert.throws(() => productionGraph(extra, "apps/app", manifests(), "arm64"), /dependencies differ/);
  const old = lock();
  old.lockfileVersion = "6.0";
  assert.throws(() => productionGraph(old, "apps/app", manifests(), "arm64"), /9\.0/);
  const broken = lock();
  delete broken.packages["needed@1.0.0"].resolution.integrity;
  assert.throws(() => productionGraph(broken, "apps/app", manifests(), "arm64"), /no integrity/);
});

test("own identity and dev drift do not change the third-party graph", () => {
  const base = productionGraph(lock(), "apps/app", manifests(), "arm64");
  const movedLock = lock();
  movedLock.importers = {
    "services/app": {
      dependencies: {
        express: { specifier: "4", version: "4.0.0" },
        "@moved/lib": { specifier: "workspace:*", version: "link:../lib" },
      },
      devDependencies: { eslint: { specifier: "9", version: "9.0.0" } },
      optionalDependencies: movedLock.importers["apps/app"].optionalDependencies,
    },
    "services/lib": {
      dependencies: {
        express: { specifier: "5", version: "5.0.0" },
        aliased: { specifier: "npm:@other/pkg@1.0.0", version: "@other/pkg@1.0.0" },
        sdk: { specifier: "1", version: "1.0.0(zod@3.0.0)" },
        "@moved/app": { specifier: "workspace:*", version: "link:../app" },
      },
    },
  };
  const movedManifests = {
    "services/app": {
      name: "@moved/app",
      version: "2.0.0",
      dependencies: { express: "4", "@moved/lib": "workspace:*" },
      optionalDependencies: { fsevents: "2", leftpad: "1" },
      devDependencies: { eslint: "9" },
    },
    "services/lib": {
      name: "@moved/lib",
      version: "3.0.0",
      dependencies: {
        express: "5",
        aliased: "npm:@other/pkg@1.0.0",
        sdk: "1",
        "@moved/app": "workspace:*",
      },
    },
  };
  const moved = productionGraph(movedLock, "services/app", movedManifests, "arm64");
  assert.deepEqual(moved.packages, base.packages);
  assert.equal(fingerprint(moved.packages), fingerprint(base.packages));
  assert.equal(moved.bindings["services/app"].links["@moved/lib"], "services/lib");
  assert.equal(moved.bindings["services/lib"].links["@moved/app"], "services/app");
  const devLock = lock();
  devLock.importers["apps/app"].devDependencies.typescript.version = "5.9.0";
  const devManifests = manifests();
  devManifests["apps/app"].devDependencies.typescript = "5.9.0";
  devManifests["apps/app"].version = "9.9.9";
  const dev = productionGraph(devLock, "apps/app", devManifests, "arm64");
  assert.deepEqual(dev.packages, base.packages);
  const changed = lock();
  changed.packages["express@4.0.0"].resolution.integrity = "sha512-changed";
  const next = productionGraph(changed, "apps/app", manifests(), "arm64");
  assert.notDeepEqual(next.packages, base.packages);
  assert.notEqual(fingerprint(next.packages), fingerprint(base.packages));
});
