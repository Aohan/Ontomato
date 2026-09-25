import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fingerprint, sourceIdentity } from "../build-support.mjs";
import { buildWorkbenchApp, combineIdentity } from "./build-images.mjs";

const VERSION = "9.9.9-test";
const LOCK_EXCLUDE = "apps/workbench/runtime-lock.json";
const AMD64_FP = "a".repeat(64);
const OLD_ARM64_FP = "b".repeat(64);

// Self-contained Git fixture: each source is a real work-tree root with the
// root metadata the N4a collector requires. Generated directories live under
// .build/, which the committed .gitignore excludes exactly like the real repos.
function repo(t, appName) {
  const dir = mkdtempSync(join(tmpdir(), "p4-n4c-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (args) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
  git(["init"]);
  writeFileSync(join(dir, ".gitignore"), ".build/\n");
  writeFileSync(join(dir, "package.json"), '{"name":"fixture","private":true}\n');
  writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(
    join(dir, "pom.xml"),
    `<project><properties><revision>${VERSION}</revision></properties></project>\n`,
  );
  mkdirSync(join(dir, "docker/workbench"), { recursive: true });
  writeFileSync(join(dir, "docker/workbench/requirements.txt"), "numpy==1.26.4\npandas==1.5.3\n");
  mkdirSync(join(dir, "apps/workbench"), { recursive: true });
  writeFileSync(
    join(dir, "apps/workbench/package.json"),
    `${JSON.stringify({ name: appName })}\n`,
  );
  git(["add", "."]);
  git(["-c", "user.name=n4c", "-c", "user.email=n4c@t", "commit", "-m", "init"]);
  return dir;
}

function head(dir) {
  return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function identities(pub, ent) {
  return [
    { id: "ontomato", root: pub, identity: sourceIdentity(VERSION, pub, LOCK_EXCLUDE) },
    { id: "enterprise", root: ent, identity: sourceIdentity(VERSION, ent, LOCK_EXCLUDE) },
  ];
}

function descriptor(root, component = "workbench-opensource") {
  return {
    repoRoot: root,
    publicRoot: root,
    lockRoot: join(root, "apps/workbench"),
    lockExclude: LOCK_EXCLUDE,
    component,
    workspaceId: "ontomato",
    appImporter: "apps/workbench",
    sources: [{ id: "ontomato", root }],
  };
}

function enterpriseDescriptor(pub, ent) {
  return {
    ...descriptor(ent, "workbench-enterprise"),
    publicRoot: pub,
    workspaceId: "enterprise",
    appImporter: "apps/workbench",
    sources: [
      { id: "ontomato", root: pub },
      { id: "enterprise", root: ent },
    ],
  };
}

function writeLock(dir, arm64) {
  writeFileSync(
    join(dir, LOCK_EXCLUDE),
    `${JSON.stringify({ schema: 3, family: "node-app", runtimes: { "linux/amd64": AMD64_FP, "linux/arm64": arm64 } }, null, 2)}\n`,
  );
}

// Minimal fixture Docker, not a generic mock: it only speaks this builder's
// calls. Succeeds through the runtime build; FAKE_MODE selects the late stage
// that fails (ok | bad-family | bad-readback). FAKE_COMMIT=1 commits once in
// FAKE_REPO during contract-export to simulate a source moving mid-build.
const FAKE = `#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}
const args = process.argv.slice(2);
const dir = process.env.FAKE_DIR;
const mode = process.env.FAKE_MODE || "ok";
function platformArch() {
  const i = args.indexOf("--platform");
  if (i >= 0) return args[i + 1].split("/")[1];
  const m = /-(amd64|arm64)$/.exec(args[args.length - 1] || "");
  return m ? m[1] : "arm64";
}
const arch = platformArch();
const contract = { family: "node-app", interfaceVersion: 3, platform: "linux/" + arch, node: "20.3.0", productionDependencies: "aaaa", snapshotPaths: {}, nativeDependencies: {}, python: {} };
const fp = createHash("sha256").update(canonical(contract)).digest("hex");
if (args[0] === "version") {
  process.stdout.write("25.0.0\\n");
} else if (args[0] === "buildx") {
  const target = args[args.indexOf("--target") + 1];
  if (target === "contract-export") {
    const out = args.find((a) => a.indexOf("type=local,dest=") === 0);
    const dest = out.slice("type=local,dest=".length);
    mkdirSync(dest, { recursive: true });
    writeFileSync(dest + "/contract.json", JSON.stringify(contract));
    if (process.env.FAKE_COMMIT === "1") execFileSync("git", ["-C", process.env.FAKE_REPO, "-c", "user.name=fake", "-c", "user.email=f@x", "commit", "--allow-empty", "-m", "mid-build"], { stdio: "pipe" });
  } else if (target === "runtime") {
    appendFileSync(dir + "/args.jsonl", JSON.stringify(args) + "\\n");
  }
} else if (args[0] === "image") {
  const labels = { "io.runtime.component": "node-app", "io.runtime.kind": "runtime", "io.runtime.family": mode === "bad-family" ? "java-app" : "node-app", "io.runtime.compat-fingerprint": fp };
  process.stdout.write(JSON.stringify([{ Os: "linux", Architecture: arch, Config: { Labels: labels } }]));
} else if (args[0] === "run") {
  const body = mode === "bad-readback" ? { ...contract, tampered: true } : contract;
  process.stdout.write(JSON.stringify(body));
}
`;

function fakeDocker(t, root) {
  const bin = join(root, ".build/fakebin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "docker"), FAKE);
  chmodSync(join(bin, "docker"), 0o755);
  const state = join(root, ".build/fakestate");
  mkdirSync(state, { recursive: true });
  return { bin, state };
}

async function withDocker(env, fn) {
  const savedPath = process.env.PATH;
  const saved = {};
  for (const key of ["FAKE_DIR", "FAKE_MODE", "FAKE_COMMIT", "FAKE_REPO"])
    saved[key] = process.env[key];
  process.env.PATH = `${env.bin}${delimiter}${savedPath}`;
  process.env.FAKE_DIR = env.state;
  if (env.mode) process.env.FAKE_MODE = env.mode;
  if (env.commit) process.env.FAKE_COMMIT = "1";
  if (env.repo) process.env.FAKE_REPO = env.repo;
  try {
    await fn();
  } finally {
    process.env.PATH = savedPath;
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function runDir(root) {
  const runs = readdirSync(join(root, ".build/contexts/workbench/arm64"));
  assert.equal(runs.length, 1);
  return join(root, ".build/contexts/workbench/arm64", runs[0]);
}

function runtimeMeta(state) {
  const lines = readFileSync(join(state, "args.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const build = lines.find((argv) => argv.includes("runtime"));
  const raw = build.find((arg) => arg.indexOf("RUNTIME_META_JSON=") === 0);
  return JSON.parse(raw.slice("RUNTIME_META_JSON=".length));
}

test("only the runtime subcommand exists", async () => {
  await assert.rejects(() => buildWorkbenchApp({}, ["all", "--arch", "arm64"]), /Expected runtime/);
  assert.equal(await buildWorkbenchApp({}, ["--help"]), undefined);
});

test("the architecture comes only from Make", async () => {
  await assert.rejects(() => buildWorkbenchApp({}, ["runtime"]), /Required --arch/);
  await assert.rejects(
    () => buildWorkbenchApp({}, ["runtime", "--arch", "arm64", "--pack-app"]),
    /Unknown argument/,
  );
});

test("the top revision is this version's repo and any dirty source dirties it", (t) => {
  const pub = repo(t, "@ontomato/workbench");
  const ent = repo(t, "@enterprise/workbench");
  const clean = identities(pub, ent);
  assert.equal(combineIdentity(VERSION, ent, clean).dirty, false);
  writeFileSync(join(ent, LOCK_EXCLUDE), '{"schema":3}\n');
  const withLock = identities(pub, ent);
  assert.equal(combineIdentity(VERSION, ent, withLock).dirty, false);
  writeFileSync(join(pub, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n# dirty\n");
  const dirty = combineIdentity(VERSION, ent, identities(pub, ent));
  assert.equal(dirty.dirty, true);
  assert.equal(dirty.revision, sourceIdentity(VERSION, ent, LOCK_EXCLUDE).revision);
  assert.deepEqual(
    dirty.sources.map((source) => [source.id, source.dirty]),
    [["ontomato", true], ["enterprise", false]],
  );
  assert.throws(
    () => combineIdentity(VERSION, join(pub, "missing"), clean),
    /not a build source/,
  );
});

test("an early Docker failure writes no lock", async (t) => {
  const root = repo(t, "@ontomato/workbench");
  const bin = join(root, ".build/fakebin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "docker"), "#!/bin/sh\nexit 1\n");
  chmodSync(join(bin, "docker"), 0o755);
  const prior = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${prior}`;
  try {
    await assert.rejects(
      () => buildWorkbenchApp(descriptor(root), ["runtime", "--arch", "arm64"]),
      /docker version.*failed/,
    );
  } finally {
    process.env.PATH = prior;
  }
  assert.equal(existsSync(join(root, LOCK_EXCLUDE)), false);
  const context = runDir(root);
  for (const rel of [
    "sources/ontomato/package.json",
    "inputs.json",
    "tools/workbench/install-runtime.mjs",
    "tools/workbench/runtime-layout.mjs",
    "tools/build-support.mjs",
    "runtime-requirements.txt",
  ])
    assert.equal(existsSync(join(context, rel)), true, rel);
});

test("a wrong-family image fails and leaves the prior lock untouched", async (t) => {
  const pub = repo(t, "@ontomato/workbench");
  const ent = repo(t, "@enterprise/workbench");
  writeLock(ent, OLD_ARM64_FP);
  const before = readFileSync(join(ent, LOCK_EXCLUDE), "utf8");
  const docker = fakeDocker(t, ent);
  await withDocker({ ...docker, mode: "bad-family" }, async () => {
    await assert.rejects(
      () => buildWorkbenchApp(enterpriseDescriptor(pub, ent), ["runtime", "--arch", "arm64"]),
      /identity mismatch/,
    );
  });
  assert.equal(readFileSync(join(ent, LOCK_EXCLUDE), "utf8"), before);
});

test("a tampered read-back contract fails and leaves the prior lock untouched", async (t) => {
  const root = repo(t, "@ontomato/workbench");
  writeLock(root, OLD_ARM64_FP);
  const before = readFileSync(join(root, LOCK_EXCLUDE), "utf8");
  const docker = fakeDocker(t, root);
  await withDocker({ ...docker, mode: "bad-readback" }, async () => {
    await assert.rejects(
      () => buildWorkbenchApp(descriptor(root), ["runtime", "--arch", "arm64"]),
      /differs from the exported contract/,
    );
  });
  assert.equal(readFileSync(join(root, LOCK_EXCLUDE), "utf8"), before);
});

test("success saves the fingerprint for this arch only, with snapshot metadata", async (t) => {
  const pub = repo(t, "@ontomato/workbench");
  const ent = repo(t, "@enterprise/workbench");
  writeFileSync(join(pub, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n# dirty\n");
  writeLock(ent, OLD_ARM64_FP);
  const start = { ontomato: head(pub), enterprise: head(ent) };
  const docker = fakeDocker(t, ent);
  await withDocker({ ...docker, mode: "ok" }, async () => {
    await buildWorkbenchApp(enterpriseDescriptor(pub, ent), ["runtime", "--arch", "arm64"]);
  });
  const context = runDir(ent);
  const expected = fingerprint(JSON.parse(readFileSync(join(context, "contract/contract.json"), "utf8")));
  const lock = JSON.parse(readFileSync(join(ent, LOCK_EXCLUDE), "utf8"));
  assert.equal(lock.runtimes["linux/arm64"], expected);
  assert.equal(lock.runtimes["linux/amd64"], AMD64_FP);
  const record = JSON.parse(readFileSync(join(context, "inputs.json"), "utf8"));
  assert.equal(record.application, "@enterprise/workbench");
  const meta = runtimeMeta(docker.state);
  assert.equal(meta.schema, 3);
  assert.equal(meta.kind, "runtime");
  assert.equal(meta.version, VERSION);
  assert.equal(meta.revision, start.enterprise);
  assert.equal(meta.dirty, true);
  assert.deepEqual(
    meta.sources.map((source) => [source.id, source.revision, source.dirty]),
    [["ontomato", start.ontomato, true], ["enterprise", start.enterprise, false]],
  );
});

test("a source moving mid-build fails without relabeling or writing a lock", async (t) => {
  const pub = repo(t, "@ontomato/workbench");
  const ent = repo(t, "@enterprise/workbench");
  writeLock(ent, OLD_ARM64_FP);
  const before = readFileSync(join(ent, LOCK_EXCLUDE), "utf8");
  const oldHead = head(ent);
  const docker = fakeDocker(t, ent);
  await withDocker({ ...docker, mode: "ok", commit: true, repo: ent }, async () => {
    await assert.rejects(
      () => buildWorkbenchApp(enterpriseDescriptor(pub, ent), ["runtime", "--arch", "arm64"]),
      /changed during the build/,
    );
  });
  assert.notEqual(head(ent), oldHead);
  assert.equal(readFileSync(join(ent, LOCK_EXCLUDE), "utf8"), before);
  // The metadata already handed to the runtime build still carries the start
  // snapshot; it was not relabeled with the new HEAD.
  const meta = runtimeMeta(docker.state);
  assert.equal(meta.sources.find((source) => source.id === "enterprise").revision, oldHead);
});
