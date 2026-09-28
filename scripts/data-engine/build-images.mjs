// Shared data-engine image orchestration. Product names, sources, resources and the
// edition's export inputs come from the app entry's description; the CLI is parsed once.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertEntriesCurrent,
  combineIdentity,
  COMPAT_LABEL,
  docker,
  exportImage,
  fingerprint,
  imageLabels,
  inspectImage,
  loadRuntimeLock,
  output,
  parseOptions,
  readJson,
  readRevision,
  requireRuntime,
  runtimeTag,
  sampleSources,
  saveRuntimeLock,
  validateContract,
} from "../build-support.mjs";

export const JAVA_FLAGS = {
  "--arch": "value",
  "--prompt-lang": "value",
  "--pack-runtime": "boolean",
  "--pack-app": "boolean",
};
// This shared builder lives in the public repository, whose own license files
// every image ships, for either edition.
const PUBLIC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RECIPE_DIR = join(PUBLIC_ROOT, "docker/data-engine");
function copyLicenses(destination) {
  for (const name of ["LICENSE", "NOTICE"])
    copyFrom(PUBLIC_ROOT, name, join(destination, name));
}

export function selectPromptLanguage(root, lang) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) selectPromptLanguage(path, lang);
    else if (entry.isFile() && /\.en\.[^.]+$/.test(entry.name)) {
      if (lang === "en")
        renameSync(path, join(root, entry.name.replace(/\.en(\.[^.]+)$/, "$1")));
      else rmSync(path);
    }
  }
}
export function checkPythonRequirements(text, packages) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s*#.*$/, "").trim();
    if (!line) continue;
    const match = /^([A-Za-z0-9_.-]+)==([^\s;]+)$/.exec(line);
    if (!match)
      throw new Error(
        `Runtime Python requirements need exact name==version pins: ${line}`,
      );
    const name = match[1].toLowerCase().replace(/[-_.]+/g, "-");
    if (packages[name] !== match[2])
      throw new Error(
        `Runtime Python dependency mismatch: ${name} requires ${match[2]}, provides ${packages[name] || "missing"}. Publish a matching runtime with make pack.`,
      );
  }
}
function resetDirectory(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}
// One label carries the real source combination (top revision: the app repo).
const SOURCES_LABEL = "io.runtime.sources";
function copyFrom(root, source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(join(root, source), destination, { recursive: true });
}
function baseBuild(arch) {
  return ["buildx", "build", "--provenance=false", "--platform", `linux/${arch}`];
}
function envArgs(names) {
  const args = [];
  for (const name of names) {
    const value = process.env[name];
    if (value) args.push("--build-arg", `${name}=${value}`);
  }
  return args;
}
function dockerfile(name) {
  return join(RECIPE_DIR, name);
}
function readImageContract(image, arch) {
  return JSON.parse(
    output("docker", [
      "run",
      "--rm",
      "--platform",
      `linux/${arch}`,
      "--entrypoint",
      "cat",
      image,
      "/opt/datarag/runtime-contract.json",
    ]),
  );
}
function labelArgs(labels) {
  return Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]);
}
function assertImage(image, arch, kind, component, fp, expected) {
  const inspected = inspectImage(image, `linux/${arch}`);
  const labels = inspected && inspected.Config.Labels ? inspected.Config.Labels : {};
  if (
    !inspected ||
    inspected.Os !== "linux" ||
    inspected.Architecture !== arch ||
    labels["io.runtime.component"] !== component ||
    labels["io.runtime.kind"] !== kind ||
    labels[COMPAT_LABEL] !== fp ||
    Object.entries(expected).some(([key, value]) => labels[key] !== value)
  )
    throw new Error(`Built image identity mismatch: ${image}`);
}
export function importedRuntime(app, arch) {
  const fp = loadRuntimeLock(app.lockRoot, app.family, arch);
  const tag = requireRuntime(app.family, arch, fp);
  const contract = validateContract(
    app.family,
    `linux/${arch}`,
    readImageContract(tag, arch),
    fp,
    app.interfaceVersion,
  );
  checkPythonRequirements(
    readFileSync(join(app.requirements.root, app.requirements.path), "utf8"),
    contract.python.packages,
  );
  return { tag, alias: `${app.component}-runtime:deploy-${arch}`, fp, contract };
}
// Central export needs no settings or checker. The secret export takes the Maven
// settings file only as a BuildKit secret (never copied or read here), the target
// native library, the license profile, and one artifact check run in the same
// JDK stage on the exported jar, named by Maven's default <artifactId>-<version>.jar.
function secretExportArgs(secret, version) {
  if (!existsSync(secret.mavenSettings))
    throw new Error(
      `Missing Maven settings at ${secret.mavenSettings}; provide the private repository configuration as a BuildKit secret.`,
    );
  return [
    "--secret",
    `id=maven-settings,src=${secret.mavenSettings}`,
    "--build-arg",
    `KEEP_NATIVE=${secret.keepNative}`,
    "--build-arg",
    `LICENSE_PROFILE=${secret.licenseProfile}`,
    "--build-arg",
    `APP_CHECK_SCRIPT=${secret.check.script}`,
    "--build-arg",
    `APP_CHECK_JAR=/out/app/lib/${secret.check.jarArtifactId}-${version}.jar`,
    "--build-arg",
    `APP_CHECK_ARG=${secret.check.argument}`,
  ];
}
function exportJava(app, arch, entries, version) {
  const context = join(app.repoRoot, ".build", "contexts", arch, "export");
  const dest = join(app.repoRoot, ".build", "contexts", arch, "exported");
  resetDirectory(context);
  resetDirectory(dest);
  for (const tree of app.contextTrees)
    for (const path of tree.paths)
      copyFrom(tree.root, path, join(context, tree.dest, path));
  // The trees were copied file by file after sampling: the sampled HEADs must hold.
  assertEntriesCurrent(entries, "staging");
  const target = app.secretExport ? "export-secret" : "export-central";
  const secretArgs = app.secretExport ? secretExportArgs(app.secretExport, version) : [];
  console.log(`MAVEN_EXPORT=${target}`);
  docker([
    ...baseBuild(arch),
    ...envArgs(app.exportImages),
    ...secretArgs,
    "--target",
    target,
    "--build-arg",
    `REACTOR_DIR=${app.reactorDir}`,
    "--build-arg",
    `APP_MODULE=${app.appModule}`,
    "--build-arg",
    `APP_LIB_MODULES=${app.appLibModules.join(" ")}`,
    "--build-arg",
    `EXCLUDE_ARTIFACT_IDS=${app.excludeArtifactIds}`,
    "-f",
    dockerfile("Dockerfile.build"),
    "--output",
    `type=local,dest=${dest}`,
    context,
  ]);
  return dest;
}
function stageRuntime(app, arch, exported) {
  const context = join(app.repoRoot, ".build", "contexts", arch, "runtime");
  resetDirectory(context);
  copyFrom(app.requirements.root, app.requirements.path, join(context, "requirements-py310.txt"));
  copyFrom(app.mcp.root, app.mcp.path, join(context, "mcp/mcpserver.py"));
  cpSync(join(exported, "runtime-lib"), join(context, "lib"), { recursive: true });
  cpSync(join(exported, "maven-licenses.json"), join(context, "maven-licenses.json"));
  copyFrom(PUBLIC_ROOT, "scripts/third_party_notices.py", join(context, "tools/third_party_notices.py"));
  copyLicenses(context);
  for (const [root, source, dest] of app.bin) copyFrom(root, source, join(context, dest));
  writeFileSync(join(context, "runtime-arch.txt"), arch);
  return context;
}
function buildRuntime(app, arch, identity, entries, exported) {
  const context = stageRuntime(app, arch, exported);
  const directory = join(app.repoRoot, ".build", `runtime-contract-${arch}`);
  const common = [
    ...baseBuild(arch),
    ...envArgs(app.runtimeImages),
    "--build-arg",
    `PAIR_CONTRACT=${app.pairContract}`,
    "--build-arg",
    `RUNTIME_CONTRACT_VERSION=${app.interfaceVersion}`,
    "-f",
    dockerfile("Dockerfile.runtime"),
  ];
  resetDirectory(directory);
  docker([
    ...common,
    "--target",
    "contract-export",
    "--output",
    `type=local,dest=${directory}`,
    context,
  ]);
  const contract = readJson(join(directory, "contract.json"));
  const fp = fingerprint(contract);
  validateContract(app.family, `linux/${arch}`, contract, fp, app.interfaceVersion);
  const tag = runtimeTag(app.family, fp, arch);
  const alias = `${app.component}-runtime:deploy-${arch}`;
  console.log(`[build] runtime ${tag}`);
  const sources = { [SOURCES_LABEL]: JSON.stringify(identity.sources) };
  docker([
    ...common,
    "--target",
    app.runtimeTarget,
    "--load",
    "--build-arg",
    `RUNTIME_COMPAT_FINGERPRINT=${fp}`,
    ...imageLabels(app.family, "runtime", identity, fp, app.family),
    ...labelArgs(sources),
    "-t",
    tag,
    "-t",
    alias,
    context,
  ]);
  assertImage(tag, arch, "runtime", app.family, fp, sources);
  if (fingerprint(readImageContract(tag, arch)) !== fp)
    throw new Error("Built runtime contract differs from exported contract");
  // The lock describes this build's inputs: a source that moved since sampling fails.
  assertEntriesCurrent(entries, "the build");
  saveRuntimeLock(app.lockRoot, app.family, arch, contract, app.interfaceVersion);
  return { tag, alias, fp, contract };
}
// The entry's resources under `context`, shared by the app image and the host dev entry:
// copied in the listed order (a later source overwrites the same name), then the prompt
// language is selected once per target after all copies.
export function stageResources(app, context, lang) {
  for (const [root, source, dest] of app.resources) copyFrom(root, source, join(context, dest));
  for (const dest of new Set(app.resources.map(([, , dest]) => dest)))
    selectPromptLanguage(join(context, dest), lang);
  if (!existsSync(join(context, app.requiredSkill)))
    throw new Error("Missing default trend-forecaster skill");
}
function stageApp(app, arch, exported, lang) {
  const context = join(app.repoRoot, ".build", "contexts", arch, "app");
  resetDirectory(context);
  cpSync(join(exported, "runtime-lib"), join(context, "runtime-lib"), {
    recursive: true,
  });
  cpSync(join(exported, "app", "lib"), join(context, "payload", "lib"), {
    recursive: true,
  });
  copyFrom(app.requirements.root, app.requirements.path, join(context, "requirements-py310.txt"));
  stageResources(app, context, lang);
  // The payload is only the product's own jars and resources: no third-party notices.
  copyLicenses(join(context, "payload", "licenses"));
  for (const [name, content] of Object.entries(app.payloadFiles))
    writeFileSync(join(context, "payload", name), content);
  return context;
}
function buildApp(app, arch, identity, entries, exported, runtime, lang) {
  const context = stageApp(app, arch, exported, lang);
  const tag = `${app.component}-app:${identity.stamp}${app.appTagSuffix}-${arch}`;
  const alias = `${app.component}-app:deploy`;
  const labels = {
    [app.promptLabel]: lang,
    ...app.appLabels,
    [SOURCES_LABEL]: JSON.stringify(identity.sources),
  };
  console.log(`[build] app ${tag} (prompt=${lang})`);
  docker([
    ...baseBuild(arch),
    "--load",
    "--build-arg",
    `RUNTIME_IMAGE=${runtime.tag}`,
    "--build-arg",
    `RUNTIME_COMPAT_FINGERPRINT=${runtime.fp}`,
    ...imageLabels(app.component, "app", identity, runtime.fp, app.family),
    ...labelArgs(labels),
    "-t",
    tag,
    "-t",
    alias,
    "-f",
    dockerfile("Dockerfile.app"),
    context,
  ]);
  assertImage(tag, arch, "app", app.component, runtime.fp, labels);
  assertEntriesCurrent(entries, "the build");
  docker(["tag", runtime.tag, runtime.alias]);
  return { tag, alias };
}
async function pack(app, image, role) {
  const suffix = image.tag.slice(image.tag.indexOf(":") + 1);
  await exportImage(
    [image.tag, image.alias],
    join(app.repoRoot, ".build", "pack", `${app.component}-${role}-${suffix}.tar.gz`),
  );
}
// The one CLI parse. Help returns before any Git, settings or Docker read; the
// entry prints its own help. Edition flags (the private --license-mode) are part
// of `flags` and are interpreted by that entry only.
export function parseJavaArgs(args, flags) {
  if (args.includes("--help") || args.includes("-h")) return { help: true };
  const [command, ...rest] = args;
  if (!["all", "app"].includes(command))
    throw new Error("Expected all or app (normally invoked through Make)");
  const parsed = parseOptions(rest, flags);
  if (command === "app" && parsed["--pack-runtime"])
    throw new Error("Packaging flag does not match build action");
  return { help: false, command, parsed };
}
export async function buildJavaApp(app, { command, parsed }) {
  const arch = parsed["--arch"];
  const lang = parsed["--prompt-lang"] ?? app.promptLang;
  if (!["zh", "en"].includes(lang)) throw new Error("Expected --prompt-lang zh|en");
  console.log(`DOCKERFILES=${RECIPE_DIR}`);
  const version = readRevision(readFileSync(app.versionPom, "utf8"));
  // Each source is sampled once; later checks read HEAD only and never resample.
  const entries = sampleSources(app, version);
  const identity = combineIdentity(version, app.repoRoot, entries);
  console.log(
    `SOURCE_REVISION=${identity.revision} SOURCE_DIRTY=${identity.dirty} VERSION=${version}`,
  );
  output("docker", ["version", "--format", "{{.Server.Version}}"]);
  // Lock and imported-image failures happen before the Maven export.
  const imported = command === "app" ? importedRuntime(app, arch) : null;
  const exported = exportJava(app, arch, entries, version);
  const runtime = imported ?? buildRuntime(app, arch, identity, entries, exported);
  console.log(
    `RUNTIME_IMAGE=${runtime.tag}\nRUNTIME_DEPLOY_IMAGE=${runtime.alias}\nRUNTIME_COMPAT_FINGERPRINT=${runtime.fp}`,
  );
  if (parsed["--pack-runtime"]) await pack(app, runtime, "runtime");
  const built = buildApp(app, arch, identity, entries, exported, runtime, lang);
  console.log(`APP_IMAGE=${built.tag}\nAPP_DEPLOY_IMAGE=${built.alias}`);
  if (parsed["--pack-app"]) await pack(app, built, "app");
}
