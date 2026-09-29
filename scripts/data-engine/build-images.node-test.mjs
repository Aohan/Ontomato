import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import {
  buildJavaApp,
  computeDataEngineContract,
  JAVA_FLAGS,
  parseJavaArgs,
  selectPromptLanguage,
  verifyJavaTarget,
} from "./build-images.mjs";
import { fingerprint, loadRuntimeLock, readRevision } from "../build-support.mjs";
import { app as publicEntry } from "../../apps/data-engine/build.mjs";

function temporary(fn) {
  const dir = mkdtempSync(join(tmpdir(), "backend test café space-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the Java fingerprint comes from the runtime recipe, the exported jars and the pinned Python list", () => {
  const dir = mkdtempSync(join(tmpdir(), "de-contract-"));
  try {
    writeFileSync(join(dir, "a.jar"), "a");
    writeFileSync(join(dir, "libx.so"), "native");
    const recipe = "ARG PYTHON_RUNTIME_IMAGE=docker.io/library/python:3.10-slim-bookworm@sha256:x\nARG JRE_IMAGE=docker.io/library/eclipse-temurin:21-jre-jammy@sha256:y\n";
    const input = { dockerfileRuntimeText: recipe, exportedLibDir: dir, requirementsText: "numpy==1.26.4\n", arch: "arm64", interfaceVersion: 3 };
    const contract = computeDataEngineContract(input);
    assert.deepEqual(contract, {
      family: "java-app",
      interfaceVersion: 3,
      platform: "linux/arm64",
      java: { classVersion: 65 },
      runtimeDependencies: { jars: fingerprint({ "a.jar": createHash("sha256").update("a").digest("hex") }) },
      python: { version: "3.10", packages: { numpy: "1.26.4" } },
    });
    writeFileSync(join(dir, "libx.so"), "other native");
    assert.deepEqual(computeDataEngineContract(input), contract, "native files are not fingerprinted");
    assert.throws(() => computeDataEngineContract({ ...input, dockerfileRuntimeText: "ARG PYTHON_RUNTIME_IMAGE=docker.io/library/python:3.10-slim\n" }), /JRE major/);
    assert.throws(() => computeDataEngineContract({ ...input, dockerfileRuntimeText: "ARG JRE_IMAGE=docker.io/library/eclipse-temurin:21-jre-jammy\n" }), /Python version/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the POM's compiler target may not exceed the runtime JRE and must be declared", () => {
  verifyJavaTarget("<maven.compiler.target>21</maven.compiler.target>", 21);
  assert.throws(() => verifyJavaTarget("<maven.compiler.release>25</maven.compiler.release>", 21), /target 25 exceeds JRE major version 21/);
  assert.throws(() => verifyJavaTarget("<project></project>", 21), /declares no Java compiler target/);
});

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
      "<parent><version>3.5.0</version></parent><properties><revision>4.0.0-dev</revision></properties>",
    ),
    "4.0.0-dev",
  );
  assert.throws(() => readRevision("<revision>${revision}</revision>"));
  assert.throws(() =>
    readRevision("<revision>1</revision><revision>2</revision>"),
  );
  assert.throws(() => readRevision("<version>3.5.0</version>"));
  const live = readRevision(
    readFileSync(fileURLToPath(new URL("../../pom.xml", import.meta.url)), "utf8"),
  );
  assert.equal(live, "4.0.0-dev");
});
test("pack-app rejects a missing lock before any export or build", () =>
  temporary((dir) => {
    assert.throws(
      () => loadRuntimeLock(dir, "java-app", "arm64"),
      /missing/,
    );
  }));

// ---- CLI, recipes and the fake-Docker build chain (no real Docker, Maven or network) ----
// These prove the inputs handed to Docker; real compilation, class checks and images
// are verified only by a real build.
const RECIPES = fileURLToPath(new URL("../../docker/data-engine/", import.meta.url));
const VERSION = "9.9.9-test";
const LOCK = "apps/data-engine/runtime-lock.json";
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
    "scripts/data-engine/runtime-contract.py": "# public checker\n",
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
    "scripts/data-engine/enterprise-runtime-contract.py": "# enterprise checker\n",
  });
  const settings = join(dir, "home/.m2/settings.xml");
  put(dir, { "home/.m2/settings.xml": `<settings>${SETTINGS_MARK}</settings>\n` });
  return { dir, pub, ent, settings };
}
const publicTree = (pub) => ({ dest: "ontomato", root: pub, paths: ["pom.xml", "mvnw", "mvnw.cmd", ".mvn", "packages/data-engine-core/pom.xml", "packages/data-engine-core/src/main", "apps/data-engine/pom.xml", "apps/data-engine/src/main"] });
function publicApp({ pub }) {
  return {
    repoRoot: pub, lockRoot: join(pub, "apps/data-engine"), lockExclude: LOCK, versionPom: join(pub, "pom.xml"),
    sources: [{ id: "ontomato", root: pub }],
    component: "datarag-opensource", family: "java-app", interfaceVersion: 3, promptLang: "en", supportedPromptLangs: ["en"],
    reactorDir: "ontomato", appModule: "apps/data-engine", appLibModules: ["packages/data-engine-core", "apps/data-engine"], excludeArtifactIds: "data-engine-core,data-engine-app",
    contextTrees: [publicTree(pub)],
    secretExport: null,
    requirements: { root: pub, path: "packages/data-engine-core/requirements-py310.txt" },
    mcp: { root: pub, path: "packages/data-engine-core/mcp/mcpserver.py" },
    bin: [[pub, "scripts/data-engine/container-entrypoint.sh", "bin/container-entrypoint.sh"], [pub, "scripts/data-engine/runtime-contract.py", "bin/runtime-contract.py"]],
    pairContract: "/opt/datarag/bin/runtime-contract.py", runtimeTarget: "runtime",
    resources: [[pub, "packages/data-engine-core/conf-defaults", "payload/conf-defaults"], [pub, "packages/data-engine-core/skills", "payload/skills"]],
    requiredSkill: "payload/skills/aftercalculate/trend-forecaster/SKILL.md",
    payloadFiles: {}, appLabels: {}, appTagSuffix: "",
  };
}
// Enterprise-shaped description with the same fields as the private entry's.
function enterpriseApp({ pub, ent, settings }, mode) {
  const base = publicApp({ pub });
  return {
    ...base,
    repoRoot: ent, lockRoot: join(ent, "apps/data-engine"),
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
    bin: [...base.bin, [ent, "scripts/data-engine/enterprise-runtime-contract.py", "bin/enterprise-runtime-contract.py"]],
    pairContract: "/opt/datarag/bin/enterprise-runtime-contract.py", runtimeTarget: "runtime-native",
    resources: [
      [pub, "packages/data-engine-core/conf-defaults", "payload/conf-defaults"],
      [ent, "packages/data-engine-enterprise/conf-defaults", "payload/conf-defaults"],
      [pub, "packages/data-engine-core/skills", "payload/skills"],
      [ent, "packages/data-engine-enterprise/skills", "payload/skills"],
    ],
    payloadFiles: { "license-mode": mode }, appLabels: { "io.enterprise.license.mode": mode }, appTagSuffix: mode === "override" ? "-override" : "",
  };
}

// Minimal fixture Docker for this builder's calls. It records every argv and each
// build context's full file set (path -> content), writes plausible export outputs,
// and answers inspect from the labels it was given. FAKE_MODE=bad-label alters one
// app label.
const FAKE = `#!/usr/bin/env node
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const state = process.env.FAKE_STATE;
const canonical = (v) => Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : v !== null && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}" : JSON.stringify(v);
const contract = { family: "java-app", interfaceVersion: 3, platform: "linux/arm64", java: { version: "21", classVersion: 65 }, runtimeDependencies: { jars: "a", native: "b" }, python: { version: "3.10", packages: { numpy: "2.2.6" } } };
const fp = createHash("sha256").update(canonical(contract)).digest("hex");
const images = existsSync(join(state, "images.json")) ? JSON.parse(readFileSync(join(state, "images.json"), "utf8")) : {};
const save = () => writeFileSync(join(state, "images.json"), JSON.stringify(images));
const files = (root, prefix = "") => readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((e) => { const rel = prefix ? prefix + "/" + e.name : e.name; return e.isDirectory() ? files(root, rel) : [rel]; });
const value = (flag) => args.filter((a, i) => args[i - 1] === flag);
const buildArg = (name) => (value("--build-arg").find((a) => a.startsWith(name + "=")) || "").slice(name.length + 1);
if (args[0] === "version") { process.stdout.write("1.47\\n"); }
else if (args[0] === "buildx") {
  const context = args[args.length - 1];
  const snapshot = Object.fromEntries(files(context).sort().map((p) => [p, readFileSync(join(context, p), "utf8")]));
  const target = value("--target")[0] || "app";
  appendFileSync(join(state, "builds.jsonl"), JSON.stringify({ target, args, context: snapshot }) + "\\n");
  const dest = (value("--output")[0] || "").replace("type=local,dest=", "");
  if (target === "export-central" || target === "export-secret") {
    mkdirSync(join(dest, "app/lib"), { recursive: true });
    mkdirSync(join(dest, "runtime-lib"), { recursive: true });
    for (const m of buildArg("APP_LIB_MODULES").split(" ")) writeFileSync(join(dest, "app/lib", m.split("/").pop() + ".jar"), "jar");
    writeFileSync(join(dest, "runtime-lib/dep.jar"), "dep");
    writeFileSync(join(dest, "maven-licenses.json"), "[]");
    if (buildArg("KEEP_NATIVE")) writeFileSync(join(dest, "runtime-lib", buildArg("KEEP_NATIVE")), "so");
  } else {
    const labels = {};
    for (const l of value("--label")) { const at = l.indexOf("="); labels[l.slice(0, at)] = l.slice(at + 1); }
    if (process.env.FAKE_MODE === "bad-label" && target === "app") labels["io.enterprise.license.mode"] = "real";
    for (const tag of value("-t")) images[tag] = labels;
    save();
  }
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
  for (const key of ["PATH", "FAKE_STATE", "FAKE_MODE", "DOCKER_API_VERSION"]) {
    saved[key] = process.env[key];
    if (set[key] === undefined) delete process.env[key];
    else process.env[key] = set[key];
  }
  t.after(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  const builds = () => (existsSync(join(state, "builds.jsonl")) ? readFileSync(join(state, "builds.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  return {
    builds,
    build: (target) => builds().find((b) => b.target === target),
    images: () => JSON.parse(readFileSync(join(state, "images.json"), "utf8")),
    importRuntime: (tag, labels) => writeFileSync(join(state, "images.json"), JSON.stringify({ [tag]: labels })),
  };
}
const argOf = (argv, name) => argv.filter((a, i) => argv[i - 1] === "--build-arg" && a.startsWith(`${name}=`)).map((a) => a.slice(name.length + 1));
const run = (app, args) => buildJavaApp(app, parseJavaArgs(args, { ...JAVA_FLAGS, "--license-mode": "value" }));

test("the CLI is parsed once; help reads nothing and bad input fails before any build", () => {
  assert.deepEqual(parseJavaArgs(["--help"], JAVA_FLAGS), { help: true });
  assert.deepEqual(parseJavaArgs(["all", "--arch", "arm64", "--prompt-lang", "zh"], JAVA_FLAGS), { help: false, command: "all", parsed: { "--arch": "arm64", "--prompt-lang": "zh" } });
  assert.throws(() => parseJavaArgs(["runtime", "--arch", "arm64"], JAVA_FLAGS), /Expected all or app/);
  assert.throws(() => parseJavaArgs(["all"], JAVA_FLAGS), /Required --arch/);
  assert.throws(() => parseJavaArgs(["all", "--arch", "arm64", "--license-mode", "real"], JAVA_FLAGS), /Unknown argument/);
  assert.throws(() => parseJavaArgs(["app", "--arch", "arm64", "--pack-runtime"], JAVA_FLAGS), /does not match build action/);
});

test("recipes: the secret export checks one explicit script on the exported jar; runtime-native only adds the JNA CMD", () => {
  const build = readFileSync(join(RECIPES, "Dockerfile.build"), "utf8");
  const runtime = readFileSync(join(RECIPES, "Dockerfile.runtime"), "utf8");
  const secret = build.slice(build.indexOf("FROM enterprise-src AS build-secret"), build.indexOf("FROM scratch AS export-secret"));
  const central = build.slice(build.indexOf("FROM recipe AS build-central"), build.indexOf("FROM scratch AS export-central"));
  assert.match(secret, /test -n "\$\{APP_CHECK_SCRIPT\}" && test -n "\$\{APP_CHECK_JAR\}" && test -n "\$\{APP_CHECK_ARG\}" \\\n && MAVEN_SETTINGS=\/run\/secrets\/maven-settings \/usr\/local\/bin\/export-java.sh \\\n && sh "\$\{APP_CHECK_SCRIPT\}" "\$\{APP_CHECK_JAR\}" "\$\{APP_CHECK_ARG\}"\n/);
  assert.doesNotMatch(central, /APP_CHECK/);
  // Both exports run the one export script, which writes the jar license records.
  assert.match(build, /org\.codehaus\.mojo:license-maven-plugin:2\.4\.0:add-third-party[\s\S]*cp "\$\{reactor\}\/\$\{APP_MODULE\}\/target\/generated-sources\/license\/maven-licenses\.json" \/out\/maven-licenses\.json\n/);
  assert.match(runtime, /third_party_notices\.py \/licenses\/THIRD_PARTY_NOTICES\.txt --python --jars \/opt\/datarag\/lib \/tmp\/maven-licenses\.json/);
  assert.doesNotMatch(build + runtime, /verify-license|data-engine-enterprise|license-mode|LicenseConfig/);
  assert.match(runtime, /\nFROM runtime-files AS runtime\n[\s\S]*ENTRYPOINT \["\/opt\/datarag\/bin\/container-entrypoint.sh"\]\nCMD \[\]\n[\s\S]*FROM runtime AS runtime-native\nCMD \["-Djna.library.path=\/opt\/datarag\/lib"\]\n$/);
});

test("public build: central export of the public tree only, runtime target and en prompts", async (t) => {
  const fx = fixture(t);
  const docker = fakeDocker(t, fx.dir);
  await run(publicApp(fx), ["all", "--arch", "arm64", "--prompt-lang", "en"]);
  const exp = docker.build("export-central");
  assert.equal(docker.build("export-secret"), undefined);
  assert.equal(exp.args.some((a) => a === "--secret" || /^(KEEP_NATIVE|LICENSE_PROFILE|APP_CHECK_)/.test(a)), false);
  assert.deepEqual(Object.keys(exp.context).filter((p) => !p.startsWith("ontomato/")), []);
  assert.equal(Object.keys(exp.context).some((p) => p.includes("src/test")), false);
  assert.deepEqual(argOf(exp.args, "APP_LIB_MODULES"), ["packages/data-engine-core apps/data-engine"]);
  const runtime = docker.build("runtime");
  assert.ok(runtime && !docker.build("runtime-native"));
  assert.deepEqual(Object.keys(runtime.context).filter((p) => p.startsWith("bin/")), ["bin/container-entrypoint.sh", "bin/runtime-contract.py"]);
  assert.equal(runtime.context["requirements-py310.txt"], "numpy==2.2.6\n");
  // Third-party notice inputs; the public LICENSE and NOTICE go to both images.
  const shipped = (name) => readFileSync(join(RECIPES, "../..", name), "utf8");
  assert.equal(runtime.context["maven-licenses.json"], "[]");
  assert.equal(runtime.context["tools/third_party_notices.py"], shipped("scripts/third_party_notices.py"));
  assert.equal(Object.keys(runtime.context).some((p) => p.startsWith("lib/") && p !== "lib/dep.jar"), false);
  const app = docker.build("app");
  assert.equal(app.context["payload/conf-defaults/prompt.md"], "public English\n");
  assert.equal(app.context["payload/conf-defaults/static/login.html"], "oss page\n");
  assert.equal(app.context["payload/skills/aftercalculate/trend-forecaster/SKILL.md"], "public skill English\n");
  assert.equal(Object.keys(app.context).some((p) => /\.(zh|en)\.[^./]+$/.test(p)), false);
  assert.equal("payload/license-mode" in app.context, false);
  for (const name of ["LICENSE", "NOTICE"]) {
    assert.equal(runtime.context[name], shipped(name));
    assert.equal(app.context[`payload/licenses/${name}`], shipped(name));
  }
  const head = git(fx.pub, "rev-parse", "HEAD");
  const tag = app.args[app.args.indexOf("-t") + 1];
  assert.match(tag, new RegExp(`^datarag-opensource-app:${VERSION}-\\d{8}-\\d{6}-g${head.slice(0, 12)}-arm64$`));
  // App and runtime carry the version, component, kind and the runtime pair only.
  const runtimeFp = argOf(runtime.args, "RUNTIME_COMPAT_FINGERPRINT")[0];
  assert.deepEqual(docker.images()[tag], {
    "org.opencontainers.image.version": VERSION,
    "io.runtime.component": "datarag-opensource",
    "io.runtime.kind": "app",
    "io.runtime.compat-fingerprint": runtimeFp,
    "io.runtime.family": "java-app",
  });
  assert.deepEqual(docker.images()[runtime.args[runtime.args.indexOf("-t") + 1]], {
    "org.opencontainers.image.version": VERSION,
    "io.runtime.component": "java-app",
    "io.runtime.kind": "runtime",
    "io.runtime.compat-fingerprint": runtimeFp,
    "io.runtime.family": "java-app",
  });
  assert.equal(JSON.parse(readFileSync(join(fx.pub, LOCK), "utf8")).runtimes["linux/arm64"].length, 64);
});

for (const mode of ["real", "override"])
  test(`enterprise ${mode}: secret export with the explicit jar check, native runtime, public-then-enterprise resources, one mode everywhere`, async (t) => {
    const fx = fixture(t);
    put(fx.pub, { "packages/data-engine-core/conf-defaults/draft.md": "untracked public\n" });
    const docker = fakeDocker(t, fx.dir);
    await run(enterpriseApp(fx, mode), ["all", "--arch", "arm64", "--license-mode", mode, "--prompt-lang", "zh"]);
    const exp = docker.build("export-secret");
    assert.deepEqual(exp.args.slice(exp.args.indexOf("--secret"), exp.args.indexOf("--secret") + 2), ["--secret", `id=maven-settings,src=${fx.settings}`]);
    assert.deepEqual(argOf(exp.args, "APP_CHECK_SCRIPT"), ["enterprise/scripts/data-engine/verify-license-jar.sh"]);
    assert.deepEqual(argOf(exp.args, "APP_CHECK_JAR"), [`/out/app/lib/data-engine-enterprise-${VERSION}.jar`]);
    assert.deepEqual(argOf(exp.args, "APP_CHECK_ARG"), [mode]);
    assert.deepEqual(argOf(exp.args, "LICENSE_PROFILE"), [mode === "override" ? "dev-override" : ""]);
    assert.deepEqual(argOf(exp.args, "KEEP_NATIVE"), ["libLicense-native-aarch64-5.4.2.so"]);
    assert.equal(exp.args[exp.args.indexOf("--target") + 1], "export-secret");
    assert.ok("enterprise/scripts/data-engine/verify-license-jar.sh" in exp.context);
    assert.ok("enterprise/packages/data-engine-enterprise/src/license-override/java/L.java" in exp.context);
    assert.equal(Object.keys(exp.context).some((p) => /conf-defaults|skills|runtime-contract|src\/test/.test(p)), false);
    const everything = JSON.stringify(docker.builds());
    assert.equal(everything.includes(SETTINGS_MARK), false);
    const runtime = docker.build("runtime-native");
    assert.ok(runtime && !docker.build("runtime"));
    assert.deepEqual(argOf(runtime.args, "PAIR_CONTRACT"), ["/opt/datarag/bin/enterprise-runtime-contract.py"]);
    assert.equal(runtime.context["bin/enterprise-runtime-contract.py"], "# enterprise checker\n");
    assert.equal(runtime.context["lib/libLicense-native-aarch64-5.4.2.so"], "so");
    const app = docker.build("app");
    assert.equal(app.context["payload/conf-defaults/prompt.md"], "enterprise Chinese\n");
    assert.equal(app.context["payload/conf-defaults/application.yml"], "app: public\n");
    assert.equal(app.context["payload/conf-defaults/draft.md"], "untracked public\n");
    assert.equal(app.context["payload/conf-defaults/lang/zh-CN.json"], "{}\n");
    assert.equal(app.context["payload/conf-defaults/static/login.html"], "enterprise page\n");
    assert.equal(Object.keys(app.context).some((p) => /\.(zh|en)\.[^./]+$/.test(p)), false);
    assert.equal(app.context["payload/skills/aftercalculate/trend-forecaster/SKILL.md"], "enterprise skill Chinese\n");
    assert.equal(app.context["payload/skills/aftercalculate/trend-forecaster/scripts/forecaster.py"], "# py\n");
    assert.equal(app.context["payload/license-mode"], mode);
    // The fake names each exported jar after its module directory.
    assert.deepEqual(Object.keys(app.context).filter((p) => p.startsWith("payload/lib/")), ["payload/lib/data-engine-core.jar", "payload/lib/data-engine-enterprise.jar", "payload/lib/data-engine.jar"]);
    const tag = app.args[app.args.indexOf("-t") + 1];
    const enterpriseHead = git(fx.ent, "rev-parse", "HEAD");
    assert.match(tag, new RegExp(`^datarag-app:${VERSION}-\\d{8}-\\d{6}-g${enterpriseHead.slice(0, 12)}-dirty${mode === "override" ? "-override" : ""}-arm64$`));
    // The edition mode is the only app label on top of the shared runtime pair.
    const runtimeFp = argOf(runtime.args, "RUNTIME_COMPAT_FINGERPRINT")[0];
    assert.deepEqual(docker.images()[tag], {
      "org.opencontainers.image.version": VERSION,
      "io.runtime.component": "datarag",
      "io.runtime.kind": "app",
      "io.runtime.compat-fingerprint": runtimeFp,
      "io.runtime.family": "java-app",
      "io.enterprise.license.mode": mode,
    });
    assert.deepEqual(docker.images()[runtime.args[runtime.args.indexOf("-t") + 1]], {
      "org.opencontainers.image.version": VERSION,
      "io.runtime.component": "java-app",
      "io.runtime.kind": "runtime",
      "io.runtime.compat-fingerprint": runtimeFp,
      "io.runtime.family": "java-app",
    });
  });

test("enterprise en: the public English defaults stay under the overlay's Chinese variants and the edition page stays", async (t) => {
  const fx = fixture(t);
  const docker = fakeDocker(t, fx.dir);
  await run(enterpriseApp(fx, "real"), ["all", "--arch", "arm64", "--license-mode", "real", "--prompt-lang", "en"]);
  const app = docker.build("app");
  assert.equal(app.context["payload/conf-defaults/prompt.md"], "public English\n");
  assert.equal(app.context["payload/conf-defaults/static/login.html"], "enterprise page\n");
  assert.equal(app.context["payload/conf-defaults/lang/zh-CN.json"], "{}\n");
  assert.equal(app.context["payload/skills/aftercalculate/trend-forecaster/SKILL.md"], "public skill English\n");
  assert.equal(Object.keys(app.context).some((p) => /\.(zh|en)\.[^./]+$/.test(p)), false);
});

// The real public entry declares English only: another language fails before any build step, and
// the real public resource trees are staged unchanged.
test("real public entry rejects an undeclared prompt language before building", async (t) => {
  const fx = fixture(t);
  const docker = fakeDocker(t, fx.dir);
  const app = { ...publicApp(fx), resources: publicEntry.resources, supportedPromptLangs: publicEntry.supportedPromptLangs };
  await assert.rejects(() => run(app, ["all", "--arch", "arm64", "--prompt-lang", "zh"]), /Expected --prompt-lang en$/);
  assert.equal(existsSync(join(fx.pub, ".build")), false);
  await run(app, ["all", "--arch", "arm64", "--prompt-lang", "en"]);
  const staged = docker.build("app").context;
  for (const [root, source, dest] of publicEntry.resources) {
    const files = readdirSync(join(root, source), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(join(root, source).length + 1));
    const expected = Object.fromEntries(files.map((p) => [`${dest}/${p}`, readFileSync(join(root, source, p), "utf8")]));
    assert.deepEqual(Object.fromEntries(Object.entries(staged).filter(([p]) => p.startsWith(`${dest}/`))), expected);
  }
});

test("app-only: a missing lock fails before settings or export; with a lock no runtime is ever built", async (t) => {
  const fx = fixture(t);
  rmSync(fx.settings);
  const docker = fakeDocker(t, fx.dir);
  await assert.rejects(() => run(enterpriseApp(fx, "override"), ["app", "--arch", "arm64", "--license-mode", "override", "--pack-app"]), /runtime-lock.json missing/);
  assert.deepEqual(docker.builds(), []);
  const depHash = createHash("sha256").update("dep").digest("hex");
  const contract = {
    family: "java-app",
    interfaceVersion: 3,
    platform: "linux/arm64",
    java: { classVersion: 65 },
    runtimeDependencies: { jars: fingerprint({ "dep.jar": depHash }) },
    python: { version: "3.10", packages: { numpy: "2.2.6" } },
  };
  const fp = fingerprint(contract);
  put(fx.ent, { [LOCK]: `${JSON.stringify({ schema: 3, family: "java-app", runtimes: { "linux/arm64": fp } }, null, 2)}\n` });
  const lock = readFileSync(join(fx.ent, LOCK), "utf8");
  await assert.rejects(() => run(enterpriseApp(fx, "override"), ["app", "--arch", "arm64", "--license-mode", "override"]), /Missing Maven settings/);
  assert.deepEqual(docker.builds(), []);
  put(fx.dir, { "home/.m2/settings.xml": "<settings/>\n" });
  await run(enterpriseApp(fx, "override"), ["app", "--arch", "arm64", "--license-mode", "override"]);
  assert.deepEqual(docker.builds().map((b) => b.target), ["export-secret", "app"]);
  assert.equal(readFileSync(join(fx.ent, LOCK), "utf8"), lock);
});

test("an app image whose license label differs from the mode is rejected", async (t) => {
  const fx = fixture(t);
  fakeDocker(t, fx.dir, { FAKE_MODE: "bad-label" });
  await assert.rejects(() => run(enterpriseApp(fx, "override"), ["all", "--arch", "arm64", "--license-mode", "override"]), /Built image identity mismatch: datarag-app:/);
});
