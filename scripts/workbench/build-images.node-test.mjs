import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildStamp, sampleSources } from "../build-support.mjs";
import { buildWorkbenchImage } from "./build-images.mjs";
import { assembleAppStage, stageDirectory } from "./stage-app.mjs";

const VERSION = "9.9.9-test";

function repo(t, appName) {
  const dir = mkdtempSync(join(tmpdir(), "p4-wb-"));
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
    join(dir, "docker/workbench/Dockerfile"),
    "ARG NODE_RUNTIME_IMAGE=docker.io/library/node:24.21.0-slim\n",
  );
  writeFileSync(join(dir, "docker/workbench/requirements.txt"), "numpy==1.26.4\npandas==1.5.3\n");
  writeFileSync(join(dir, "docker/workbench/launch.sh"), "#!/bin/sh\nexec node app\n");
  mkdirSync(join(dir, "apps/workbench"), { recursive: true });
  writeFileSync(
    join(dir, "apps/workbench/package.json"),
    `${JSON.stringify({ name: appName })}\n`,
  );
  git(["add", "."]);
  git(["-c", "user.name=wb", "-c", "user.email=wb@t", "commit", "-m", "init"]);
  return dir;
}

function head(dir) {
  return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function descriptor(root, component = "ontomato") {
  return {
    repoRoot: root,
    publicRoot: root,
    component,
    workspaceId: "ontomato",
    appImporter: "apps/workbench",
    sources: [{ id: "ontomato", root }],
  };
}

function enterpriseDescriptor(pub, ent) {
  return {
    repoRoot: ent,
    publicRoot: pub,
    component: "data-agent",
    workspaceId: "enterprise",
    appImporter: "apps/workbench",
    sources: [
      { id: "ontomato", root: pub },
      { id: "enterprise", root: ent },
    ],
  };
}

const FAKE = `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

mkdirSync(dir, { recursive: true });
appendFileSync(dir + "/args.jsonl", JSON.stringify(args) + "\\n");

if (args[0] === "version") {
  process.stdout.write("25.0.0\\n");
} else if (args[0] === "buildx") {
  if (mode === "fail-build") process.exit(1);
  const labels = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--label") {
      const l = args[i + 1];
      const at = l.indexOf("=");
      labels[l.slice(0, at)] = l.slice(at + 1);
    }
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-t") images[args[i + 1]] = labels;
  }
  save();
} else if (args[0] === "image") {
  const tag = args[args.length - 1];
  const broken = mode === "fail-inspect";
  const stored = images[tag] || {};
  const labels = broken
    ? { "io.ontomato.component": "wrong", "org.opencontainers.image.version": "0.0.0" }
    : stored;
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
  for (const key of ["FAKE_DIR", "FAKE_MODE"]) saved[key] = process.env[key];
  process.env.PATH = `${env.bin}${delimiter}${savedPath}`;
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

function calls(state) {
  return readFileSync(join(state, "args.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
}

test("the public entry names the ontomato product", async () => {
  const { app } = await import("../../apps/workbench/build.mjs");
  assert.equal(app.component, "ontomato");
  assert.deepEqual(app.sources.map((s) => s.id), ["ontomato"]);
});

test("only the --arch flag is accepted and answers help", async () => {
  await assert.rejects(() => buildWorkbenchImage({}, ["all", "--arch", "arm64"]), /Unknown argument: all/);
  await assert.rejects(() => buildWorkbenchImage({}, ["runtime", "--arch", "arm64"]), /Unknown argument: runtime/);
  await assert.rejects(() => buildWorkbenchImage({}, ["app", "--arch", "arm64"]), /Unknown argument: app/);
  await assert.rejects(() => buildWorkbenchImage({}, ["--pack-app", "--arch", "arm64"]), /Unknown argument: --pack-app/);
  await assert.rejects(() => buildWorkbenchImage({}, ["--pack-runtime", "--arch", "arm64"]), /Unknown argument: --pack-runtime/);
  await assert.rejects(() => buildWorkbenchImage({}, ["--bogus", "--arch", "arm64"]), /Unknown argument: --bogus/);
  await assert.rejects(() => buildWorkbenchImage({}, []), /Required --arch/);
  assert.equal(await buildWorkbenchImage({}, ["--help"]), undefined);
});

test("the stamp takes this version's app repo and any dirty source dirties it", (t) => {
  const pub = repo(t, "@ontomato/workbench");
  const ent = repo(t, "@enterprise/workbench");
  const app = enterpriseDescriptor(pub, ent);
  const stamp = () => buildStamp(VERSION, ent, sampleSources(app));
  assert.match(stamp(), new RegExp(`^${VERSION}-\\d{8}-\\d{6}-g${head(ent).slice(0, 12)}$`));
  writeFileSync(join(pub, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n# dirty\n");
  assert.match(stamp(), new RegExp(`^${VERSION}-\\d{8}-\\d{6}-g${head(ent).slice(0, 12)}-dirty$`));
  assert.throws(
    () => buildStamp(VERSION, join(pub, "missing"), sampleSources(app)),
    /not a build source/,
  );
});

test("buildWorkbenchImage builds the final image and tags deploy alias for public and enterprise", async (t) => {
  const pub = repo(t, "@ontomato/workbench");
  const ent = repo(t, "@enterprise/workbench");

  // Public build
  const pubDocker = fakeDocker(t, pub);
  await withDocker({ ...pubDocker, mode: "ok" }, async () => {
    await buildWorkbenchImage(descriptor(pub), ["--arch", "arm64"]);
  });
  const pubBuild = calls(pubDocker.state).find((argv) => argv.includes("buildx"));
  assert.ok(pubBuild.includes("--load"));
  assert.ok(pubBuild.includes("WORKSPACE=ontomato"));
  assert.ok(pubBuild.includes("APPLICATION=@ontomato/workbench"));
  assert.ok(pubBuild.includes("TARGETPLATFORM=linux/arm64"));
  assert.ok(pubBuild.includes("org.opencontainers.image.version=" + VERSION));
  assert.ok(pubBuild.includes("io.ontomato.component=ontomato"));
  const pubTags = pubBuild.filter((arg, i) => pubBuild[i - 1] === "-t");
  assert.equal(pubTags.length, 2);
  assert.match(pubTags[0], new RegExp(`^ontomato:${VERSION}-\\d{8}-\\d{6}-g${head(pub).slice(0, 12)}-arm64$`));
  assert.equal(pubTags[1], "ontomato:deploy-arm64");

  // Enterprise build
  const entDocker = fakeDocker(t, ent);
  await withDocker({ ...entDocker, mode: "ok" }, async () => {
    await buildWorkbenchImage(enterpriseDescriptor(pub, ent), ["--arch", "amd64"]);
  });
  const entBuild = calls(entDocker.state).find((argv) => argv.includes("buildx"));
  assert.ok(entBuild.includes("--load"));
  assert.ok(entBuild.includes("WORKSPACE=enterprise"));
  assert.ok(entBuild.includes("APPLICATION=@enterprise/workbench"));
  assert.ok(entBuild.includes("TARGETPLATFORM=linux/amd64"));
  assert.ok(entBuild.includes("org.opencontainers.image.version=" + VERSION));
  assert.ok(entBuild.includes("io.ontomato.component=data-agent"));
  const entTags = entBuild.filter((arg, i) => entBuild[i - 1] === "-t");
  assert.equal(entTags.length, 2);
  assert.match(entTags[0], new RegExp(`^data-agent:${VERSION}-\\d{8}-\\d{6}-g${head(ent).slice(0, 12)}-amd64$`));
  assert.equal(entTags[1], "data-agent:deploy-amd64");

  // Staging context verification
  const ctx = join(ent, ".build/contexts/workbench/amd64/image");
  for (const rel of [
    "sources/ontomato/package.json",
    "sources/enterprise/package.json",
    "workspace/enterprise/apps/workbench/package.json",
    "inputs.json",
    "tools/workbench/install-runtime.mjs",
    "tools/workbench/runtime-layout.mjs",
    "tools/workbench/stage-app.mjs",
    "tools/build-support.mjs",
    "runtime-requirements.txt",
    "launch.sh",
    "LICENSE",
    "NOTICE",
  ]) {
    assert.equal(existsSync(join(ctx, rel)), true, rel);
  }
});

test("an early Docker failure rejects without writing output", async (t) => {
  const root = repo(t, "@ontomato/workbench");
  const docker = fakeDocker(t, root);
  await withDocker({ ...docker, mode: "fail-build" }, async () => {
    await assert.rejects(
      () => buildWorkbenchImage(descriptor(root), ["--arch", "arm64"]),
      /docker buildx build failed/,
    );
  });
});

test("a mismatched inspect label or architecture fails build", async (t) => {
  const root = repo(t, "@ontomato/workbench");
  const docker = fakeDocker(t, root);
  await withDocker({ ...docker, mode: "fail-inspect" }, async () => {
    await assert.rejects(
      () => buildWorkbenchImage(descriptor(root), ["--arch", "arm64"]),
      /identity mismatch/,
    );
  });
});

test("stageDirectory drops build-time source prefix", () => {
  assert.equal(stageDirectory("apps/workbench"), "apps/workbench");
  assert.equal(stageDirectory("../ontomato/apps/workbench"), "apps/workbench");
  assert.equal(stageDirectory("../enterprise/packages/a"), "packages/a");
  assert.throws(() => stageDirectory("../.."), /outside the stage/);
  assert.throws(() => stageDirectory("../../a"), /outside the stage/);
  assert.throws(() => stageDirectory("/app"), /outside the stage/);
});

test("the workbench recipe declares required stages, arguments and launch permissions", () => {
  const recipe = readFileSync(
    fileURLToPath(new URL("../../docker/workbench/Dockerfile", import.meta.url)),
    "utf8",
  );
  assert.match(recipe, /AS dependencies-installer/);
  assert.match(recipe, /AS app-builder/);
  assert.match(recipe, /AS runtime-base/);
  assert.match(recipe, /FROM runtime-base AS final/);
  assert.match(recipe, /COPY --from=app-builder \/stage\/ \/app\//);
  assert.match(recipe, /chmod 0755 \/stage\/launch\.sh/);
  assert.doesNotMatch(recipe, /ENTRYPOINT/);
  assert.match(recipe, /CMD \["\/app\/launch\.sh"\]/);
});

test("the app launcher fills product Python defaults only when unset; explicit values pass through", (t) => {
  const launch = fileURLToPath(new URL("../../docker/workbench/launch.sh", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "p4-launch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, "node"),
    '#!/bin/sh\nprintf "replay=%s hot=%s\\n" "$ABC_REPLAY_PYTHON_COMMAND" "$HOT_REPORT_PYTHON_COMMAND"\n',
  );
  chmodSync(join(dir, "node"), 0o755);
  const run = (extra) =>
    spawnSync("/bin/sh", [launch], {
      encoding: "utf8",
      env: { PATH: `${dir}:/usr/bin:/bin`, ...extra },
    });
  const cases = [
    [{}, "replay=python3.10 hot=python3.10\n"],
    [{ ABC_REPLAY_PYTHON_COMMAND: "", HOT_REPORT_PYTHON_COMMAND: "custom-hot" }, "replay= hot=custom-hot\n"],
    [{ HOT_REPORT_PYTHON_COMMAND: "custom-hot" }, "replay=python3.10 hot=custom-hot\n"],
    [{ ABC_REPLAY_PYTHON_COMMAND: "custom-replay", HOT_REPORT_PYTHON_COMMAND: "custom-hot" }, "replay=custom-replay hot=custom-hot\n"],
  ];
  for (const [extra, expected] of cases) {
    const result = run(extra);
    assert.equal(result.status, 0, JSON.stringify(extra));
    assert.equal(result.stdout, expected, JSON.stringify(extra));
  }
});

test("assemble writes own packages, resources, links and web without pairing metadata", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "p4-assemble-"));
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
  mkdirSync(join(ent, "dist/web"), { recursive: true });
  writeFileSync(join(ent, "dist/web/index.html"), "<html>\n");

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
  const selected = members;
  const armStage = join(dir, "stage-arm64");
  const assembled = assembleAppStage({
    root: ent,
    stageRoot: armStage,
    storeRoot: store,
    record,
    platform: "linux/arm64",
    lock,
    members,
    selected,
  });
  assert.throws(
    () =>
      assembleAppStage({
        root: ent,
        stageRoot: armStage,
        storeRoot: store,
        record,
        platform: null,
        lock,
        members,
        selected,
      }),
    /platform is required/,
  );
  assert.equal(assembled.copies.length, 3);
  assert.equal(readFileSync(join(armStage, "apps/workbench/src/index.ts"), "utf8"), "enterprise\n");
  assert.equal(existsSync(join(armStage, ".image-meta.json")), false);
  assert.equal(existsSync(join(armStage, "dist/web/index.html")), true);
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
});
