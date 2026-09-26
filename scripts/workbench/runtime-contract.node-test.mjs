import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  checkAgainst,
  checkBuild,
  checkPythonRequirements,
  nativeFiles,
  pairMetadata,
  productionClosure,
  productionFingerprint,
} from "./runtime-contract.mjs";

const both = { os: ["linux"], cpu: ["arm64", "x64"], libc: ["glibc"] };

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
      "onlyarm@1.0.0": { resolution: { integrity: "sha512-arm" }, os: ["linux"], cpu: ["arm64"], libc: ["glibc"] },
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
    node: { api: "fixture", modules: "fixture", glibc: "fixture" },
    nativeDependencies: "fixture",
    python: { version: "fixture", packages: { numpy: "1.2.3" } },
  };
}

function inputFor(source, manifests, importer, requirements) {
  return { importer, manifests, lock: source, pythonRequirements: requirements };
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
  const contract = buildContract(base, { "left@1.0.0": "store/left" }, observed());
  assert.equal(contract.interfaceVersion, INTERFACE);
  assert.equal(INTERFACE, 3);
  assert.equal(contract.family, "node-app");
  assert.equal(contract.productionDependencies, productionFingerprint(base));
  const pins = "NumPy==1.2.3 # pin\r\n\n# comment\n";
  checkAgainst(inputFor(lock(), bundle().manifests, "apps/app", pins), contract);
  checkAgainst(inputFor(movedLock(), movedBundle().manifests, "services/app", pins), contract);
  checkBuild(moved, contract, fingerprint(contract));
});

test("dependency and integrity changes are rejected without a rebuild", () => {
  const base = productionClosure(bundle(), lock(), "linux/arm64");
  const contract = buildContract(base, { "left@1.0.0": "store/left" }, observed());
  const changed = lock();
  changed.packages["left@1.0.0"].resolution.integrity = "sha512-changed";
  const changedGraph = productionClosure(bundle(), changed, "linux/arm64");
  assert.notEqual(productionFingerprint(changedGraph), contract.productionDependencies);
  assert.throws(
    () => checkAgainst(inputFor(changed, bundle().manifests, "apps/app", "numpy==1.2.3\n"), contract),
    /No runtime rebuild was started/,
  );
  const linked = lock();
  linked.snapshots["left@1.0.0"] = { dependencies: { right: "1.0.0" } };
  const linkedGraph = productionClosure(bundle(), linked, "linux/arm64");
  assert.equal(linkedGraph.packages["left@1.0.0"].dependencies.right, "right@1.0.0");
  assert.throws(
    () => checkAgainst(inputFor(linked, bundle().manifests, "apps/app", "numpy==1.2.3\n"), contract),
    /No runtime rebuild was started/,
  );
  assert.throws(
    () => checkBuild(linkedGraph, contract, fingerprint(contract)),
    /does not match runtime/,
  );
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

test("snapshotPaths and interface enter the full contract fingerprint only", () => {
  const base = productionClosure(bundle(), lock(), "linux/arm64");
  const contract = buildContract(base, { "left@1.0.0": "store/left" }, observed());
  const relocated = buildContract(base, { "left@1.0.0": "store/other" }, observed());
  assert.equal(relocated.productionDependencies, contract.productionDependencies);
  assert.notEqual(fingerprint(relocated), fingerprint(contract));
  assert.throws(() => checkBuild(base, relocated, fingerprint(contract)), /required fingerprint/);
  const drifted = buildContract(base, contract.snapshotPaths, observed());
  drifted.interfaceVersion = 2;
  assert.notEqual(fingerprint(drifted), fingerprint(contract));
  assert.throws(() => checkBuild(base, drifted, fingerprint(contract)), /required fingerprint/);
  checkBuild(base, contract, fingerprint(contract));
});

test("pair rejects schema, kind, family, arch and fingerprint mismatches", () => {
  const base = productionClosure(bundle(), lock(), "linux/arm64");
  const contract = buildContract(base, { "left@1.0.0": "store/left" }, observed());
  const fp = fingerprint(contract);
  const app = { schema: 3, kind: "app", family: "node-app", runtimeCompatFingerprint: fp };
  const runtime = { schema: 3, kind: "runtime", family: "node-app", arch: "arm64", runtimeCompatFingerprint: fp };
  pairMetadata(app, runtime, contract, "arm64");
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
  assert.throws(
    () =>
      pairMetadata(
        { ...app, runtimeCompatFingerprint: other },
        { ...runtime, runtimeCompatFingerprint: other },
        contract,
        "arm64",
      ),
    /metadata is inconsistent/,
  );
  assert.throws(
    () => pairMetadata(app, runtime, { ...contract, family: "java-app" }, "arm64"),
    /metadata is inconsistent/,
  );
});

test("assemble pairs like startup and then requires the expected architecture", () => {
  const base = productionClosure(bundle(), lock(), "linux/arm64");
  const contract = buildContract(base, { "left@1.0.0": "store/left" }, observed());
  const fp = fingerprint(contract);
  const app = { schema: 3, kind: "app", family: "node-app", runtimeCompatFingerprint: fp };
  const runtime = { schema: 3, kind: "runtime", family: "node-app", arch: "arm64", runtimeCompatFingerprint: fp };
  assembleMetadata(app, runtime, contract, "arm64", "arm64");
  assert.throws(() => assembleMetadata(app, runtime, contract, "arm64", "amd64"), /Assembly architecture mismatch: expected amd64, actual arm64/);
  // Every pairing failure still fails first.
  assert.throws(() => assembleMetadata({ ...app, kind: "runtime" }, runtime, contract, "arm64", "arm64"), /image kind/);
  assert.throws(() => assembleMetadata(app, { ...runtime, arch: "amd64" }, contract, "arm64", "arm64"), /architecture mismatch/);
  assert.throws(() => assembleMetadata(app, runtime, { ...contract, family: "java-app" }, "arm64", "arm64"), /metadata is inconsistent/);
});

test("the assemble command rejects a missing or unknown expected architecture before reading metadata", () => {
  const cli = fileURLToPath(new URL("./runtime-contract.mjs", import.meta.url));
  for (const args of [["assemble"], ["assemble", "x86_64"], ["assemble", "arm64", "extra"]]) {
    const run = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(run.status, 1, args.join(" "));
    assert.match(run.stderr, /^\[contract\] assemble requires the expected architecture amd64\|arm64/);
  }
});

test("python pins match exactly and reject drift or ranges", () => {
  const packages = { numpy: "1.2.3" };
  checkPythonRequirements("# note\n\nnumpy==1.2.3\n", packages);
  assert.throws(() => checkPythonRequirements("numpy==9.9.9\n", packages), /provides 1\.2\.3/);
  assert.throws(() => checkPythonRequirements("scipy==1.0.0\n", packages), /provides missing/);
  assert.throws(() => checkPythonRequirements("numpy>=1.2.3\n", packages), /exact name==version pins/);
  const base = productionClosure(bundle(), lock(), "linux/arm64");
  const contract = buildContract(base, { "left@1.0.0": "store/left" }, observed());
  assert.throws(
    () => checkAgainst(inputFor(lock(), bundle().manifests, "apps/app", "numpy>=1.2.3\n"), contract),
    /exact name==version pins/,
  );
  assert.throws(
    () =>
      checkAgainst(inputFor(lock(), bundle().manifests, "apps/app", "numpy==1.2.3\n"), {
        platform: "linux/arm64",
        productionDependencies: contract.productionDependencies,
      }),
    /no python packages/,
  );
});

test("native hash covers elf and .node contents", () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-contract-"));
  try {
    writeFileSync(join(root, "note.txt"), "text");
    writeFileSync(join(root, "addon.node"), "one");
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "nested", "lib.so"), Buffer.from([127, 69, 76, 70, 1]));
    const first = nativeFiles(root);
    assert.match(first, /^[a-f0-9]{64}$/);
    writeFileSync(join(root, "note.txt"), "changed text");
    assert.equal(nativeFiles(root), first);
    writeFileSync(join(root, "addon.node"), "two");
    assert.notEqual(nativeFiles(root), first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
