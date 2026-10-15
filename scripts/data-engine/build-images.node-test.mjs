import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildJavaApp, JAVA_FLAGS, parseJavaArgs, selectPromptLanguage } from "./build-images.mjs";
import { readRevision } from "../build-support.mjs";
import { app as publicEntry } from "../../apps/data-engine/build.mjs";

function temporary(fn) {
  const dir = mkdtempSync(join(tmpdir(), "backend test café space-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("prompt language staging: the selected variant replaces the plain file, other declared variants are dropped", () => {
  for (const lang of ["zh", "en"])
    temporary((dir) => {
      mkdirSync(join(dir, "lang"));
      writeFileSync(join(dir, "prompt.md"), "English");
      writeFileSync(join(dir, "prompt.zh.md"), "Chinese");
      writeFileSync(join(dir, "lang/zh-CN.json"), "{}");
      writeFileSync(join(dir, "tricky.zh.middle.md"), "keep");
      selectPromptLanguage(dir, lang, ["zh", "en"]);
      assert.equal(readFileSync(join(dir, "prompt.md"), "utf8"), lang === "en" ? "English" : "Chinese");
      assert.deepEqual(readdirSync(dir, { recursive: true }).sort(), ["lang", "lang/zh-CN.json", "prompt.md", "tricky.zh.middle.md"]);
    });
});
test("revision is the single concrete public POM property", () => {
  assert.equal(
    readRevision(
      "<parent><version>3.5.0</version></parent><properties><revision>4.0.0-beta.1</revision></properties>",
    ),
    "4.0.0-beta.1",
  );
  assert.throws(() => readRevision("<revision>${revision}</revision>"));
  assert.throws(() =>
    readRevision("<revision>1</revision><revision>2</revision>"),
  );
  assert.throws(() => readRevision("<version>3.5.0</version>"));
  const live = readRevision(
    readFileSync(fileURLToPath(new URL("../../pom.xml", import.meta.url)), "utf8"),
  );
  // The live POM carries one concrete release version; its value changes with each release.
  assert.match(live, /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
});

// ---- CLI, recipe call and the fake-Docker build chain (no real Docker, Maven or network) ----
// These prove the inputs handed to Docker; real compilation, class checks and images
// are verified only by a real build.
const RECIPES = fileURLToPath(new URL("../../docker/data-engine/", import.meta.url));
const RECIPE = join(RECIPES, "Dockerfile");
const PUBLIC = fileURLToPath(new URL("../..", import.meta.url));
const VERSION = "9.9.9-test";
const SETTINGS_MARK = "SYNTHETIC-SETTINGS-CONTENT-MUST-NOT-LEAK";

function git(root, ...args) {
  return execFileSync("git", ["-C", root, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...args], { encoding: "utf8" }).trim();
}
function put(root, files) {
  for (const [rel, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), value);
  }
}
function repository(root, files) {
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  put(root, { ".gitignore": ".build/\n", ...files });
  git(root, "add", "-A");
  git(root, "commit", "-qm", "fixture");
}
function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "p4-j5a-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pub = join(dir, "ontomato");
  const ent = join(dir, "enterprise");
  repository(pub, {
    "pom.xml": `<project><properties><revision>${VERSION}</revision><maven.compiler.target>21</maven.compiler.target></properties></project>\n`,
    mvnw: "#!/bin/sh\n", "mvnw.cmd": "@echo off\n", ".mvn/wrapper/maven-wrapper.properties": "x=1\n",
    "packages/data-engine-core/pom.xml": "<project/>\n",
    "packages/data-engine-core/src/main/java/Core.java": "class Core {}\n",
    "packages/data-engine-core/src/test/java/CoreTest.java": "class CoreTest {}\n",
    "packages/data-engine-core/requirements-py310.txt": "numpy==2.2.6\n",
    "packages/data-engine-core/mcp/mcpserver.py": "# mcp\n",
    "packages/data-engine-core/conf-defaults/prompt.md": "public English\n",
    "packages/data-engine-core/conf-defaults/application.yml": "app: public\n",
    "packages/data-engine-core/conf-defaults/lang/en.json": "{}\n",
    "packages/data-engine-core/conf-defaults/static/login.html": "oss page\n",
    "packages/data-engine-core/skills/aftercalculate/trend-forecaster/SKILL.md": "public skill English\n",
    "packages/data-engine-core/skills/aftercalculate/trend-forecaster/scripts/forecaster.py": "# py\n",
    "apps/data-engine/pom.xml": "<project/>\n",
    "apps/data-engine/src/main/java/App.java": "class App {}\n",
    "scripts/data-engine/container-entrypoint.sh": "#!/bin/bash\n",
    "scripts/data-engine/sync-product-files.py": "# sync\n",
  });
  repository(ent, {
    "pom.xml": "<project/>\n",
    "packages/data-engine-enterprise/pom.xml": "<project/>\n",
    "packages/data-engine-enterprise/src/main/java/Ent.java": "class Ent {}\n",
    "packages/data-engine-enterprise/src/license-real/java/L.java": "class L {}\n",
    "packages/data-engine-enterprise/src/license-override/java/L.java": "class L {}\n",
    "packages/data-engine-enterprise/conf-defaults/prompt.zh.md": "enterprise Chinese\n",
    "packages/data-engine-enterprise/conf-defaults/lang/zh-CN.json": "{}\n",
    "packages/data-engine-enterprise/conf-defaults/static/login.html": "enterprise page\n",
    "packages/data-engine-enterprise/skills/aftercalculate/trend-forecaster/SKILL.zh.md": "enterprise skill Chinese\n",
    "apps/data-engine/pom.xml": "<project/>\n",
    "apps/data-engine/src/main/java/EntApp.java": "class EntApp {}\n",
    "scripts/data-engine/verify-license-jar.sh": "#!/bin/sh\n",
    "scripts/data-engine/enterprise-entrypoint.sh": "#!/bin/sh\n",
  });
  const settings = join(dir, "home/.m2/settings.xml");
  put(dir, { "home/.m2/settings.xml": `<settings>${SETTINGS_MARK}</settings>\n` });
  return { dir, pub, ent, settings };
}
const publicTree = (pub) => ({ dest: "ontomato", root: pub, paths: ["pom.xml", "mvnw", "mvnw.cmd", ".mvn", "packages/data-engine-core/pom.xml", "packages/data-engine-core/src/main", "apps/data-engine/pom.xml", "apps/data-engine/src/main"] });
function publicApp({ pub }) {
  return {
    repoRoot: pub, versionPom: join(pub, "pom.xml"),
    sources: [{ id: "ontomato", root: pub }],
    component: "datarag-opensource", promptLang: "en", supportedPromptLangs: ["en"],
    reactorDir: "ontomato", appModule: "apps/data-engine", appLibModules: ["packages/data-engine-core", "apps/data-engine"], excludeArtifactIds: "data-engine-core,data-engine-app",
    contextTrees: [publicTree(pub)],
    secretExport: null,
    requirements: { root: pub, path: "packages/data-engine-core/requirements-py310.txt" },
    mcp: { root: pub, path: "packages/data-engine-core/mcp/mcpserver.py" },
    bin: [[pub, "scripts/data-engine/container-entrypoint.sh", "payload/bin/container-entrypoint.sh"], [pub, "scripts/data-engine/sync-product-files.py", "payload/bin/sync-product-files.py"]],
    resources: [[pub, "packages/data-engine-core/conf-defaults", "payload/conf-defaults"], [pub, "packages/data-engine-core/skills", "payload/skills"]],
    requiredSkill: "payload/skills/aftercalculate/trend-forecaster/SKILL.md",
    labels: {}, tagSuffix: "",
  };
}
// Enterprise-shaped description with the same fields as the private entry's.
function enterpriseApp({ pub, ent, settings }, mode) {
  const base = publicApp({ pub });
  return {
    ...base,
    repoRoot: ent,
    sources: [{ id: "ontomato", root: pub }, { id: "enterprise", root: ent }],
    component: "datarag", promptLang: "zh", supportedPromptLangs: ["zh", "en"], reactorDir: "enterprise",
    appLibModules: ["../ontomato/packages/data-engine-core", "packages/data-engine-enterprise", "apps/data-engine"],
    excludeArtifactIds: "data-engine-core,data-engine-enterprise,data-engine-enterprise-app",
    contextTrees: [
      { ...publicTree(pub), paths: publicTree(pub).paths.slice(0, 6) },
      { dest: "enterprise", root: ent, paths: ["pom.xml", "packages/data-engine-enterprise/pom.xml", "packages/data-engine-enterprise/src/main", "packages/data-engine-enterprise/src/license-real", "packages/data-engine-enterprise/src/license-override", "apps/data-engine/pom.xml", "apps/data-engine/src/main", "scripts/data-engine/verify-license-jar.sh"] },
    ],
    secretExport: {
      mavenSettings: settings, keepNative: "libLicense-native-aarch64-5.4.2.so", licenseProfile: mode === "override" ? "dev-override" : "",
      check: { script: "enterprise/scripts/data-engine/verify-license-jar.sh", jarArtifactId: "data-engine-enterprise", argument: mode },
    },
    // The enterprise app ships its own thin entrypoint at the fixed path,
    // delegating to the public lifecycle script beside it.
    bin: [
      [ent, "scripts/data-engine/enterprise-entrypoint.sh", "payload/bin/container-entrypoint.sh"],
      [pub, "scripts/data-engine/container-entrypoint.sh", "payload/bin/data-engine-entrypoint.sh"],
      [pub, "scripts/data-engine/sync-product-files.py", "payload/bin/sync-product-files.py"],
    ],
    resources: [
      [pub, "packages/data-engine-core/conf-defaults", "payload/conf-defaults"],
      [ent, "packages/data-engine-enterprise/conf-defaults", "payload/conf-defaults"],
      [pub, "packages/data-engine-core/skills", "payload/skills"],
      [ent, "packages/data-engine-enterprise/skills", "payload/skills"],
    ],
    labels: { "io.example.license.mode": mode }, tagSuffix: mode === "override" ? "-override" : "",
  };
}

// Minimal fixture Docker for this builder's calls: it records the one build's argv and
// the full context file set (path -> content), and answers inspect from the labels it
// was given. FAKE_MODE=bad-label alters one license label.
const FAKE = `#!/usr/bin/env node
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const state = process.env.FAKE_STATE;
const images = existsSync(join(state, "images.json")) ? JSON.parse(readFileSync(join(state, "images.json"), "utf8")) : {};
const save = () => writeFileSync(join(state, "images.json"), JSON.stringify(images));
const files = (root, prefix = "") => readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((e) => { const rel = prefix ? prefix + "/" + e.name : e.name; return e.isDirectory() ? files(root, rel) : [rel]; });
const value = (flag) => args.filter((a, i) => args[i - 1] === flag);
if (args[0] === "version") { process.stdout.write("1.47\\n"); }
else if (args[0] === "buildx") {
  const context = args[args.length - 1];
  const snapshot = Object.fromEntries(files(context).sort().map((p) => [p, readFileSync(join(context, p), "utf8")]));
  appendFileSync(join(state, "builds.jsonl"), JSON.stringify({ target: value("--target")[0], args, context: snapshot }) + "\\n");
  const labels = {};
  for (const l of value("--label")) { const at = l.indexOf("="); labels[l.slice(0, at)] = l.slice(at + 1); }
  if (process.env.FAKE_MODE === "bad-label") labels["io.example.license.mode"] = "real";
  for (const tag of value("-t")) images[tag] = labels;
  save();
} else if (args[0] === "image") {
  const labels = images[args[args.length - 1]];
  if (!labels) { process.stderr.write("Error: No such image\\n"); process.exit(1); }
  process.stdout.write(JSON.stringify([{ Os: "linux", Architecture: "arm64", Config: { Labels: labels } }]));
} else { process.stderr.write("unexpected docker call " + args.join(" ") + "\\n"); process.exit(2); }
`;
function fakeDocker(t, dir, env = {}) {
  const bin = join(dir, "fakebin");
  const state = mkdtempSync(join(dir, "fakestate-"));
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "docker"), FAKE);
  chmodSync(join(bin, "docker"), 0o755);
  const set = { PATH: `${bin}${delimiter}${process.env.PATH}`, FAKE_STATE: state, ...env };
  const saved = {};
  for (const key of ["PATH", "FAKE_STATE", "FAKE_MODE", "DOCKER_API_VERSION", "PIP_INDEX_URL"]) {
    saved[key] = process.env[key];
    if (set[key] === undefined) delete process.env[key];
    else process.env[key] = set[key];
  }
  t.after(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  const builds = () => (existsSync(join(state, "builds.jsonl")) ? readFileSync(join(state, "builds.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  return { builds, images: () => JSON.parse(readFileSync(join(state, "images.json"), "utf8")) };
}
const argOf = (argv, name) => argv.filter((a, i) => argv[i - 1] === "--build-arg" && a.startsWith(`${name}=`)).map((a) => a.slice(name.length + 1));
const tagsOf = (argv) => argv.filter((a, i) => argv[i - 1] === "-t");
// Every value the recipe's export script reads, in the order the recipe declares it.
// The reactor inputs are mandatory for both export stages; the edition inputs only
// exist for the secret export.
const reactorBuildArgs = (app) => [
  `REACTOR_DIR=${app.reactorDir}`,
  `APP_MODULE=${app.appModule}`,
  `APP_LIB_MODULES=${app.appLibModules.join(" ")}`,
  `EXCLUDE_ARTIFACT_IDS=${app.excludeArtifactIds}`,
];
const buildArgsOf = (argv) => argv.filter((a, i) => argv[i - 1] === "--build-arg");
const run = (app, args) => buildJavaApp(app, parseJavaArgs(args, { ...JAVA_FLAGS, "--license-mode": "value" }));

test("the CLI takes flags only: no positional build action, no packaging switch", () => {
  assert.deepEqual(parseJavaArgs(["--help"], JAVA_FLAGS), { help: true });
  assert.deepEqual(parseJavaArgs(["--arch", "arm64", "--prompt-lang", "zh"], JAVA_FLAGS), { help: false, parsed: { "--arch": "arm64", "--prompt-lang": "zh" } });
  for (const gone of [["all", "--arch", "arm64"], ["app", "--arch", "arm64"], ["runtime", "--arch", "arm64"]])
    assert.throws(() => parseJavaArgs(gone, JAVA_FLAGS), /Unknown argument/);
  assert.throws(() => parseJavaArgs(["--arch", "arm64", "--pack-app"], JAVA_FLAGS), /Unknown argument: --pack-app/);
  assert.throws(() => parseJavaArgs(["--arch", "arm64", "--pack-runtime"], JAVA_FLAGS), /Unknown argument: --pack-runtime/);
  assert.throws(() => parseJavaArgs(["--arch", "arm64", "--license-mode", "real"], JAVA_FLAGS), /Unknown argument: --license-mode/);
  assert.throws(() => parseJavaArgs([], JAVA_FLAGS), /Required --arch/);
});

// The export script that runs inside the image fails on an empty reactor input, so a
// description field that never reaches the Docker argv breaks the build. These tests
// pin the exact build-arg values handed over, on both editions and both license modes.
test("the public build hands the export its reactor inputs and nothing edition-specific", async (t) => {
  const fx = fixture(t);
  const docker = fakeDocker(t, fx.dir, { PIP_INDEX_URL: undefined });
  const app = publicApp(fx);
  await run(app, ["--arch", "arm64", "--prompt-lang", "en"]);
  const build = docker.builds()[0];
  assert.deepEqual(buildArgsOf(build.args).sort(), ["EXPORT_STAGE=build-central", ...reactorBuildArgs(app)].sort());
  assert.equal(existsSync(RECIPE), true);
});

test("the real public description names the reactor tree it stages and the app module it packages", () => {
  const tree = publicEntry.contextTrees.find((entry) => entry.root === publicEntry.repoRoot);
  assert.equal(publicEntry.reactorDir, tree.dest);
  assert.ok(publicEntry.appLibModules.includes(publicEntry.appModule));
  assert.equal(publicEntry.appLibModules.filter((module) => module === publicEntry.appModule).length, 1);
  // The app's own reactor artifacts stay out of the third-party closure.
  const pom = readFileSync(join(PUBLIC, "apps/data-engine/pom.xml"), "utf8");
  const appArtifact = /<\/parent>[\s\S]*?<artifactId>([^<]+)<\/artifactId>/.exec(pom)[1];
  const excluded = publicEntry.excludeArtifactIds.split(",");
  assert.ok(excluded.includes(appArtifact), appArtifact);
  assert.ok(excluded.includes("data-engine-core"));
});

test("public final image: central export of the public tree only, one image tag and alias, en prompts", async (t) => {
  const fx = fixture(t);
  const docker = fakeDocker(t, fx.dir, { PIP_INDEX_URL: undefined });
  await run(publicApp(fx), ["--arch", "arm64", "--prompt-lang", "en"]);
  assert.equal(docker.builds().length, 1);
  const build = docker.builds()[0];
  assert.equal(build.target, "image");
  assert.equal(build.args[build.args.indexOf("-f") + 1], RECIPE);
  assert.ok(build.args.includes("--load"));
  assert.deepEqual(argOf(build.args, "EXPORT_STAGE"), ["build-central"]);
  assert.equal(build.args.includes("--secret"), false);
  assert.equal(build.args.some((a) => /^(KEEP_NATIVE|LICENSE_PROFILE|APP_CHECK_)/.test(a)), false);
  // The context carries the public source tree, the payload, the pinned list and the
  // tools the recipe binds; no test sources and no enterprise tree.
  assert.deepEqual(
    Object.keys(build.context).filter((p) => !p.startsWith("payload/") && p !== "LICENSE" && p !== "NOTICE").sort(),
    [
      "ontomato/.mvn/wrapper/maven-wrapper.properties",
      "ontomato/apps/data-engine/pom.xml",
      "ontomato/apps/data-engine/src/main/java/App.java",
      "ontomato/mvnw",
      "ontomato/mvnw.cmd",
      "ontomato/packages/data-engine-core/pom.xml",
      "ontomato/packages/data-engine-core/src/main/java/Core.java",
      "ontomato/pom.xml",
      "requirements-py310.txt",
      "tools/third_party_notices.py",
      "tools/verify-image.py",
    ],
  );
  assert.equal(Object.keys(build.context).some((p) => p.startsWith("enterprise/")), false);
  const shipped = (name) => readFileSync(join(PUBLIC, name), "utf8");
  for (const name of ["LICENSE", "NOTICE"]) assert.equal(build.context[name], shipped(name));
  assert.equal(build.context["tools/third_party_notices.py"], shipped("scripts/third_party_notices.py"));
  assert.equal(build.context["tools/verify-image.py"], shipped("scripts/data-engine/verify-image.py"));
  assert.equal(build.context["requirements-py310.txt"], "numpy==2.2.6\n");
  // The payload is the product's own content: resources, startup files and the MCP service.
  assert.equal(build.context["payload/conf-defaults/prompt.md"], "public English\n");
  assert.equal(build.context["payload/conf-defaults/static/login.html"], "oss page\n");
  assert.equal(build.context["payload/skills/aftercalculate/trend-forecaster/SKILL.md"], "public skill English\n");
  assert.equal(build.context["payload/bin/container-entrypoint.sh"], "#!/bin/bash\n");
  assert.equal(build.context["payload/bin/sync-product-files.py"], "# sync\n");
  assert.equal(build.context["payload/mcp/mcpserver.py"], "# mcp\n");
  assert.equal(Object.keys(build.context).some((p) => /\.(zh|en)\.[^./]+$/.test(p)), false);
  const head = git(fx.pub, "rev-parse", "HEAD");
  assert.match(
    tagsOf(build.args)[0],
    new RegExp(`^datarag-opensource:${VERSION}-\\d{8}-\\d{6}-g${head.slice(0, 12)}-arm64$`),
  );
  assert.equal(tagsOf(build.args)[1], "datarag-opensource:deploy-arm64");
  assert.deepEqual(docker.images()[tagsOf(build.args)[0]], {
    "org.opencontainers.image.version": VERSION,
    "io.ontomato.component": "datarag-opensource",
  });
});

for (const mode of ["real", "override"])
  test(`enterprise ${mode}: secret export with the jar check, native library, public-then-enterprise resources, one mode everywhere`, async (t) => {
    const fx = fixture(t);
    put(fx.pub, { "packages/data-engine-core/conf-defaults/draft.md": "untracked public\n" });
    const docker = fakeDocker(t, fx.dir, { PIP_INDEX_URL: undefined });
    const app = enterpriseApp(fx, mode);
    await run(app, ["--arch", "arm64", "--license-mode", mode, "--prompt-lang", "zh"]);
    assert.equal(docker.builds().length, 1);
    const build = docker.builds()[0];
    assert.equal(build.target, "image");
    // Every export input reaches the recipe, and the reactor ones are the description's.
    assert.deepEqual(buildArgsOf(build.args).sort(), [
      "EXPORT_STAGE=build-secret",
      ...reactorBuildArgs(app),
      "KEEP_NATIVE=libLicense-native-aarch64-5.4.2.so",
      `LICENSE_PROFILE=${mode === "override" ? "dev-override" : ""}`,
      "APP_CHECK_SCRIPT=enterprise/scripts/data-engine/verify-license-jar.sh",
      `APP_CHECK_JAR=/out/app/lib/data-engine-enterprise-${VERSION}.jar`,
      `APP_CHECK_ARG=${mode}`,
    ].sort());
    assert.deepEqual(argOf(build.args, "EXPORT_STAGE"), ["build-secret"]);
    assert.deepEqual(build.args.slice(build.args.indexOf("--secret"), build.args.indexOf("--secret") + 2), ["--secret", `id=maven-settings,src=${fx.settings}`]);
    assert.deepEqual(argOf(build.args, "APP_CHECK_SCRIPT"), ["enterprise/scripts/data-engine/verify-license-jar.sh"]);
    assert.deepEqual(argOf(build.args, "APP_CHECK_JAR"), [`/out/app/lib/data-engine-enterprise-${VERSION}.jar`]);
    assert.deepEqual(argOf(build.args, "APP_CHECK_ARG"), [mode]);
    assert.deepEqual(argOf(build.args, "LICENSE_PROFILE"), [mode === "override" ? "dev-override" : ""]);
    assert.deepEqual(argOf(build.args, "KEEP_NATIVE"), ["libLicense-native-aarch64-5.4.2.so"]);
    // The private settings only ever ride the secret: neither the context nor any
    // recorded docker argument carries their content.
    assert.equal(JSON.stringify(build).includes(SETTINGS_MARK), false);
    assert.ok("enterprise/scripts/data-engine/verify-license-jar.sh" in build.context);
    assert.ok("enterprise/packages/data-engine-enterprise/src/license-override/java/L.java" in build.context);
    // Resources and startup files only ever enter under payload/.
    assert.equal(Object.keys(build.context).some((p) => /conf-defaults|skills/.test(p) && !p.startsWith("payload/")), false);
    assert.equal(build.context["payload/conf-defaults/prompt.md"], "enterprise Chinese\n");
    assert.equal(build.context["payload/conf-defaults/application.yml"], "app: public\n");
    assert.equal(build.context["payload/conf-defaults/draft.md"], "untracked public\n");
    assert.equal(build.context["payload/conf-defaults/lang/zh-CN.json"], "{}\n");
    assert.equal(build.context["payload/conf-defaults/static/login.html"], "enterprise page\n");
    assert.equal(Object.keys(build.context).some((p) => /\.(zh|en)\.[^./]+$/.test(p)), false);
    assert.equal(build.context["payload/skills/aftercalculate/trend-forecaster/SKILL.md"], "enterprise skill Chinese\n");
    assert.equal(build.context["payload/skills/aftercalculate/trend-forecaster/scripts/forecaster.py"], "# py\n");
    // The enterprise app entrypoint is the thin wrapper at the fixed path, with
    // the public lifecycle script beside it sharing the sync helper.
    assert.equal(build.context["payload/bin/container-entrypoint.sh"], "#!/bin/sh\n");
    assert.equal(build.context["payload/bin/data-engine-entrypoint.sh"], "#!/bin/bash\n");
    assert.equal(build.context["payload/bin/sync-product-files.py"], "# sync\n");
    assert.equal(build.context["payload/mcp/mcpserver.py"], "# mcp\n");
    const enterpriseHead = git(fx.ent, "rev-parse", "HEAD");
    const suffix = mode === "override" ? "-override" : "";
    assert.match(
      tagsOf(build.args)[0],
      new RegExp(`^datarag:${VERSION}-\\d{8}-\\d{6}-g${enterpriseHead.slice(0, 12)}-dirty${suffix}-arm64$`),
    );
    assert.equal(tagsOf(build.args)[1], `datarag:deploy${suffix}-arm64`);
    // The deploy alias carries the same suffix: an override build never claims
    // the alias the deployment runs.
    assert.deepEqual(
      Object.keys(docker.images()).filter((name) => name.startsWith("datarag:deploy")),
      [`datarag:deploy${suffix}-arm64`],
    );
    assert.deepEqual(docker.images()[tagsOf(build.args)[0]], {
      "org.opencontainers.image.version": VERSION,
      "io.ontomato.component": "datarag",
      "io.example.license.mode": mode,
    });
  });

test("enterprise en: the public English defaults stay under the overlay's Chinese variants and the edition page stays", async (t) => {
  const fx = fixture(t);
  const docker = fakeDocker(t, fx.dir);
  await run(enterpriseApp(fx, "real"), ["--arch", "arm64", "--license-mode", "real", "--prompt-lang", "en"]);
  const build = docker.builds()[0];
  assert.equal(build.context["payload/conf-defaults/prompt.md"], "public English\n");
  assert.equal(build.context["payload/conf-defaults/static/login.html"], "enterprise page\n");
  assert.equal(build.context["payload/conf-defaults/lang/zh-CN.json"], "{}\n");
  assert.equal(build.context["payload/skills/aftercalculate/trend-forecaster/SKILL.md"], "public skill English\n");
  assert.equal(Object.keys(build.context).some((p) => /\.(zh|en)\.[^./]+$/.test(p)), false);
});

// The real public entry declares English only: another language fails before any build step, and
// the real public resource trees are staged unchanged.
test("real public entry rejects an undeclared prompt language before building", async (t) => {
  const fx = fixture(t);
  const docker = fakeDocker(t, fx.dir);
  const app = { ...publicApp(fx), resources: publicEntry.resources, supportedPromptLangs: publicEntry.supportedPromptLangs };
  await assert.rejects(() => run(app, ["--arch", "arm64", "--prompt-lang", "zh"]), /Expected --prompt-lang en$/);
  assert.equal(existsSync(join(fx.pub, ".build")), false);
  await run(app, ["--arch", "arm64", "--prompt-lang", "en"]);
  const staged = docker.builds()[0].context;
  for (const [root, source, dest] of publicEntry.resources) {
    const files = readdirSync(join(root, source), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(join(root, source).length + 1));
    const expected = Object.fromEntries(files.map((p) => [`${dest}/${p}`, readFileSync(join(root, source, p), "utf8")]));
    assert.deepEqual(Object.fromEntries(Object.entries(staged).filter(([p]) => p.startsWith(`${dest}/`))), expected);
  }
});

// A host-level build setting: the pinned package index passes through only when the
// environment sets it, because the recipe's own default is the public index.
test("a host PIP_INDEX_URL reaches the pip stage only when set", async (t) => {
  const fx = fixture(t);
  const docker = fakeDocker(t, fx.dir, { PIP_INDEX_URL: "https://mirror.example.invalid/simple" });
  await run(publicApp(fx), ["--arch", "arm64"]);
  assert.deepEqual(argOf(docker.builds()[0].args, "PIP_INDEX_URL"), ["https://mirror.example.invalid/simple"]);
});

test("a missing private Maven settings file fails before any staging or build", async (t) => {
  const fx = fixture(t);
  rmSync(fx.settings);
  const docker = fakeDocker(t, fx.dir);
  await assert.rejects(() => run(enterpriseApp(fx, "override"), ["--arch", "arm64", "--license-mode", "override"]), /Missing Maven settings/);
  assert.deepEqual(docker.builds(), []);
  assert.equal(existsSync(join(fx.ent, ".build")), false);
});

test("an image whose license label differs from the mode is rejected", async (t) => {
  const fx = fixture(t);
  fakeDocker(t, fx.dir, { FAKE_MODE: "bad-label" });
  await assert.rejects(() => run(enterpriseApp(fx, "override"), ["--arch", "arm64", "--license-mode", "override"]), /Built image identity mismatch: datarag:/);
});
