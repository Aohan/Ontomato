// Shared data-engine image orchestration. Product names, sources, resources and the
// edition's export inputs come from the app entry's description; the CLI is parsed once.
import { createHash } from "node:crypto";
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
  buildStamp,
  COMPAT_LABEL,
  docker,
  exportImage,
  fingerprint,
  imageLabels,
  inspectImage,
  loadRuntimeLock,
  parseOptions,
  parsePythonRequirements,
  readRevision,
  runtimeTag,
  sampleSources,
  saveRuntimeLock,
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

// Resources are English under the plain name. An edition's other language is a `name.<lang>.ext`
// variant for one of its declared languages: the selected one replaces the plain file, the rest are dropped.
export function selectPromptLanguage(root, lang, langs) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const variant = /\.([^.]+)(\.[^.]+)$/.exec(entry.name);
    if (entry.isDirectory()) selectPromptLanguage(path, lang, langs);
    else if (entry.isFile() && variant && langs.includes(variant[1])) {
      if (variant[1] === lang) renameSync(path, join(root, entry.name.slice(0, variant.index) + variant[2]));
      else rmSync(path);
    }
  }
}
function resetDirectory(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}
function copyFrom(root, source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(join(root, source), destination, { recursive: true });
}
function baseBuild(arch) {
  return ["buildx", "build", "--provenance=false", "--platform", `linux/${arch}`];
}
function dockerfile(name) {
  return join(RECIPE_DIR, name);
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

export function computeDataEngineContract({
  dockerfileRuntimeText,
  exportedLibDir,
  requirementsText,
  arch,
  interfaceVersion,
}) {
  if (typeof interfaceVersion !== "number")
    throw new Error("interfaceVersion is required and must be a number");
  if (!dockerfileRuntimeText)
    throw new Error("dockerfileRuntimeText is required");
  const jreMatch = /ARG\s+JRE_IMAGE=[^\s]+:(\d+)-jre/.exec(dockerfileRuntimeText);
  if (!jreMatch) throw new Error("Could not parse JRE major version from Dockerfile.runtime");
  const major = parseInt(jreMatch[1], 10);
  const classVersion = major + 44;
  const jars = {};
  for (const name of readdirSync(exportedLibDir).sort()) {
    if (name.endsWith(".jar")) {
      const file = join(exportedLibDir, name);
      jars[name] = createHash("sha256").update(readFileSync(file)).digest("hex");
    }
  }
  if (Object.keys(jars).length === 0) {
    throw new Error("Runtime is missing Java dependencies");
  }

  const pythonMatch = /ARG\s+PYTHON_RUNTIME_IMAGE=[^\s]+python:(\d+\.\d+)/.exec(dockerfileRuntimeText);
  if (!pythonMatch) throw new Error("Could not parse Python version line from Dockerfile.runtime");
  const pythonVersion = pythonMatch[1];

  const packages = parsePythonRequirements(requirementsText);

  return {
    family: "java-app",
    interfaceVersion,
    platform: `linux/${arch}`,
    java: { classVersion },
    runtimeDependencies: { jars: fingerprint(jars) },
    python: { version: pythonVersion, packages },
  };
}

// The app's bytecode level is declared by the version POM; the runtime's JRE
// major comes from the fingerprint. No declared level is an error, not a pass.
export function verifyJavaTarget(pomText, maxMajor) {
  const targets = [
    ...pomText.matchAll(/<(?:java\.version|maven\.compiler\.target|maven\.compiler\.release)>(\d+)<\//g),
  ].map((match) => parseInt(match[1], 10));
  if (targets.length === 0) throw new Error("pom declares no Java compiler target");
  for (const target of targets)
    if (target > maxMajor)
      throw new Error(`pom compiler target ${target} exceeds JRE major version ${maxMajor}`);
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
function exportJava(app, arch, version) {
  const context = join(app.repoRoot, ".build", "contexts", arch, "export");
  const dest = join(app.repoRoot, ".build", "contexts", arch, "exported");
  resetDirectory(context);
  resetDirectory(dest);
  for (const tree of app.contextTrees)
    for (const path of tree.paths)
      copyFrom(tree.root, path, join(context, tree.dest, path));
  const target = app.secretExport ? "export-secret" : "export-central";
  const secretArgs = app.secretExport ? secretExportArgs(app.secretExport, version) : [];
  docker([
    ...baseBuild(arch),
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
function stageRuntime(app, arch, exported, contract) {
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
  writeFileSync(join(context, "runtime-contract.json"), `${JSON.stringify(contract)}\n`);
  return context;
}
function buildRuntime(app, arch, version, exported, contract, fp) {
  const context = stageRuntime(app, arch, exported, contract);
  const tag = runtimeTag(app.family, fp, arch);
  const alias = `${app.component}-runtime:deploy-${arch}`;
  console.log(`[build] runtime ${tag}`);
  const pipArgs = process.env.PIP_INDEX_URL
    ? ["--build-arg", `PIP_INDEX_URL=${process.env.PIP_INDEX_URL}`]
    : [];
  docker([
    ...baseBuild(arch),
    ...pipArgs,
    "--target",
    app.runtimeTarget,
    "--load",
    "--build-arg",
    `PAIR_CONTRACT=${app.pairContract}`,
    "--build-arg",
    `RUNTIME_COMPAT_FINGERPRINT=${fp}`,
    ...imageLabels(app.family, "runtime", version, fp, app.family),
    "-t",
    tag,
    "-t",
    alias,
    "-f",
    dockerfile("Dockerfile.runtime"),
    context,
  ]);
  assertImage(tag, arch, "runtime", app.family, fp, {});
  saveRuntimeLock(app.lockRoot, app.family, arch, contract, app.interfaceVersion);
  return { tag, alias, fp, contract };
}
// The entry's resources under `context`, shared by the app image and the host dev entry:
// copied in the listed order (a later source overwrites the same name), then the prompt
// language is selected once per target after all copies.
export function stageResources(app, context, lang) {
  for (const [root, source, dest] of app.resources) copyFrom(root, source, join(context, dest));
  for (const dest of new Set(app.resources.map(([, , dest]) => dest)))
    selectPromptLanguage(join(context, dest), lang, app.supportedPromptLangs);
  if (!existsSync(join(context, app.requiredSkill)))
    throw new Error("Missing default trend-forecaster skill");
}
function stageApp(app, arch, exported, lang, fp) {
  const context = join(app.repoRoot, ".build", "contexts", arch, "app");
  resetDirectory(context);
  cpSync(join(exported, "app", "lib"), join(context, "payload", "lib"), {
    recursive: true,
  });
  stageResources(app, context, lang);
  // The payload is only the product's own jars and resources: no third-party notices.
  copyLicenses(join(context, "payload", "licenses"));
  for (const [name, content] of Object.entries(app.payloadFiles))
    writeFileSync(join(context, "payload", name), content);
  writeFileSync(join(context, "payload", "runtime-compat-fingerprint"), fp);
  writeFileSync(join(context, "payload", "runtime-family"), app.family);
  return context;
}
function buildApp(app, arch, version, stamp, exported, fp, lang) {
  const context = stageApp(app, arch, exported, lang, fp);
  const tag = `${app.component}-app:${stamp}${app.appTagSuffix}-${arch}`;
  const alias = `${app.component}-app:deploy`;
  const labels = app.appLabels;
  console.log(`[build] app ${tag} (prompt=${lang})`);
  docker([
    ...baseBuild(arch),
    "--load",
    ...imageLabels(app.component, "app", version, fp, app.family),
    ...labelArgs(labels),
    "-t",
    tag,
    "-t",
    alias,
    "-f",
    dockerfile("Dockerfile.app"),
    context,
  ]);
  assertImage(tag, arch, "app", app.component, fp, labels);
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
  if (!app.supportedPromptLangs.includes(lang))
    throw new Error(`Expected --prompt-lang ${app.supportedPromptLangs.join("|")}`);
  const version = readRevision(readFileSync(app.versionPom, "utf8"));
  const stamp = buildStamp(version, app.repoRoot, sampleSources(app));
  const lockedFp = command === "app" ? loadRuntimeLock(app.lockRoot, app.family, arch) : undefined;
  const exported = exportJava(app, arch, version);
  const contract = computeDataEngineContract({
    dockerfileRuntimeText: readFileSync(join(RECIPE_DIR, "Dockerfile.runtime"), "utf8"),
    exportedLibDir: join(exported, "runtime-lib"),
    requirementsText: readFileSync(join(app.requirements.root, app.requirements.path), "utf8"),
    arch,
    interfaceVersion: app.interfaceVersion,
  });
  verifyJavaTarget(readFileSync(app.versionPom, "utf8"), contract.java.classVersion - 44);
  const currentFp = fingerprint(contract);

  if (command === "app") {
    if (currentFp !== lockedFp) {
      throw new Error(
        `Runtime dependencies or contract changed (expected ${lockedFp}, current ${currentFp}); rebuild runtime first with make data-engine ARCH=${arch}. No app build was started.`,
      );
    }
    const built = buildApp(app, arch, version, stamp, exported, lockedFp, lang);
    if (parsed["--pack-app"]) await pack(app, built, "app");
    return;
  }

  const runtime = buildRuntime(app, arch, version, exported, contract, currentFp);
  if (parsed["--pack-runtime"]) await pack(app, runtime, "runtime");
  const built = buildApp(app, arch, version, stamp, exported, runtime.fp, lang);
  if (parsed["--pack-app"]) await pack(app, built, "app");
}
