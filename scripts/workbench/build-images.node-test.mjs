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
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildStamp, fingerprint, sampleSources } from "../build-support.mjs";
import { buildWorkbenchApp } from "./build-images.mjs";

// The contract command resolves its YAML parser from this checkout's install.
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
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
  writeFileSync(
    join(dir, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'
importers:
  apps/workbench:
    dependencies: {}
snapshots: {}
packages: {}
`,
  );
  writeFileSync(join(dir, "LICENSE"), "fixture license\n");
  writeFileSync(join(dir, "NOTICE"), "fixture notice\n");
  writeFileSync(
    join(dir, "pom.xml"),
    `<project><properties><revision>${VERSION}</revision></properties></project>\n`,
  );
  mkdirSync(join(dir, "docker/workbench"), { recursive: true });
  writeFileSync(
    join(dir, "docker/workbench/Dockerfile.runtime"),
    "ARG NODE_RUNTIME_IMAGE=docker.io/library/node:20.18.0-slim\nARG PNPM_VERSION=9.15.4\nARG PYTHON_RUNTIME_IMAGE=docker.io/library/python:3.10-slim-bookworm\n",
  );
  writeFileSync(
    join(dir, "docker/workbench/Dockerfile.app"),
    "ARG NODE_BUILDER_IMAGE=docker.io/library/node:20.18.0\nARG PNPM_VERSION=9.15.4\n",
  );
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

function descriptor(root, component = "ontomato", runtimeImageName = "node-app-runtime") {
  return {
    repoRoot: root,
    publicRoot: root,
    lockRoot: join(root, "apps/workbench"),
    lockExclude: LOCK_EXCLUDE,
    component,
    runtimeImageName,
    workspaceId: "ontomato",
    appImporter: "apps/workbench",
    sources: [{ id: "ontomato", root }],
  };
}

function enterpriseDescriptor(pub, ent) {
  return {
    ...descriptor(ent, "data-agent", "data-agent-runtime"),
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
// that fails (ok | bad-family | bad-readback).
const FAKE = `#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const dir = process.env.FAKE_DIR;
const mode = process.env.FAKE_MODE || "ok";
const imagesFile = join(dir, "images.json");
const images = existsSync(imagesFile) ? JSON.parse(readFileSync(imagesFile, "utf8")) : {};
const save = () => writeFileSync(imagesFile, JSON.stringify(images));

function platformArch() {
  const i = args.indexOf("--platform");
  if (i >= 0) return args[i + 1].split("/")[1];
  const m = /-(amd64|arm64)$/.exec(args[args.length - 1] || "");
  return m ? m[1] : "arm64";
}
const arch = platformArch();

if (args[0] === "version") {
  process.stdout.write("25.0.0\\n");
} else if (args[0] === "buildx") {
  const target = args[args.indexOf("--target") + 1];
  if (target === "compat-contract-export") {
    // The contract stage runs the real contract command on the staged context.
    // Real path: the tool's entry guard compares it with import.meta.url, and
    // macOS temp directories sit behind the /var -> /private/var link.
    const context = realpathSync(args[args.length - 1]);
    const out = args[args.indexOf("--output") + 1].replace("type=local,dest=", "");
    mkdirSync(out, { recursive: true });
    const contract = execFileSync(process.execPath, [join(context, "tools/workbench/runtime-contract.mjs"), "contract", context, arch], {
      env: { ...process.env, NODE_PATH: process.env.FAKE_NODE_PATH },
    });
    writeFileSync(join(out, "contract.json"), contract);
  } else if (target === "runtime") {
    appendFileSync(dir + "/args.jsonl", JSON.stringify(args) + "\\n");
    const labels = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--label") {
        const l = args[i + 1];
        const at = l.indexOf("=");
        labels[l.slice(0, at)] = l.slice(at + 1);
      }
    }
    if (mode === "bad-family") labels["io.runtime.family"] = "java-app";
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-t") images[args[i + 1]] = labels;
    }
    save();
  }
} else if (args[0] === "image") {
  const tag = args[args.length - 1];
  const labels = images[tag] || { "io.runtime.component": "node-app", "io.runtime.kind": "runtime", "io.runtime.family": mode === "bad-family" ? "java-app" : "node-app" };
  process.stdout.write(JSON.stringify([{ Os: "linux", Architecture: arch, Config: { Labels: labels } }]));
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
  for (const key of ["FAKE_DIR", "FAKE_MODE", "FAKE_NODE_PATH"]) saved[key] = process.env[key];
  process.env.PATH = `${env.bin}${delimiter}${savedPath}`;
  process.env.FAKE_NODE_PATH = join(REPO_ROOT, "node_modules");
  process.env.FAKE_DIR = env.state;
  if (env.mode) process.env.FAKE_MODE = env.mode;
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

// The builder's contexts are fixed per command; no per-run directory remains.
function contextDir(root, part) {
  return join(root, ".build/contexts/workbench/arm64", part);
}

function runtimeMeta(state) {
  const lines = readFileSync(join(state, "args.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const build = lines.find((argv) => argv.includes("runtime"));
  const raw = build.find((arg) => arg.indexOf("RUNTIME_META_JSON=") === 0);
  return JSON.parse(raw.slice("RUNTIME_META_JSON=".length));
}

test("only the runtime and app subcommands exist", async () => {
  await assert.rejects(() => buildWorkbenchApp({}, ["all", "--arch", "arm64"]), /Expected runtime or app/);
  await assert.rejects(
    () => buildWorkbenchApp({}, ["application", "--arch", "arm64"]),
    /Expected runtime or app/,
  );
  assert.equal(await buildWorkbenchApp({}, ["--help"]), undefined);
});

test("the architecture comes only from Make", async () => {
  await assert.rejects(() => buildWorkbenchApp({}, ["runtime"]), /Required --arch/);
  await assert.rejects(() => buildWorkbenchApp({}, ["app"]), /Required --arch/);
  await assert.rejects(
    () => buildWorkbenchApp({}, ["runtime", "--arch", "arm64", "--pack-app"]),
    /does not match build action/,
  );
  await assert.rejects(
    () => buildWorkbenchApp({}, ["app", "--arch", "arm64", "--pack-runtime"]),
    /does not match build action/,
  );
  await assert.rejects(
    () => buildWorkbenchApp({}, ["app", "--arch", "arm64", "--bogus"]),
    /Unknown argument/,
  );
});

test("the stamp takes this version's app repo and any dirty source dirties it", (t) => {
  const pub = repo(t, "@ontomato/workbench");
  const ent = repo(t, "@enterprise/workbench");
  const app = enterpriseDescriptor(pub, ent);
  const stamp = () => buildStamp(VERSION, ent, sampleSources(app));
  assert.match(stamp(), new RegExp(`^${VERSION}-\\d{8}-\\d{6}-g${head(ent).slice(0, 12)}$`));
  // The builder's own lock is excluded from its source and never dirties it.
  writeFileSync(join(ent, LOCK_EXCLUDE), '{"schema":3}\n');
  assert.doesNotMatch(stamp(), /-dirty$/);
  // A dirty public source dirties the whole stamp, not just its own source.
  writeFileSync(join(pub, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n# dirty\n");
  assert.match(stamp(), new RegExp(`^${VERSION}-\\d{8}-\\d{6}-g${head(ent).slice(0, 12)}-dirty$`));
  assert.throws(
    () => buildStamp(VERSION, join(pub, "missing"), sampleSources(app)),
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
      /docker buildx build failed/,
    );
  } finally {
    process.env.PATH = prior;
  }
  assert.equal(existsSync(join(root, LOCK_EXCLUDE)), false);
  const context = contextDir(root, "runtime");
  for (const rel of [
    "sources/ontomato/package.json",
    "inputs.json",
    "tools/workbench/install-runtime.mjs",
    "tools/workbench/runtime-layout.mjs",
    "tools/build-support.mjs",
    "tools/third_party_notices.py",
    "runtime-requirements.txt",
    "LICENSE",
    "NOTICE",
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

test("success saves the fingerprint for this arch only, with pairing metadata", async (t) => {
  const pub = repo(t, "@ontomato/workbench");
  const ent = repo(t, "@enterprise/workbench");
  writeLock(ent, OLD_ARM64_FP);
  const docker = fakeDocker(t, ent);
  await withDocker({ ...docker, mode: "ok" }, async () => {
    await buildWorkbenchApp(enterpriseDescriptor(pub, ent), ["runtime", "--arch", "arm64"]);
  });
  const context = contextDir(ent, "runtime");
  const lock = JSON.parse(readFileSync(join(ent, LOCK_EXCLUDE), "utf8"));
  const expected = lock.runtimes["linux/arm64"];
  assert.ok(/^[a-f0-9]{64}$/.test(expected));
  assert.equal(lock.runtimes["linux/amd64"], AMD64_FP);
  const record = JSON.parse(readFileSync(join(context, "inputs.json"), "utf8"));
  assert.equal(record.application, "@enterprise/workbench");
  const meta = runtimeMeta(docker.state);
  assert.deepEqual(Object.keys(meta).sort(), [
    "arch",
    "family",
    "kind",
    "platform",
    "runtimeCompatFingerprint",
    "schema",
  ]);
  assert.equal(meta.schema, 3);
  assert.equal(meta.kind, "runtime");
  assert.equal(meta.platform, "linux/arm64");
  assert.equal(meta.runtimeCompatFingerprint, expected);
  const build = readFileSync(join(docker.state, "args.jsonl"), "utf8").trim().split("\n").map(JSON.parse).find((argv) => argv.includes("runtime"));
  const tags = build.filter((arg, i) => build[i - 1] === "-t");
  assert.deepEqual(tags, [`node-app-runtime:compat-${expected.slice(0, 16)}-arm64`, "data-agent-runtime:deploy-arm64"]);
});

test("the runtime package is named after the product's runtime image name", async (t) => {
  const root = repo(t, "@ontomato/workbench");
  const docker = fakeDocker(t, root);
  await withDocker({ ...docker, mode: "ok" }, async () => {
    await buildWorkbenchApp(descriptor(root), ["runtime", "--arch", "arm64", "--pack-runtime"]);
  });
  const fp = JSON.parse(readFileSync(join(root, LOCK_EXCLUDE), "utf8")).runtimes["linux/arm64"];
  assert.deepEqual(readdirSync(join(root, ".build/pack")), [`node-app-runtime-compat-${fp.slice(0, 16)}-arm64.tar.gz`]);
});
