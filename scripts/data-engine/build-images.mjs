// Shared data-engine final-image builder. The app entry describes the product
// name, sources, resources and the edition's export inputs; the recipe
// (docker/data-engine/Dockerfile) owns the stages, the layer order and the
// runtime layout. One image is built per invocation: there is no separate
// runtime or app artifact, no compatibility lock and nothing to assemble later.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildStamp,
  docker,
  imageLabels,
  imageCacheArgs,
  inspectImage,
  parseOptions,
  readRevision,
  sampleSources,
  stagingDirectory,
} from "../build-support.mjs";

export const JAVA_FLAGS = {
  "--arch": "value",
  "--prompt-lang": "value",
};
// This shared builder lives in the public repository, whose own license files
// every image ships, for either edition.
const PUBLIC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RECIPE = join(PUBLIC_ROOT, "docker/data-engine/Dockerfile");

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
function copyFrom(root, source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(join(root, source), destination, { recursive: true });
}
function baseBuild(arch) {
  return ["buildx", "build", "--provenance=false", "--platform", `linux/${arch}`];
}
function labelArgs(labels) {
  return Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]);
}

// The reactor inputs both export stages require: which staged tree Maven compiles,
// which module it packages, the modules whose built jars the image carries, and the
// app's own artifactIds that must stay out of the third-party closure. The export
// script fails on any of them being empty.
function reactorArgs(app) {
  return [
    "--build-arg",
    `REACTOR_DIR=${app.reactorDir}`,
    "--build-arg",
    `APP_MODULE=${app.appModule}`,
    "--build-arg",
    `APP_LIB_MODULES=${app.appLibModules.join(" ")}`,
    "--build-arg",
    `EXCLUDE_ARTIFACT_IDS=${app.excludeArtifactIds}`,
  ];
}
// The recipe names its two export stages. A description without the edition's
// private export inputs consumes build-central (empty Maven settings); the
// enterprise description consumes build-secret, whose settings file must exist
// on the host before the build starts: it is handed over as a BuildKit secret
// and never enters the context.
function exportArgs(app, version) {
  if (!app.secretExport)
    return ["--build-arg", "EXPORT_STAGE=build-central", ...reactorArgs(app)];
  const secret = app.secretExport;
  if (!existsSync(secret.mavenSettings))
    throw new Error(
      `Missing Maven settings at ${secret.mavenSettings}; provide the private repository configuration as a BuildKit secret.`,
    );
  return [
    "--build-arg",
    "EXPORT_STAGE=build-secret",
    ...reactorArgs(app),
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
function pipArgs() {
  return process.env.PIP_INDEX_URL
    ? ["--build-arg", `PIP_INDEX_URL=${process.env.PIP_INDEX_URL}`]
    : [];
}
function assertImage(image, arch, component, version, labels) {
  const inspected = inspectImage(image, `linux/${arch}`);
  const actual = inspected && inspected.Config.Labels ? inspected.Config.Labels : {};
  if (
    !inspected ||
    inspected.Os !== "linux" ||
    inspected.Architecture !== arch ||
    actual["io.ontomato.component"] !== component ||
    actual["org.opencontainers.image.version"] !== version ||
    Object.entries(labels).some(([key, value]) => actual[key] !== value)
  )
    throw new Error(`Built image identity mismatch: ${image}`);
}

// The build context: the source trees the Maven export compiles, the pinned
// requirements, the public license files, the tools the recipe binds into two
// RUN steps, and the product payload the final stage copies. A build source
// change therefore only changes files the export and the payload stages read.
function stageContext(app, arch, lang) {
  const context = stagingDirectory(app.repoRoot, "data-engine", arch);
  for (const tree of app.contextTrees)
    for (const path of tree.paths)
      copyFrom(tree.root, path, join(context, tree.dest, path));
  copyFrom(app.requirements.root, app.requirements.path, join(context, "requirements-py310.txt"));
  stageResources(app, context, lang);
  for (const [root, source, dest] of app.bin) copyFrom(root, source, join(context, dest));
  copyFrom(app.mcp.root, app.mcp.path, join(context, "payload/mcp/mcpserver.py"));
  for (const name of ["LICENSE", "NOTICE"]) copyFrom(PUBLIC_ROOT, name, join(context, name));
  copyFrom(PUBLIC_ROOT, "scripts/third_party_notices.py", join(context, "tools/third_party_notices.py"));
  copyFrom(PUBLIC_ROOT, "scripts/data-engine/verify-image.py", join(context, "tools/verify-image.py"));
  return context;
}

// The entry's resources under `context`, shared by the final image and the host dev entry:
// copied in the listed order (a later source overwrites the same name), then the prompt
// language is selected once per target after all copies.
export function stageResources(app, context, lang) {
  for (const [root, source, dest] of app.resources) copyFrom(root, source, join(context, dest));
  for (const dest of new Set(app.resources.map(([, , dest]) => dest)))
    selectPromptLanguage(join(context, dest), lang, app.supportedPromptLangs);
  if (!existsSync(join(context, app.requiredSkill)))
    throw new Error("Missing default trend-forecaster skill");
}

// The one CLI parse: help returns before any Git, settings or Docker read; the
// entry prints its own help. Edition flags (the private --license-mode) are part
// of `flags` and are interpreted by that entry only.
export function parseJavaArgs(args, flags) {
  if (args.includes("--help") || args.includes("-h")) return { help: true };
  return { help: false, parsed: parseOptions(args, flags) };
}

export async function buildJavaApp(app, { parsed }) {
  const arch = parsed["--arch"];
  const lang = parsed["--prompt-lang"] ?? app.promptLang;
  if (!app.supportedPromptLangs.includes(lang))
    throw new Error(`Expected --prompt-lang ${app.supportedPromptLangs.join("|")}`);
  const version = readRevision(readFileSync(app.versionPom, "utf8"));
  const editionArgs = exportArgs(app, version);
  const stamp = buildStamp(version, app.repoRoot, sampleSources(app));
  const context = stageContext(app, arch, lang);
  const tag = `${app.component}:${stamp}${app.tagSuffix}-${arch}`;
  // An override edition carries its suffix into the deploy alias as well, so a
  // development build never claims the alias the deployment runs.
  const alias = `${app.component}:deploy${app.tagSuffix}-${arch}`;
  console.log(`[build] ${app.component} ${tag} (prompt=${lang})`);
  docker([
    ...baseBuild(arch),
    ...imageCacheArgs(),
    ...editionArgs,
    "--target",
    "image",
    "--load",
    ...pipArgs(),
    ...imageLabels(app.component, version),
    ...labelArgs(app.labels),
    "-t",
    tag,
    "-t",
    alias,
    "-f",
    RECIPE,
    context,
  ]);
  assertImage(tag, arch, app.component, version, app.labels);
}
