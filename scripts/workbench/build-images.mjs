// Host builder for the workbench final image.
// The app entry owns only its product name, sources and workspace selection.
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
import { collectMetadataContext, copyWorkspace } from "../pnpm-workspace-context.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = dirname(HERE);
const FLAGS = { "--arch": "value" };

const TOOLS = [
  "workbench/install-runtime.mjs",
  "workbench/runtime-layout.mjs",
  "workbench/production-graph.mjs",
  "workbench/stage-app.mjs",
  "build-support.mjs",
  "third_party_notices.py",
];

const BUILD_ARG_NAMES = [
  "PIP_INDEX_URL",
  "DEBIAN_MIRROR",
  "DEBIAN_SECURITY_MIRROR",
];

function baseBuild(arch) {
  return ["buildx", "build", "--provenance=false", "--platform", `linux/${arch}`];
}

function imageBuildArgs(names = BUILD_ARG_NAMES) {
  const args = [];
  for (const name of names) {
    const value = process.env[name];
    if (value) args.push("--build-arg", `${name}=${value}`);
  }
  return args;
}

function copyLicenses(app, context) {
  for (const name of ["LICENSE", "NOTICE"])
    cpSync(join(app.publicRoot, name), join(context, name));
}

async function copyTools(app, context) {
  for (const rel of TOOLS) cpSync(join(SCRIPTS, rel), join(context, "tools", rel));
  cpSync(join(app.publicRoot, "docker/workbench/launch.sh"), join(context, "launch.sh"));
  // Module guards verify staged tools load without running main.
  await import(pathToFileURL(join(context, "tools/workbench/install-runtime.mjs")).href);
  await import(pathToFileURL(join(context, "tools/workbench/stage-app.mjs")).href);
}

function assertWorkbenchImage(tag, arch, component, version) {
  const inspected = inspectImage(tag, `linux/${arch}`);
  const labels = inspected && inspected.Config && inspected.Config.Labels ? inspected.Config.Labels : {};
  if (
    !inspected ||
    inspected.Os !== "linux" ||
    inspected.Architecture !== arch ||
    labels["io.ontomato.component"] !== component ||
    labels["org.opencontainers.image.version"] !== version
  )
    throw new Error(`Built image identity mismatch: ${tag}`);
}

export async function buildWorkbenchImage(app, args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Use node apps/workbench/build.mjs --arch amd64|arm64");
    return;
  }
  const parsed = parseOptions(args, FLAGS);
  const arch = parsed["--arch"];
  const version = readRevision(readFileSync(join(app.publicRoot, "pom.xml"), "utf8"));
  const entries = sampleSources(app);
  const stamp = buildStamp(version, app.repoRoot, entries);
  const tag = `${app.component}:${stamp}-${arch}`;
  const alias = `${app.component}:deploy-${arch}`;

  const context = stagingDirectory(app.repoRoot, "workbench", arch, "image");
  const record = collectMetadataContext({
    sources: app.sources,
    workspaceId: app.workspaceId,
    appImporter: app.appImporter,
    destination: context,
  });
  copyWorkspace(app, context, record);
  await copyTools(app, context);
  copyLicenses(app, context);
  writeFileSync(
    join(context, "runtime-requirements.txt"),
    readFileSync(join(app.publicRoot, "docker/workbench/requirements.txt")),
  );

  const dockerfile = join(app.publicRoot, "docker/workbench/Dockerfile");
  console.log(`[build] workbench ${tag}`);
  docker([
    ...baseBuild(arch),
    ...imageCacheArgs(),
    ...imageBuildArgs(BUILD_ARG_NAMES),
    "--load",
    "--build-arg",
    `WORKSPACE=${record.workspaceId}`,
    "--build-arg",
    `APPLICATION=${record.application}`,
    "--build-arg",
    `TARGETPLATFORM=linux/${arch}`,
    ...imageLabels(app.component, version),
    "-t",
    tag,
    "-t",
    alias,
    "-f",
    dockerfile,
    context,
  ]);
  assertWorkbenchImage(tag, arch, app.component, version);
}
