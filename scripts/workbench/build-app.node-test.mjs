import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildWorkbenchApp } from "./build-images.mjs";
import { fingerprint } from "../build-support.mjs";
import { collectMetadataContext, copyWorkspace } from "../pnpm-workspace-context.mjs";
import { assembleAppStage, stageDirectory } from "./stage-app.mjs";

const VERSION = "9.9.9-test";
const LOCK_EXCLUDE = "apps/workbench/runtime-lock.json";
const CONTRACT = {
  family: "node-app",
  interfaceVersion: 3,
  platform: "linux/arm64",
  node: "20.18",
  pnpm: "9.15.4",
  productionDependencies: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  python: {
    version: "3.10",
    packages: { numpy: "1.26.4", pandas: "1.5.3" },
  },
};

function repo(t, appName) {
  const dir = mkdtempSync(join(tmpdir(), "p4-n5a-"));
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
  writeFileSync(join(dir, "docker/workbench/launch.sh"), "#!/bin/sh\nexec node app\n");
  mkdirSync(join(dir, "apps/workbench"), { recursive: true });
  writeFileSync(
    join(dir, "apps/workbench/package.json"),
    `${JSON.stringify({ name: appName })}\n`,
  );
  git(["add", "."]);
  git(["-c", "user.name=n5a", "-c", "user.email=n5a@t", "commit", "-m", "init"]);
  return dir;
}

function descriptor(pub, ent = null) {
  if (!ent)
    return {
      repoRoot: pub, publicRoot: pub, lockRoot: join(pub, "apps/workbench"),
      lockExclude: LOCK_EXCLUDE, component: "ontomato", runtimeImageName: "node-app-runtime",
      workspaceId: "ontomato", appImporter: "apps/workbench",
      sources: [{ id: "ontomato", root: pub }],
    };
  return {
    repoRoot: ent, publicRoot: pub, lockRoot: join(ent, "apps/workbench"),
    lockExclude: LOCK_EXCLUDE, component: "data-agent", runtimeImageName: "data-agent-runtime",
    workspaceId: "enterprise", appImporter: "apps/workbench",
    sources: [{ id: "ontomato", root: pub }, { id: "enterprise", root: ent }],
  };
}

function writeLock(dir, arm64Fp = fingerprint(CONTRACT)) {
  writeFileSync(
    join(dir, LOCK_EXCLUDE),
    `${JSON.stringify({ schema: 3, family: "node-app", runtimes: { "linux/arm64": arm64Fp } }, null, 2)}\n`,
  );
}

// Fixture Docker for the app command. Every invocation is recorded; an
// unknown subcommand fails instead of silently succeeding. FAKE_MODE selects
// ok | fail-build | fail-inspect.
const FAKE = `#!/usr/bin/env node
import { createHash } from "node:crypto";
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
const contract = JSON.parse(process.env.FAKE_CONTRACT);
const fp = createHash("sha256").update(canonical(contract)).digest("hex");
mkdirSync(dir, { recursive: true });
appendFileSync(dir + "/args.jsonl", JSON.stringify(args) + "\\n");
if (args[0] === "version") {
  process.stdout.write("25.0.0\\n");
} else if (args[0] === "buildx") {
  const target = args.includes("--target") ? args[args.indexOf("--target") + 1] : undefined;
  if (target === "compat-contract-export") {
    // The contract stage's output: this fixture's contract for the lock's arch.
    const out = args[args.indexOf("--output") + 1].replace("type=local,dest=", "");
    mkdirSync(out, { recursive: true });
    writeFileSync(out + "/contract.json", JSON.stringify(contract));
  } else if (mode === "fail-build") process.exit(1);
} else if (args[0] === "image") {
  // The app command inspects only the app image it built.
  const tag = args[args.length - 1];
  const component = tag.match(/^(.*)-app:/)[1];
  const broken = mode === "fail-inspect";
  const labels = { "io.runtime.component": component, "io.runtime.kind": "app", "io.runtime.family": broken ? "java-app" : "node-app", "io.runtime.compat-fingerprint": broken ? "0".repeat(64) : fp };
  process.stdout.write(JSON.stringify([{ Os: "linux", Architecture: "arm64", Config: { Labels: labels } }]));
} else if (args[0] === "save") {
  process.stdout.write("fake-app-image-bytes");
} else {
  process.stderr.write("unknown docker call\\n");
  process.exit(1);
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
  for (const key of ["FAKE_DIR", "FAKE_MODE", "FAKE_CONTRACT"])
    saved[key] = process.env[key];
  process.env.PATH = `${env.bin}${delimiter}${savedPath}`;
  process.env.FAKE_DIR = env.state;
  process.env.FAKE_MODE = env.mode;
  process.env.FAKE_CONTRACT = JSON.stringify(CONTRACT);
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

function calls(state) {
  return readFileSync(join(state, "args.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
}

function metaArg(argv) {
  const raw = argv.find((arg) => arg.indexOf("APP_META_JSON=") === 0);
  return JSON.parse(raw.slice("APP_META_JSON=".length));
}

test("stage directories drop the build-time source prefix", () => {
  assert.equal(stageDirectory("apps/workbench"), "apps/workbench");
  assert.equal(stageDirectory("../ontomato/apps/workbench"), "apps/workbench");
  assert.equal(stageDirectory("../enterprise/packages/a"), "packages/a");
  assert.throws(() => stageDirectory("../.."), /outside the stage/);
  assert.throws(() => stageDirectory("../../a"), /outside the stage/);
  assert.throws(() => stageDirectory("/app"), /outside the stage/);
});

test("a missing lock fails before any Docker call", async (t) => {
  const root = repo(t, "@ontomato/workbench");
  const docker = fakeDocker(t, root);
  await withDocker({ ...docker, mode: "ok" }, async () => {
    await assert.rejects(
      () => buildWorkbenchApp(descriptor(root), ["app", "--arch", "arm64"]),
      /missing/,
    );
  });
  assert.equal(existsSync(join(root, LOCK_EXCLUDE)), false);
  assert.equal(existsSync(join(docker.state, "args.jsonl")), false);
});

test("a changed dependency or contract fails without touching the lock", async (t) => {
  const root = repo(t, "@ontomato/workbench");
  writeLock(root, "0".repeat(64));
  const before = readFileSync(join(root, LOCK_EXCLUDE), "utf8");
  const docker = fakeDocker(t, root);
  await withDocker({ ...docker, mode: "ok" }, async () => {
    await assert.rejects(
      () => buildWorkbenchApp(descriptor(root), ["app", "--arch", "arm64"]),
      /Runtime dependencies or contract changed/,
    );
  });
  assert.equal(readFileSync(join(root, LOCK_EXCLUDE), "utf8"), before);
});

test("a late build failure writes no lock and no pack", async (t) => {
  const root = repo(t, "@ontomato/workbench");
  writeLock(root);
  const before = readFileSync(join(root, LOCK_EXCLUDE), "utf8");
  const docker = fakeDocker(t, root);
  await withDocker({ ...docker, mode: "fail-build" }, async () => {
    await assert.rejects(
      () => buildWorkbenchApp(descriptor(root), ["app", "--arch", "arm64", "--pack-app"]),
      /failed/,
    );
  });
  assert.equal(readFileSync(join(root, LOCK_EXCLUDE), "utf8"), before);
  assert.equal(existsSync(join(root, ".build/pack")), false);
});

test("success packs and keeps the runtime lock, writing only the pairing metadata", async (t) => {
  const pub = repo(t, "@ontomato/workbench");
  const ent = repo(t, "@enterprise/workbench");
  for (const [root, app] of [[pub, descriptor(pub)], [ent, descriptor(pub, ent)]]) {
    writeLock(root);
    const before = readFileSync(join(root, LOCK_EXCLUDE), "utf8");
    const docker = fakeDocker(t, root);
    await withDocker({ ...docker, mode: "ok" }, async () => {
      await buildWorkbenchApp(app, ["app", "--arch", "arm64", "--pack-app"]);
    });
    assert.equal(readFileSync(join(root, LOCK_EXCLUDE), "utf8"), before);
    const tars = readdirSync(join(root, ".build/pack"));
    assert.equal(tars.some((name) => name.startsWith(`${app.component}-app-${VERSION}-`)), true);
    const buildArgv = calls(docker.state).find((argv) => argv.includes("--load"));
    const workspaceArg = buildArgv.find((arg) => arg.startsWith("WORKSPACE="));
    assert.equal(workspaceArg, `WORKSPACE=${app.workspaceId}`);
    // The web notices list the selected application's workspace closure.
    const applicationArg = buildArgv.find((arg) => arg.startsWith("APPLICATION="));
    assert.equal(applicationArg, `APPLICATION=${root === pub ? "@ontomato" : "@enterprise"}/workbench`);
    const meta = metaArg(buildArgv);
    assert.deepEqual(Object.keys(meta).sort(), [
      "arch",
      "family",
      "kind",
      "platform",
      "runtimeCompatFingerprint",
      "schema",
    ]);
    assert.equal(meta.schema, 3);
    assert.equal(meta.kind, "app");
    assert.equal(meta.platform, "linux/arm64");
    assert.equal(meta.runtimeCompatFingerprint, fingerprint(CONTRACT));
    const argv = calls(docker.state);
    const builds = argv.filter((call) => call[0] === "buildx");
    assert.equal(builds.length, 2);
    assert.equal(builds[0][builds[0].indexOf("--target") + 1], "compat-contract-export");
    assert.equal(builds[1].includes("--target"), false);
  }
});

test("the public entry names the ontomato product and the node-app-runtime alias", async () => {
  const { app } = await import("../../apps/workbench/build.mjs");
  assert.equal(app.component, "ontomato");
  assert.equal(app.runtimeImageName, "node-app-runtime");
  assert.deepEqual(app.sources.map((source) => source.id), ["ontomato"]);
});

test("a late inspect failure writes no lock and no pack", async (t) => {
  const root = repo(t, "@ontomato/workbench");
  writeLock(root);
  const before = readFileSync(join(root, LOCK_EXCLUDE), "utf8");
  const docker = fakeDocker(t, root);
  await withDocker({ ...docker, mode: "fail-inspect" }, async () => {
    await assert.rejects(
      () => buildWorkbenchApp(descriptor(root), ["app", "--arch", "arm64", "--pack-app"]),
      /identity mismatch/,
    );
  });
  assert.equal(readFileSync(join(root, LOCK_EXCLUDE), "utf8"), before);
  assert.equal(existsSync(join(root, ".build/pack")), false);
});

test("workspace copies reuse the collector listing and live source bytes", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "p4-n5a-ws-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (args) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
  git(["init"]);
  writeFileSync(join(dir, ".gitignore"), ".build/\n.env.local\ndist/\nsecret-conf/\n");
  const tracked = [
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "apps/workbench/src/index.ts",
    "packages/lib/src/index.ts",
    "packages/lib/prompts/keep.md",
    "apps/data-engine/pom.xml",
    "apps/data-engine/src/x.java",
    "README.md",
    "docs/guide.md",
  ];
  for (const rel of tracked) {
    mkdirSync(join(dir, rel.slice(0, rel.lastIndexOf("/"))), { recursive: true });
    writeFileSync(join(dir, rel), `${rel}\n`);
  }
  writeFileSync(join(dir, "apps/workbench/package.json"), '{"name":"@probe/app"}\n');
  writeFileSync(join(dir, "packages/lib/package.json"), '{"name":"@probe/lib"}\n');
  git(["add", "."]);
  git(["-c", "user.name=n5a", "-c", "user.email=n5a@t", "commit", "-m", "init"]);
  mkdirSync(join(dir, "apps/workbench/src"), { recursive: true });
  writeFileSync(join(dir, "apps/workbench/src/new.ts"), "new\n");
  writeFileSync(join(dir, ".env"), "S=E\n");
  writeFileSync(join(dir, ".env.local"), "S=L\n");
  mkdirSync(join(dir, "node_modules/evil"), { recursive: true });
  writeFileSync(join(dir, "node_modules/evil/f.js"), "j\n");
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist/x.js"), "x\n");
  mkdirSync(join(dir, "secret-conf"), { recursive: true });
  writeFileSync(join(dir, "secret-conf/y"), "y\n");
  const app = { sources: [{ id: "ontomato", root: dir }] };
  const ctx = join(dir, ".build/ctx");
  const record = collectMetadataContext({
    sources: app.sources,
    workspaceId: "ontomato",
    appImporter: "apps/workbench",
    destination: ctx,
  });
  // Live edits after collection: the workspace copy must follow the captured
  // metadata, never a second live read.
  writeFileSync(join(dir, "apps/workbench/package.json"), '{"name":"changed"}\n');
  writeFileSync(join(dir, "packages/lib/package.json"), '{"name":"changed-lib"}\n');
  writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n# changed\n");
  writeFileSync(join(dir, "packages/lib/src/index.ts"), "changed\n");
  copyWorkspace(app, ctx, record);
  const at = (rel) => join(ctx, "workspace/ontomato", rel);
  const captured = (rel) => readFileSync(join(ctx, "sources/ontomato", rel), "utf8");
  // Root and member metadata both follow the collector's captured bytes.
  for (const rel of ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "apps/workbench/package.json", "packages/lib/package.json"])
    assert.equal(readFileSync(at(rel), "utf8"), captured(rel));
  // Owned sources follow the live tree (the record only scopes them); the
  // metadata scoping above is the consistency guard.
  assert.equal(readFileSync(at("packages/lib/src/index.ts"), "utf8"), "changed\n");
  const cases = [
    ["apps/workbench/src/index.ts", true],
    ["apps/workbench/src/new.ts", true],
    ["packages/lib/src/index.ts", true],
    ["packages/lib/prompts/keep.md", true],
    ["README.md", false],
    ["docs/guide.md", false],
    [".env", false],
    [".env.local", false],
    ["node_modules/evil/f.js", false],
    ["dist/x.js", false],
    ["secret-conf/y", false],
    ["apps/data-engine/pom.xml", false],
    ["apps/data-engine/src/x.java", false],
  ];
  for (const [rel, present] of cases) assert.equal(existsSync(at(rel)), present, rel);
});

test("the app recipe declares its stage arguments and launch permissions", () => {
  const recipe = readFileSync(
    fileURLToPath(new URL("../../docker/workbench/Dockerfile.app", import.meta.url)),
    "utf8",
  );
  const stage = recipe.slice(recipe.indexOf("AS web-builder"));
  assert.match(stage, /\nARG WORKSPACE=/);
  assert.match(stage, /\nARG APP_META_JSON/);
  assert.match(stage, /\nARG APPLICATION\n/);
  assert.match(recipe, /chmod 0755 \/stage\/launch\.sh/);
  const [builder, final] = recipe.split("FROM scratch AS app");
  const sources = [...builder.matchAll(/^COPY\s+(\S+)/gm)].map((match) => match[1]);
  assert.deepEqual(sources, ["workspace/", "inputs.json", "tools/", "launch.sh", "LICENSE"]);
  assert.match(final, /COPY --from=web-builder \/stage\/ \//);
});

test("assemble writes own packages, resources, links, web and meta from a real graph", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "p4-n5a-assemble-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ent = join(dir, "enterprise");
  const pub = join(dir, "ontomato");
  const lock = {
    lockfileVersion: "9.0",
    importers: {
      "apps/workbench": {
        dependencies: {
          express: { specifier: "^4.0.0", version: "express@4.22.1" },
          "@enterprise/lib": { specifier: "workspace:*", version: "link:../../packages/ent-lib" },
        },
      },
      "packages/ent-lib": {
        dependencies: {
          express: { specifier: "^4.0.0", version: "express@4.22.1" },
          "@ontomato/shared": { specifier: "workspace:*", version: "link:../../../ontomato/packages/shared" },
        },
        optionalDependencies: { "@probe/native": { specifier: "^1.0.0", version: "@probe/native@1.0.0" } },
      },
      "../ontomato/packages/shared": {
        dependencies: { express: { specifier: "^4.0.0", version: "express@4.22.1" } },
      },
    },
    packages: {
      "express@4.22.1": {
        resolution: { integrity: "sha512-abc" },
        os: ["linux"],
        cpu: ["arm64", "x64"],
      },
      "@probe/native@1.0.0": {
        resolution: { integrity: "sha512-native" },
        os: ["linux"],
        cpu: ["arm64"],
      },
    },
    snapshots: {
      "express@4.22.1": { dependencies: {} },
      "@probe/native@1.0.0": { dependencies: {} },
    },
  };
  const manifests = {
    "apps/workbench": {
      name: "@enterprise/workbench",
      dependencies: { express: "^4.0.0", "@enterprise/lib": "workspace:*" },
    },
    "packages/ent-lib": {
      name: "@enterprise/lib",
      dependencies: { express: "^4.0.0", "@ontomato/shared": "workspace:*" },
      optionalDependencies: { "@probe/native": "^1.0.0" },
    },
    "../ontomato/packages/shared": {
      name: "@ontomato/shared",
      dependencies: { express: "^4.0.0" },
    },
  };
  const members = [];
  const own = (root, importer, body) => {
    const absolute = join(root, importer);
    mkdirSync(join(absolute, "src"), { recursive: true });
    writeFileSync(join(absolute, "package.json"), `${JSON.stringify(manifests[importer])}\n`);
    writeFileSync(join(absolute, "src/index.ts"), `${body}\n`);
    members.push({ name: manifests[importer].name, path: importer, absolute, manifest: manifests[importer] });
  };
  own(ent, "apps/workbench", "enterprise");
  own(ent, "packages/ent-lib", "lib");
  own(ent, "../ontomato/packages/shared", "shared");
  for (const [base, rel] of [
    [pub, "packages/shared/skills/SKILL.md"],
    [pub, "packages/shared/data/knowledge/index.md"],
    [ent, "packages/ent-lib/resources/prompts/system.md"],
  ]) {
    mkdirSync(dirname(join(base, rel)), { recursive: true });
    writeFileSync(join(base, rel), "resource\n");
  }
  mkdirSync(join(ent, "packages/ent-lib/prompts"), { recursive: true });
  writeFileSync(join(ent, "packages/ent-lib/prompts/keep.md"), "keep\n");
  mkdirSync(join(ent, "packages/ent-lib/data"), { recursive: true });
  writeFileSync(join(ent, "packages/ent-lib/data/keep.json"), "{}\n");
  writeFileSync(join(ent, "packages/ent-lib/data/.env"), "S=E\n");
  mkdirSync(join(ent, "packages/ent-lib/src/node_modules/nested"), { recursive: true });
  writeFileSync(join(ent, "packages/ent-lib/src/node_modules/nested/f.js"), "j\n");
  mkdirSync(join(ent, "dist/web"), { recursive: true });
  writeFileSync(join(ent, "dist/web/index.html"), "<html>\n");
  // Same-mapped-dir OSS decoy: a member pnpm could report, but outside the
  // production selection, so it must never reach the payload.
  const ossDecoy = join(pub, "apps/workbench");
  mkdirSync(join(ossDecoy, "src"), { recursive: true });
  writeFileSync(join(ossDecoy, "package.json"), '{"name":"@ontomato/workbench"}\n');
  writeFileSync(join(ossDecoy, "src/index.ts"), "oss\n");
  members.push({ name: "@ontomato/workbench", path: "../ontomato/apps/workbench", absolute: ossDecoy, manifest: { name: "@ontomato/workbench" } });
  const store = ent;
  const expressDir = join(store, "node_modules/.pnpm/express@4.22.1/node_modules/express");
  const nativeDir = join(store, "node_modules/.pnpm/@probe+native@1.0.0/node_modules/@probe/native");
  mkdirSync(expressDir, { recursive: true });
  mkdirSync(nativeDir, { recursive: true });

  const linkDep = (pkgDir, name, target) => {
    const dest = join(pkgDir, "node_modules", name);
    mkdirSync(dirname(dest), { recursive: true });
    symlinkSync(target, dest);
  };
  linkDep(join(ent, "apps/workbench"), "express", expressDir);
  linkDep(join(ent, "packages/ent-lib"), "express", expressDir);
  linkDep(join(ent, "packages/ent-lib"), "@probe/native", nativeDir);
  linkDep(join(pub, "packages/shared"), "express", expressDir);

  const record = { workspaceId: "enterprise", appImporter: "apps/workbench", application: "@enterprise/workbench" };
  // Mirrors pnpm --filter-prod <app>... : only closure members are selected.
  const selected = members.filter((member) => member.name !== "@ontomato/workbench");
  // The stager reads only the target platform from the metadata and copies the
  // rest through; link paths come from its own install (bindingIndex).
  const metaFor = (platform) => ({ platform, runtimeCompatFingerprint: "c".repeat(64) });
  const armStage = join(dir, "stage-arm64");
  const assembled = assembleAppStage({
    root: ent, stageRoot: armStage, storeRoot: store, record,
    meta: metaFor("linux/arm64"), lock, members, selected,
  });
  assert.equal(assembled.copies.length, 3);
  assert.equal(readFileSync(join(armStage, "apps/workbench/src/index.ts"), "utf8"), "enterprise\n");
  assert.equal(existsSync(join(armStage, "ontomato")), false);
  assert.equal(existsSync(join(armStage, "enterprise")), false);
  assert.equal(readFileSync(join(armStage, "packages/shared/src/index.ts"), "utf8"), "shared\n");
  for (const rel of ["packages/shared/skills/SKILL.md", "packages/shared/data/knowledge/index.md", "packages/ent-lib/resources/prompts/system.md"])
    assert.equal(readFileSync(join(armStage, rel), "utf8"), "resource\n");
  assert.equal(
    realpathSync(join(armStage, "packages/ent-lib/node_modules/@ontomato/shared")),
    realpathSync(join(armStage, "packages/shared")),
  );
  assert.equal(existsSync(join(armStage, "packages/ent-lib/prompts/keep.md")), true);
  assert.equal(existsSync(join(armStage, "packages/ent-lib/data/keep.json")), true);
  assert.equal(existsSync(join(armStage, "packages/ent-lib/data/.env")), false);
  assert.equal(existsSync(join(armStage, "packages/ent-lib/src/node_modules")), false);
  assert.equal(existsSync(join(armStage, "dist/web/index.html")), true);
  assert.deepEqual(JSON.parse(readFileSync(join(armStage, ".image-meta.json"), "utf8")), metaFor("linux/arm64"));
  assert.equal(
    realpathSync(join(armStage, "apps/workbench/node_modules/express")),
    realpathSync(expressDir),
  );
  assert.equal(
    realpathSync(join(armStage, "packages/ent-lib/node_modules/@probe/native")),
    realpathSync(nativeDir),
  );
  assert.equal(
    realpathSync(join(armStage, "apps/workbench/node_modules/@enterprise/lib")),
    realpathSync(join(armStage, "packages/ent-lib")),
  );

  // Opposite target: the optional arm64-only native is skipped, the rest holds.
  const amdStage = join(dir, "stage-amd64");
  assembleAppStage({
    root: ent, stageRoot: amdStage, storeRoot: store, record,
    meta: metaFor("linux/amd64"), lock, members, selected,
  });
  assert.equal(existsSync(join(amdStage, "apps/workbench/node_modules/express")), true);
  assert.equal(existsSync(join(amdStage, "packages/ent-lib/node_modules/@probe/native")), false);

  // Wrong expected fingerprint, platform mismatch, missing index, an
  // arm64-only closure for an amd64 target, and a partial selection all fail.
  const armOnlyLock = {
    ...lock,
    packages: {
      ...lock.packages,
      "express@4.22.1": { ...lock.packages["express@4.22.1"], cpu: ["arm64"] },
    },
  };
  const failures = [
    [{ meta: { platform: "linux/amd64", runtimeCompatFingerprint: "0".repeat(64) }, lock: armOnlyLock }, /not linux/],
    [{ selected: selected.slice(0, 1) }, /differs from the graph closure/],
  ];
  let stageNo = 0;
  for (const [override, pattern] of failures) {
    stageNo += 1;
    assert.throws(
      () =>
        assembleAppStage({
          root: ent,
          stageRoot: join(dir, `s${stageNo}`),
          storeRoot: store,
          record,
          meta: metaFor("linux/arm64"),
          lock,
          members,
          selected,
          ...override,
        }),
      pattern,
    );
  }
});
