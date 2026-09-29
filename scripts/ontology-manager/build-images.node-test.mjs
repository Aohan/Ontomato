import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { exportImage } from "../build-support.mjs";
import { buildManagerImage } from "./build-images.mjs";

// This proves only that the builder hands Docker the agreed context and CLI
// input; real pnpm install, vite build and image contents are verified by a
// real Linux build, never here.
const VERSION = "9.9.9-test";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RECIPE = "docker/ontology-manager";
const RUNTIME_FILES = ["config.js.template", "nginx.conf.template", "docker-entrypoint.sh"];

function text(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}
const json = (path, value) => text(path, `${JSON.stringify(value)}\n`);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Local identity only; the user's Git configuration is never touched.
function git(root, ...args) {
  return execFileSync(
    "git",
    ["-C", root, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...args],
    { encoding: "utf8" },
  ).trim();
}

function repository(root, files) {
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  text(join(root, ".gitignore"), "node_modules/\n.build/\n");
  text(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n  - "apps/*"\n');
  text(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  for (const [rel, value] of Object.entries(files)) text(join(root, rel), value);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "fixture");
}

// Two adjacent repos named like the real checkouts. The public one carries
// the real recipe files and, for entry runs, the real builder and entry.
function fixture(t) {
  // Real path: the entry resolves its roots from its own module URL.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "p4-m3a-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const publicRoot = join(dir, "ontomato");
  const privateRoot = join(dir, "enterprise");
  const recipe = Object.fromEntries(
    ["Dockerfile", ...RUNTIME_FILES].map((name) => [
      `${RECIPE}/${name}`,
      readFileSync(join(REPO, RECIPE, name)),
    ]),
  );
  const real = Object.fromEntries(
    [
      "scripts/build-support.mjs",
      "scripts/pnpm-workspace-context.mjs",
      "scripts/ontology-manager/build-images.mjs",
      "apps/ontology-manager/build.mjs",
      "LICENSE",
      "NOTICE",
      "scripts/third_party_notices.py",
    ].map((rel) => [rel, readFileSync(join(REPO, rel))]),
  );
  repository(publicRoot, {
    ...recipe,
    ...real,
    "package.json": '{"name":"ontomato","private":true}\n',
    "pom.xml": `<project><properties><revision>${VERSION}</revision></properties></project>\n`,
    "apps/ontology-manager/package.json": '{"name":"@ontomato/ontology-manager-app"}\n',
    "apps/ontology-manager/src/main.ts": "export const shell = 1;\n",
    "apps/ontology-manager/src/__tests__/shell.test.ts": "test;\n",
    "apps/ontology-manager/README.md": "# doc\n",
    "packages/ontology-manager/package.json": '{"name":"@ontomato/ontology-manager"}\n',
    "packages/ontology-manager/src/index.ts": "export {};\n",
    "apps/workbench/package.json": '{"name":"@ontomato/workbench"}\n',
    "apps/workbench/src/server.ts": "export {};\n",
    "packages/core/package.json": '{"name":"@ontomato/core"}\n',
    "packages/core/src/core.ts": "export {};\n",
  });
  repository(privateRoot, {
    "package.json": '{"name":"enterprise","private":true}\n',
    "apps/ontology-manager/package.json": '{"name":"@enterprise/ontology-manager-app"}\n',
    "apps/ontology-manager/src/main.ts": "export const enterprise = 1;\n",
    "apps/workbench/package.json": '{"name":"@enterprise/workbench"}\n',
    "apps/workbench/src/server.ts": "export {};\n",
  });
  return { dir, publicRoot, privateRoot };
}

// Same shape as the private entry; the private repo's own entry is run
// against the real checkouts in the batch evidence, not from this public test.
function enterpriseApp({ publicRoot, privateRoot }) {
  return {
    repoRoot: privateRoot,
    publicRoot,
    component: "ontology-manager",
    workspaceId: "enterprise",
    appImporter: "apps/ontology-manager",
    sources: [
      { id: "ontomato", root: publicRoot },
      { id: "enterprise", root: privateRoot },
    ],
    owners: {
      ontomato: ["apps/ontology-manager", "packages/ontology-manager"],
      enterprise: ["apps/ontology-manager"],
    },
  };
}

// Minimal fixture Docker for this builder's calls only. buildx records its
// argv and the real context file set, and stores the passed labels; image
// inspect returns them, altered by FAKE_MODE; save emits a few bytes.
// FAKE_COMMIT_REPO commits once there during buildx (a source moving mid-build).
const FAKE = `#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const state = process.env.FAKE_STATE;
const mode = process.env.FAKE_MODE || "ok";
appendFileSync(join(state, "calls.jsonl"), JSON.stringify(args) + "\\n");
function files(root, prefix) {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix === "" ? entry.name : prefix + "/" + entry.name;
    return entry.isDirectory() ? files(root, rel) : [rel];
  });
}
if (args[0] === "version") {
  process.stdout.write("1.47\\n");
} else if (args[0] === "buildx") {
  const context = args[args.length - 1];
  const listing = files(context, "").sort().map((path) => ({ path, sha256: createHash("sha256").update(readFileSync(join(context, path))).digest("hex") }));
  writeFileSync(join(state, "context.json"), JSON.stringify({ context, files: listing }));
  const labels = {};
  for (let i = 0; i < args.length; i += 1)
    if (args[i] === "--label") { const at = args[i + 1].indexOf("="); labels[args[i + 1].slice(0, at)] = args[i + 1].slice(at + 1); }
  const arch = args[args.indexOf("--platform") + 1].split("/")[1];
  writeFileSync(join(state, "image.json"), JSON.stringify({ Os: "linux", Architecture: arch, Config: { Labels: labels } }));
  if (process.env.FAKE_COMMIT_REPO) execFileSync("git", ["-C", process.env.FAKE_COMMIT_REPO, "-c", "user.name=fake", "-c", "user.email=fake@example.invalid", "commit", "-q", "--allow-empty", "-m", "mid-build"]);
} else if (args[0] === "image") {
  if (mode === "missing") { process.stderr.write("Error: No such image\\n"); process.exit(1); }
  const image = JSON.parse(readFileSync(join(state, "image.json"), "utf8"));
  const labels = image.Config.Labels;
  if (mode === "os") image.Os = "windows";
  if (mode === "arch") image.Architecture = image.Architecture === "arm64" ? "amd64" : "arm64";
  if (mode === "kind") labels["io.runtime.kind"] = "app";
  if (mode === "component") labels["io.runtime.component"] = "other";
  if (mode === "version") labels["org.opencontainers.image.version"] = "0.0.0";
  if (mode === "revision") labels["org.opencontainers.image.revision"] = "0".repeat(40);
  if (mode === "dirty") labels["io.runtime.source.dirty"] = String(labels["io.runtime.source.dirty"] !== "true");
  if (mode === "sources") labels["io.runtime.sources"] = "[]";
  if (mode === "no-sources") delete labels["io.runtime.sources"];
  process.stdout.write(JSON.stringify([image]));
} else if (args[0] === "save") {
  process.stdout.write("fake image archive\\n");
}
`;

function fakeDocker(t, dir, env = {}) {
  const bin = join(dir, "fakebin");
  const state = mkdtempSync(join(dir, "fakestate-"));
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "docker"), FAKE);
  chmodSync(join(bin, "docker"), 0o755);
  const saved = {};
  const set = { PATH: `${bin}${delimiter}${process.env.PATH}`, FAKE_STATE: state, ...env };
  for (const key of ["PATH", "FAKE_STATE", "FAKE_MODE", "FAKE_COMMIT_REPO", "DOCKER_API_VERSION"]) {
    saved[key] = process.env[key];
    if (set[key] === undefined) delete process.env[key];
    else process.env[key] = set[key];
  }
  t.after(() => {
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  return {
    state,
    reset: () => rmSync(join(state, "calls.jsonl"), { force: true }),
    calls: () =>
      readFileSync(join(state, "calls.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line)),
    context: () => JSON.parse(readFileSync(join(state, "context.json"), "utf8")),
    labels: () => JSON.parse(readFileSync(join(state, "image.json"), "utf8")).Config.Labels,
  };
}

const buildArg = (argv, name) =>
  argv
    .filter((arg, i) => argv[i - 1] === "--build-arg" && arg.startsWith(`${name}=`))
    .map((arg) => arg.slice(name.length + 1));

// Checks the context against the recipe: every context COPY source exists,
// both workspace directories resolve under the passed WORKSPACE, the selected
// app directory holds APPLICATION's manifest and the dist copy is its build output.
function assertRecipeMatches(argv, listing) {
  const dockerfile = argv[argv.indexOf("-f") + 1];
  const recipe = readFileSync(dockerfile, "utf8");
  assert.equal(recipe, readFileSync(join(REPO, RECIPE, "Dockerfile"), "utf8"));
  const paths = new Set(listing.files.map((file) => file.path));
  const [workspace] = buildArg(argv, "WORKSPACE");
  const [application] = buildArg(argv, "APPLICATION");
  const declared = [...recipe.matchAll(/^ARG (\w+)/gm)].map((match) => match[1]);
  for (const name of ["WORKSPACE", "APPLICATION"]) assert.equal(declared.includes(name), true, name);
  for (const arg of argv.filter((_, i) => argv[i - 1] === "--build-arg"))
    assert.equal(declared.includes(arg.slice(0, arg.indexOf("="))), true, arg);
  for (const [, from] of recipe.matchAll(/^COPY (?!--from)(\S+) /gm)) {
    const inside = from.endsWith("/")
      ? [...paths].some((path) => path.startsWith(from))
      : paths.has(from);
    assert.equal(inside, true, `context lacks ${from}`);
  }
  const workdirs = [...recipe.matchAll(/^WORKDIR (\S+)/gm)].map((match) =>
    match[1].replace("${WORKSPACE}", workspace).replace(/^\/build\//, ""),
  );
  assert.deepEqual(workdirs, [`workspace/${workspace}`, `workspace/${workspace}/apps/ontology-manager`]);
  for (const rel of ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"])
    assert.equal(paths.has(`${workdirs[0]}/${rel}`), true, rel);
  const manifest = listing.files.find((file) => file.path === `${workdirs[1]}/package.json`);
  assert.equal(
    JSON.parse(readFileSync(join(listing.context, manifest.path), "utf8")).name,
    application,
  );
  assert.match(recipe, /^RUN pnpm install --frozen-lockfile --filter "\$\{APPLICATION\}\.\.\."$/m);
  assert.match(recipe, /^COPY --from=web-builder \/build\/workspace\/\$\{WORKSPACE\}\/apps\/ontology-manager\/dist /m);
}

test("help returns early; the architecture and flags come only from Make", async () => {
  assert.equal(await buildManagerImage({}, ["--help"]), undefined);
  await assert.rejects(() => buildManagerImage({}, []), /Required --arch/);
  await assert.rejects(() => buildManagerImage({}, ["--arch", "x86"]), /Required --arch/);
  await assert.rejects(() => buildManagerImage({}, ["--arch", "arm64", "--pack-app"]), /Unknown argument/);
});

test("the recipe pins the workbench Node builder, a default pnpm version on the build platform and the same Nginx version tag upstream", () => {
  const recipe = readFileSync(join(REPO, RECIPE, "Dockerfile"), "utf8");
  const workbench = readFileSync(join(REPO, "docker/workbench/Dockerfile.app"), "utf8");
  const pinned = /^ARG NODE_BUILDER_IMAGE=(\S+@sha256:[a-f0-9]{64})$/m;
  assert.equal(recipe.match(pinned)[1], workbench.match(pinned)[1]);
  assert.match(recipe, /^FROM --platform=\$BUILDPLATFORM \$\{NODE_BUILDER_IMAGE\} AS web-builder$/m);
  assert.match(recipe, /^ARG PNPM_VERSION=\d+\.\d+\.\d+$/m);
  assert.match(recipe, /^RUN npm install -g pnpm@\$\{PNPM_VERSION\}$/m);
  assert.match(recipe, /^FROM docker\.io\/library\/nginx:1\.27-alpine@sha256:[a-f0-9]{64}$/m);
  assert.doesNotMatch(recipe, /corepack|--prod\b|--filter-prod/);
});

test("the public entry builds ontomato-ontology-manager from its two owners and packs it", (t) => {
  const { dir, publicRoot } = fixture(t);
  const docker = fakeDocker(t, dir);
  const out = execFileSync("node", ["apps/ontology-manager/build.mjs", "--arch", "arm64", "--pack"], {
    cwd: publicRoot,
    encoding: "utf8",
  });
  const head = git(publicRoot, "rev-parse", "HEAD");
  const stamp = new RegExp(`^${VERSION}-\\d{8}-\\d{6}-g${head.slice(0, 12)}-arm64$`);
  const image = out.match(/^MANAGER_IMAGE=ontomato-ontology-manager:(\S+)$/m);
  assert.match(image[1], stamp);
  assert.match(out, /^MANAGER_DEPLOY_IMAGE=ontomato-ontology-manager:deploy-arm64$/m);
  const tar = out.match(/^PACK_MANAGER_TAR=(\S+)$/m)[1];
  assert.equal(tar, join(publicRoot, ".build/pack", `ontomato-ontology-manager-${image[1]}.tar.gz`));
  assert.equal(existsSync(tar), true);

  const calls = docker.calls();
  assert.deepEqual(calls.map((argv) => argv[0]), ["buildx", "version", "image", "save"]);
  const build = calls[0];
  assert.deepEqual(build.slice(0, 5), ["buildx", "build", "--provenance=false", "--platform", "linux/arm64"]);
  assert.equal(build.includes("--load"), true);
  assert.equal(build.includes("--push"), false);
  assert.deepEqual(buildArg(build, "WORKSPACE"), ["ontomato"]);
  assert.deepEqual(buildArg(build, "APPLICATION"), ["@ontomato/ontology-manager-app"]);
  assert.deepEqual(calls[3], ["save", `ontomato-ontology-manager:${image[1]}`, "ontomato-ontology-manager:deploy-arm64"]);

  const listing = docker.context();
  assert.equal(dirname(listing.context), join(publicRoot, ".build/contexts/ontology-manager/arm64"));
  assert.deepEqual(
    listing.files.map((file) => file.path).filter((path) => path.startsWith("workspace/")),
    [
      // The host entry is a Git-visible file of the owner, like every app's build.mjs.
      "workspace/ontomato/apps/ontology-manager/build.mjs",
      "workspace/ontomato/apps/ontology-manager/package.json",
      "workspace/ontomato/apps/ontology-manager/src/main.ts",
      "workspace/ontomato/apps/workbench/package.json",
      "workspace/ontomato/package.json",
      "workspace/ontomato/packages/core/package.json",
      "workspace/ontomato/packages/ontology-manager/package.json",
      "workspace/ontomato/packages/ontology-manager/src/index.ts",
      "workspace/ontomato/pnpm-lock.yaml",
      "workspace/ontomato/pnpm-workspace.yaml",
    ],
  );
  for (const name of RUNTIME_FILES)
    assert.equal(
      listing.files.find((file) => file.path === name).sha256,
      sha256(readFileSync(join(REPO, RECIPE, name))),
      name,
    );
  for (const [source, path] of [
    ["LICENSE", "LICENSE"],
    ["NOTICE", "NOTICE"],
    ["scripts/third_party_notices.py", "tools/third_party_notices.py"],
  ])
    assert.equal(
      listing.files.find((file) => file.path === path).sha256,
      sha256(readFileSync(join(REPO, source))),
      path,
    );
  assertRecipeMatches(build, listing);

  const labels = docker.labels();
  assert.equal(labels["io.runtime.component"], "ontomato-ontology-manager");
  assert.equal(labels["io.runtime.kind"], "manager");
  assert.equal(labels["org.opencontainers.image.version"], VERSION);
  assert.equal(labels["org.opencontainers.image.revision"], head);
  assert.equal(labels["io.runtime.source.dirty"], "false");
  assert.deepEqual(
    JSON.parse(labels["io.runtime.sources"]).map((source) => [source.id, source.revision, source.dirty]),
    [["ontomato", head, false]],
  );
  for (const key of Object.keys(labels)) assert.doesNotMatch(key, /family|compat-fingerprint/);
  assert.equal(existsSync(join(publicRoot, "apps/ontology-manager/runtime-lock.json")), false);
});

test("an enterprise build takes its own app plus the public owners; identity is private with a dirty public source", async (t) => {
  const repos = fixture(t);
  const { dir, publicRoot, privateRoot } = repos;
  text(join(publicRoot, "apps/ontology-manager/src/draft.ts"), "export {};\n");
  const docker = fakeDocker(t, dir);
  const logs = [];
  t.mock.method(console, "log", (line) => logs.push(line));
  await buildManagerImage(enterpriseApp(repos), ["--arch", "amd64"]);
  const heads = { ontomato: git(publicRoot, "rev-parse", "HEAD"), enterprise: git(privateRoot, "rev-parse", "HEAD") };

  const build = docker.calls()[0];
  assert.deepEqual(buildArg(build, "WORKSPACE"), ["enterprise"]);
  assert.deepEqual(buildArg(build, "APPLICATION"), ["@enterprise/ontology-manager-app"]);
  const listing = docker.context();
  assert.equal(dirname(listing.context), join(privateRoot, ".build/contexts/ontology-manager/amd64"));
  assert.deepEqual(
    listing.files.map((file) => file.path).filter((path) => path.startsWith("workspace/")),
    [
      "workspace/enterprise/apps/ontology-manager/package.json",
      "workspace/enterprise/apps/ontology-manager/src/main.ts",
      "workspace/enterprise/apps/workbench/package.json",
      "workspace/enterprise/package.json",
      "workspace/enterprise/pnpm-lock.yaml",
      "workspace/enterprise/pnpm-workspace.yaml",
      // The host entry is a Git-visible file of the owner, like every app's build.mjs.
      "workspace/ontomato/apps/ontology-manager/build.mjs",
      "workspace/ontomato/apps/ontology-manager/package.json",
      "workspace/ontomato/apps/ontology-manager/src/draft.ts",
      "workspace/ontomato/apps/ontology-manager/src/main.ts",
      "workspace/ontomato/apps/workbench/package.json",
      "workspace/ontomato/package.json",
      "workspace/ontomato/packages/core/package.json",
      "workspace/ontomato/packages/ontology-manager/package.json",
      "workspace/ontomato/packages/ontology-manager/src/index.ts",
      "workspace/ontomato/pnpm-lock.yaml",
      "workspace/ontomato/pnpm-workspace.yaml",
    ],
  );
  assertRecipeMatches(build, listing);

  const labels = docker.labels();
  assert.equal(labels["io.runtime.component"], "ontology-manager");
  assert.equal(labels["org.opencontainers.image.revision"], heads.enterprise);
  assert.equal(labels["io.runtime.source.dirty"], "true");
  assert.deepEqual(
    JSON.parse(labels["io.runtime.sources"]).map((source) => [source.id, source.revision, source.dirty]),
    [["ontomato", heads.ontomato, true], ["enterprise", heads.enterprise, false]],
  );
  const tag = logs.find((line) => String(line).startsWith("MANAGER_IMAGE="));
  assert.match(tag, new RegExp(`^MANAGER_IMAGE=ontology-manager:${VERSION}-\\d{8}-\\d{6}-g${heads.enterprise.slice(0, 12)}-dirty-amd64\nMANAGER_DEPLOY_IMAGE=ontology-manager:deploy-amd64$`));
});

test("a built image with a missing or wrong platform or identity label is rejected", async (t) => {
  const repos = fixture(t);
  const docker = fakeDocker(t, repos.dir);
  for (const mode of ["missing", "os", "arch", "kind", "component", "version", "revision", "dirty", "sources", "no-sources"]) {
    process.env.FAKE_MODE = mode;
    docker.reset();
    await assert.rejects(
      () => buildManagerImage(enterpriseApp(repos), ["--arch", "arm64", "--pack"]),
      /Built image identity mismatch: ontology-manager:/,
      mode,
    );
    assert.equal(docker.calls().some((argv) => argv[0] === "save"), false, mode);
  }
});

test("a source moving during the build fails before the image is reported or packed", async (t) => {
  const repos = fixture(t);
  const before = git(repos.publicRoot, "rev-parse", "HEAD");
  const docker = fakeDocker(t, repos.dir, { FAKE_COMMIT_REPO: repos.publicRoot });
  const logs = [];
  t.mock.method(console, "log", (line) => logs.push(line));
  await assert.rejects(
    () => buildManagerImage(enterpriseApp(repos), ["--arch", "arm64", "--pack"]),
    /source ontomato changed during the build; restart the build/,
  );
  assert.notEqual(git(repos.publicRoot, "rev-parse", "HEAD"), before);
  // The labels handed to Docker still carry the sampled revision.
  assert.equal(JSON.parse(docker.labels()["io.runtime.sources"])[0].revision, before);
  assert.equal(logs.some((line) => String(line).startsWith("MANAGER_IMAGE=")), false);
  assert.equal(docker.calls().some((argv) => argv[0] === "save"), false);
});

test("only the two Manager image names are packed as MANAGER", async (t) => {
  const { dir } = fixture(t);
  fakeDocker(t, dir);
  const logs = [];
  t.mock.method(console, "log", (line) => logs.push(line));
  for (const name of ["ontology-manager", "ontomato-ontology-manager", "workbench-ontology-manager"])
    await exportImage([`${name}:x-arm64`], join(dir, "pack", `${name}.tar.gz`));
  assert.deepEqual(logs, [
    `PACK_MANAGER_TAR=${join(dir, "pack/ontology-manager.tar.gz")}`,
    `PACK_MANAGER_TAR=${join(dir, "pack/ontomato-ontology-manager.tar.gz")}`,
    `PACK_APP_TAR=${join(dir, "pack/workbench-ontology-manager.tar.gz")}`,
  ]);
});
