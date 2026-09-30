import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fingerprint } from "../build-support.mjs";
import {
  INTERFACE,
  assembleMetadata,
  assertPair,
  buildContract,
  checkNoBrokenSymlinks,
  computeWorkbenchContract,
  productionClosure,
  productionFingerprint,
} from "./runtime-contract.mjs";

const both = { os: ["linux"], cpu: ["arm64", "x64"] };

function lock() {
  return {
    lockfileVersion: "9.0",
    importers: {
      "apps/app": {
        dependencies: {
          left: { specifier: "1", version: "1.0.0" },
          "@app/lib": { specifier: "workspace:*", version: "link:../../packages/lib" },
        },
        optionalDependencies: { fsevents: { specifier: "2", version: "2.3.3" } },
      },
      "packages/lib": {
        dependencies: { left: { specifier: "1", version: "1.0.0" } },
      },
    },
    packages: {
      "left@1.0.0": { resolution: { integrity: "sha512-left" }, ...both },
      "fsevents@2.3.3": { resolution: { integrity: "sha512-fs" }, os: ["darwin"] },
      "onlyarm@1.0.0": { resolution: { integrity: "sha512-arm" }, os: ["linux"], cpu: ["arm64"] },
      "right@1.0.0": { resolution: { integrity: "sha512-right" }, ...both },
    },
    snapshots: {
      "left@1.0.0": {},
      "fsevents@2.3.3": {},
      "onlyarm@1.0.0": {},
      "right@1.0.0": {},
    },
  };
}

function bundle() {
  return {
    importer: "apps/app",
    manifests: {
      "apps/app": {
        name: "@app/app",
        version: "0.1.0",
        dependencies: { left: "1", "@app/lib": "workspace:*" },
        optionalDependencies: { fsevents: "2" },
      },
      "packages/lib": {
        name: "@app/lib",
        version: "0.1.0",
        dependencies: { left: "1" },
      },
    },
  };
}

function movedLock() {
  const source = lock();
  source.importers = {
    "services/app": {
      dependencies: {
        left: { specifier: "1", version: "1.0.0" },
        "@moved/lib": { specifier: "workspace:*", version: "link:../lib" },
      },
    },
    "services/lib": {
      dependencies: {
        left: { specifier: "1", version: "1.0.0" },
        "@moved/app": { specifier: "workspace:*", version: "link:../app" },
      },
    },
  };
  return source;
}

function movedBundle() {
  return {
    importer: "services/app",
    manifests: {
      "services/app": {
        name: "@moved/app",
        version: "9.0.0",
        dependencies: { left: "1", "@moved/lib": "workspace:*" },
      },
      "services/lib": {
        name: "@moved/lib",
        version: "8.0.0",
        dependencies: { left: "1", "@moved/app": "workspace:*" },
      },
    },
  };
}

function observed() {
  return {
    platform: "linux/arm64",
    node: "24.21",
    pnpm: "9.15.9",
    python: { version: "3.10", packages: { numpy: "1.2.3" } },
  };
}

test("same third-party packages stay compatible when own bindings differ", () => {
  const base = productionClosure(bundle(), lock(), "linux/arm64");
  const moved = productionClosure(movedBundle(), movedLock(), "linux/arm64");
  assert.deepEqual(moved.packages, base.packages);
  assert.deepEqual(base.skipped, ["fsevents@2.3.3"]);
  assert.deepEqual(moved.skipped, []);
  assert.notDeepEqual(moved.bindings, base.bindings);
  assert.equal(productionFingerprint(moved), productionFingerprint(base));
  assert.notEqual(fingerprint(moved), fingerprint(base));
  assert.equal(Object.hasOwn(base.packages, "@app/app"), false);
  const contract = buildContract(base, observed());
  assert.equal(contract.interfaceVersion, INTERFACE);
  assert.equal(INTERFACE, 3);
  assert.equal(contract.family, "node-app");
  assert.equal(contract.productionDependencies, productionFingerprint(base));
});

test("dependency and integrity changes alter productionFingerprint", () => {
  const base = productionClosure(bundle(), lock(), "linux/arm64");
  const contract = buildContract(base, observed());
  const changed = lock();
  changed.packages["left@1.0.0"].resolution.integrity = "sha512-changed";
  const changedGraph = productionClosure(bundle(), changed, "linux/arm64");
  assert.notEqual(productionFingerprint(changedGraph), contract.productionDependencies);

  const linked = lock();
  linked.snapshots["left@1.0.0"] = { dependencies: { right: "1.0.0" } };
  const linkedGraph = productionClosure(bundle(), linked, "linux/arm64");
  assert.equal(linkedGraph.packages["left@1.0.0"].dependencies.right, "right@1.0.0");
  assert.notEqual(productionFingerprint(linkedGraph), contract.productionDependencies);
});

test("linux/amd64 selects cpu x64 once and other arch spellings are rejected", () => {
  const source = lock();
  source.importers["apps/app"].dependencies.onlyarm = { specifier: "1", version: "1.0.0" };
  const manifests = bundle().manifests;
  manifests["apps/app"].dependencies.onlyarm = "1";
  const selected = { importer: "apps/app", manifests };
  const arm = productionClosure(selected, source, "linux/arm64");
  assert.equal(arm.packages["onlyarm@1.0.0"].integrity, "sha512-arm");
  assert.throws(() => productionClosure(selected, source, "linux/amd64"), /not linux\/x64/);
  assert.throws(() => productionClosure(selected, source, "amd64"), /unsupported architecture/);
  assert.throws(() => productionClosure(selected, source, "arm64"), /unsupported architecture/);
  const numeric = lock();
  numeric.lockfileVersion = "9";
  assert.throws(() => productionClosure(bundle(), numeric, "linux/arm64"), /9\.0/);
  assert.throws(
    () => productionClosure({ name: "@app/app", dependencies: { left: "1" } }, lock(), "linux/arm64"),
    /importer and manifests/,
  );
});

test("libc filter allows glibc and rejects musl packages", () => {
  const source = lock();
  source.importers["apps/app"].dependencies.muslpkg = { specifier: "1", version: "1.0.0" };
  const manifests = bundle().manifests;
  manifests["apps/app"].dependencies.muslpkg = "1";
  source.packages["muslpkg@1.0.0"] = {
    resolution: { integrity: "sha512-musl" },
    os: ["linux"],
    cpu: ["arm64"],
    libc: ["musl"],
  };
  source.snapshots["muslpkg@1.0.0"] = {};
  const selected = { importer: "apps/app", manifests };
  assert.throws(
    () => productionClosure(selected, source, "linux/arm64"),
    /required muslpkg@1\.0\.0 is not linux\/arm64 glibc/,
  );

  source.packages["muslpkg@1.0.0"].libc = ["glibc"];
  const okGraph = productionClosure(selected, source, "linux/arm64");
  assert.ok(okGraph.packages["muslpkg@1.0.0"]);
});

test("computeWorkbenchContract parses dockerfiles and enforces Node and pnpm version consistency", () => {
  const base = productionClosure(bundle(), lock(), "linux/arm64");
  const dfRuntime = "ARG NODE_RUNTIME_IMAGE=docker.io/library/node:24.21.0-slim\nARG PNPM_VERSION=9.15.9\nARG PYTHON_RUNTIME_IMAGE=docker.io/library/python:3.10-slim-bookworm\n";
  const dfApp = "ARG NODE_BUILDER_IMAGE=docker.io/library/node:24.21.0\nARG PNPM_VERSION=9.15.9\n";
  const reqs = "numpy==1.2.3\n";

  const contract = computeWorkbenchContract({
    dockerfileRuntimeText: dfRuntime,
    requirementsText: reqs,
    graph: base,
    arch: "arm64",
    dockerfileAppText: dfApp,
  });
  assert.equal(contract.family, "node-app");
  assert.equal(contract.node, "24.21");
  assert.equal(contract.pnpm, "9.15.9");
  assert.equal(contract.python.version, "3.10");
  assert.deepEqual(contract.python.packages, { numpy: "1.2.3" });

  assert.throws(
    () =>
      computeWorkbenchContract({
        dockerfileRuntimeText: dfRuntime,
        requirementsText: reqs,
        graph: base,
        arch: "arm64",
        dockerfileAppText: "ARG NODE_BUILDER_IMAGE=docker.io/library/node:24.22.0\nARG PNPM_VERSION=9.15.9\n",
      }),
    /Node version mismatch: runtime 24.21.0 vs app builder 24.22.0/,
  );

  assert.throws(
    () =>
      computeWorkbenchContract({
        dockerfileRuntimeText: dfRuntime,
        requirementsText: reqs,
        graph: base,
        arch: "arm64",
        dockerfileAppText: "ARG NODE_BUILDER_IMAGE=docker.io/library/node:24.21.0\nARG PNPM_VERSION=9.15.8\n",
      }),
    /pnpm version mismatch/,
  );
});

test("pair rejects schema, kind, family, arch and fingerprint mismatches", () => {
  const base = productionClosure(bundle(), lock(), "linux/arm64");
  const contract = buildContract(base, observed());
  const fp = fingerprint(contract);
  const app = { schema: 3, kind: "app", family: "node-app", runtimeCompatFingerprint: fp };
  const runtime = { schema: 3, kind: "runtime", family: "node-app", arch: "arm64", runtimeCompatFingerprint: fp };
  assertPair(app, runtime, "arm64");
  assert.throws(() => assertPair({ ...app, schema: 2 }, runtime, "arm64"), /schema, runtime family or image kind/);
  assert.throws(() => assertPair({ ...app, kind: "runtime" }, runtime, "arm64"), /image kind/);
  assert.throws(() => assertPair({ ...app, family: "java-app" }, runtime, "arm64"), /runtime family/);
  assert.throws(() => assertPair(app, { ...runtime, arch: "amd64" }, "arm64"), /architecture mismatch/);
  assert.throws(() => assertPair({ ...app, runtimeCompatFingerprint: "zz" }, runtime, "arm64"), /fingerprint mismatch/);
  const other = "ab".repeat(32);
  assert.throws(
    () => assertPair({ ...app, runtimeCompatFingerprint: other }, runtime, "arm64"),
    /fingerprint mismatch/,
  );
});

test("assemble pairs the images and then requires the expected architecture", () => {
  const base = productionClosure(bundle(), lock(), "linux/arm64");
  const contract = buildContract(base, observed());
  const fp = fingerprint(contract);
  const app = { schema: 3, kind: "app", family: "node-app", runtimeCompatFingerprint: fp };
  const runtime = { schema: 3, kind: "runtime", family: "node-app", arch: "arm64", runtimeCompatFingerprint: fp };
  const dir = mkdtempSync(join(tmpdir(), "assemble-test-"));
  try {
    assembleMetadata(app, runtime, "arm64", "arm64", dir);
    assert.throws(() => assembleMetadata(app, runtime, "arm64", "amd64", dir), /Assembly architecture mismatch: expected amd64, actual arm64/);
    assert.throws(() => assembleMetadata({ ...app, kind: "runtime" }, runtime, "arm64", "arm64", dir), /image kind/);
    assert.throws(() => assembleMetadata(app, { ...runtime, arch: "amd64" }, "arm64", "arm64", dir), /architecture mismatch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the assemble command rejects a missing or unknown expected architecture before reading metadata", () => {
  const cli = fileURLToPath(new URL("./runtime-contract.mjs", import.meta.url));
  for (const args of [["assemble"], ["assemble", "x86_64"], ["assemble", "arm64", "extra"]]) {
    const run = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(run.status, 1, args.join(" "));
    assert.match(run.stderr, /^\[contract\] assemble requires the expected architecture amd64\|arm64/);
  }
});

test("checkNoBrokenSymlinks detects broken symlinks and allows valid ones", () => {
  const root = mkdtempSync(join(tmpdir(), "symlink-test-"));
  try {
    writeFileSync(join(root, "real.txt"), "hello");
    spawnSync("ln", ["-s", join(root, "nonexistent"), join(root, "broken")]);
    assert.throws(() => checkNoBrokenSymlinks(root), /Broken symbolic link/);
    rmSync(join(root, "broken"));
    spawnSync("ln", ["-s", join(root, "real.txt"), join(root, "valid")]);
    checkNoBrokenSymlinks(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
