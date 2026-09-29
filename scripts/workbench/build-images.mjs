// Host builder for the workbench runtime and app images. The app entry owns
// only its product name, sources and work roots; family, contract interface,
// recipes, tools and requirements are this builder's shared facts. The
// runtime subcommand builds and locks the shared dependency runtime; the app
// subcommand checks the sources against the runtime lock and never builds a runtime.
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
  readRevision,
  runtimeTag,
  sampleSources,
  saveRuntimeLock,
  stagingDirectory,
} from "../build-support.mjs";
import { collectMetadataContext, copyWorkspace } from "../pnpm-workspace-context.mjs";
import { INTERFACE } from "./runtime-contract.mjs";

// Family authority is N3 runtime-contract.mjs (not exported there, and N3 is
// frozen); the interface version is imported from it directly.
const FAMILY = "node-app";
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = dirname(HERE);
const FLAGS = { "--arch": "value", "--pack-runtime": "boolean", "--pack-app": "boolean" };
// Q1: runtime-layout.mjs is required here because install-runtime.mjs imports
// it; the old full-scripts copy hid that dependency.
const TOOLS = [
  "workbench/install-runtime.mjs",
  "workbench/runtime-layout.mjs",
  "workbench/production-graph.mjs",
  "workbench/runtime-contract.mjs",
  "workbench/container-entrypoint.sh",
  "build-support.mjs",
  "third_party_notices.py",
];
// The app container needs only the stager and its real dependencies: the
// installer and the metadata collector stay on the host.
const APP_TOOLS = [
  "workbench/stage-app.mjs",
  "workbench/runtime-layout.mjs",
  "workbench/production-graph.mjs",
  "workbench/runtime-contract.mjs",
  "build-support.mjs",
  "third_party_notices.py",
];
// Only arguments the old Node entry supported; recipe defaults already pin the
// images, mirrors and index, so these pass through only when the env sets them.
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

// The product's stable runtime alias; the entry's runtimeImageName is the one
// source of this name and of the runtime package prefix. The compatibility tag
// itself stays runtimeTag(node-app, fp, arch).
function runtimeAlias(app, arch) {
  return `${app.runtimeImageName}:deploy-${arch}`;
}


// Both images ship the public repository's own license files beside the
// generated third-party notices.
function copyLicenses(app, context) {
  for (const name of ["LICENSE", "NOTICE"])
    cpSync(join(app.publicRoot, name), join(context, name));
}

async function copyTools(context) {
  for (const rel of TOOLS) cpSync(join(SCRIPTS, rel), join(context, "tools", rel));
  // The staged installer must load without running: its module guard skips main.
  await import(pathToFileURL(join(context, "tools/workbench/install-runtime.mjs")).href);
}

async function copyAppTools(app, context) {
  for (const rel of APP_TOOLS) cpSync(join(SCRIPTS, rel), join(context, "tools", rel));
  cpSync(join(app.publicRoot, "docker/workbench/launch.sh"), join(context, "launch.sh"));
  // The staged stager must load without running: its module guard skips main.
  await import(pathToFileURL(join(context, "tools/workbench/stage-app.mjs")).href);
}

function assertAppImage(tag, arch, component, fp) {
  const inspected = inspectImage(tag, `linux/${arch}`);
  const labels = inspected && inspected.Config.Labels ? inspected.Config.Labels : {};
  if (
    !inspected ||
    inspected.Os !== "linux" ||
    inspected.Architecture !== arch ||
    labels["io.runtime.component"] !== component ||
    labels["io.runtime.kind"] !== "app" ||
    labels["io.runtime.family"] !== FAMILY ||
    labels[COMPAT_LABEL] !== fp
  )
    throw new Error(`Built image identity mismatch: ${tag}`);
}

// The contract stage's own inputs: the metadata context plus the contract tool
// and what it reads. Only this stage parses the lock file.
const CONTRACT_TOOLS = ["workbench/runtime-contract.mjs", "workbench/production-graph.mjs", "build-support.mjs"];
const CONTRACT_INPUTS = ["Dockerfile.runtime", "Dockerfile.app", "requirements.txt"];

// The one computation of the runtime compatibility contract, from sources only:
// the runtime command locks it, the app command compares it with the lock.
function workbenchContract(app, arch) {
  const context = stagingDirectory(app.repoRoot, "workbench", arch, "contract");
  collectMetadataContext({
    sources: app.sources,
    workspaceId: app.workspaceId,
    appImporter: app.appImporter,
    destination: context,
  });
  for (const rel of CONTRACT_TOOLS) cpSync(join(SCRIPTS, rel), join(context, "tools", rel));
  for (const name of CONTRACT_INPUTS)
    cpSync(join(app.publicRoot, "docker/workbench", name), join(context, "contract-inputs", name));
  const out = join(context, "out");
  docker([
    ...baseBuild(arch),
    "-f",
    join(app.publicRoot, "docker/workbench/Dockerfile.runtime"),
    "--target",
    "compat-contract-export",
    "--output",
    `type=local,dest=${out}`,
    context,
  ]);
  return JSON.parse(readFileSync(join(out, "contract.json"), "utf8"));
}

async function buildWorkbenchAppImage(app, parsed, version, arch) {
  const lockedFp = loadRuntimeLock(app.lockRoot, FAMILY, arch);
  const currentFp = fingerprint(workbenchContract(app, arch));
  if (currentFp !== lockedFp) {
    throw new Error(
      `Runtime dependencies or contract changed (expected ${lockedFp}, current ${currentFp}); rebuild runtime first with make workbench-runtime ARCH=${arch}. No app build was started.`,
    );
  }
  const entries = sampleSources(app);
  const context = stagingDirectory(app.repoRoot, "workbench", arch, "app");
  const record = collectMetadataContext({
    sources: app.sources,
    workspaceId: app.workspaceId,
    appImporter: app.appImporter,
    destination: context,
  });
  copyWorkspace(app, context, record);
  await copyAppTools(app, context);
  copyLicenses(app, context);
  const meta = {
    schema: 3,
    family: FAMILY,
    kind: "app",
    arch,
    platform: `linux/${arch}`,
    runtimeCompatFingerprint: lockedFp,
  };
  const tag = `${app.component}-app:${buildStamp(version, app.repoRoot, entries)}-${arch}`;
  const alias = `${app.component}-app:deploy`;
  const dockerfile = join(app.publicRoot, "docker/workbench/Dockerfile.app");
  console.log(`[build] app ${tag}`);
  docker([
    ...baseBuild(arch),
    ...imageBuildArgs(BUILD_ARG_NAMES),
    "--load",
    "--build-arg",
    `WORKSPACE=${record.workspaceId}`,
    "--build-arg",
    `APPLICATION=${record.application}`,
    "--build-arg",
    `APP_META_JSON=${JSON.stringify(meta)}`,
    ...imageLabels(app.component, "app", version, lockedFp, FAMILY),
    "-t",
    tag,
    "-t",
    alias,
    "-f",
    dockerfile,
    context,
  ]);
  assertAppImage(tag, arch, app.component, lockedFp);
  if (parsed["--pack-app"])
    await exportImage(
      [tag, alias],
      join(app.repoRoot, ".build", "pack", `${app.component}-app-${tag.slice(tag.indexOf(":") + 1)}.tar.gz`),
    );
}

function assertWorkbenchImage(tag, arch, fp) {
  const inspected = inspectImage(tag, `linux/${arch}`);
  const labels = inspected && inspected.Config.Labels ? inspected.Config.Labels : {};
  if (
    !inspected ||
    inspected.Os !== "linux" ||
    inspected.Architecture !== arch ||
    labels["io.runtime.component"] !== FAMILY ||
    labels["io.runtime.kind"] !== "runtime" ||
    labels["io.runtime.family"] !== FAMILY ||
    labels[COMPAT_LABEL] !== fp
  )
    throw new Error(`Built image identity mismatch: ${tag}`);
}

export async function buildWorkbenchApp(app, args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Use make workbench-runtime [ARCH=amd64|arm64], make workbench-runtime-pack,\nmake workbench-app [ARCH=amd64|arm64] or make workbench-app-pack.\nThe app command checks the sources against the runtime lock and never builds a runtime.",
    );
    return;
  }
  const [command, ...flags] = args;
  if (command !== "runtime" && command !== "app")
    throw new Error("Expected runtime or app (normally invoked through Make)");
  const parsed = parseOptions(flags, FLAGS);
  const arch = parsed["--arch"];
  if (command === "app" && parsed["--pack-runtime"])
    throw new Error("Packaging flag does not match build action");
  if (command === "runtime" && parsed["--pack-app"])
    throw new Error("Packaging flag does not match build action");
  const version = readRevision(readFileSync(join(app.publicRoot, "pom.xml"), "utf8"));
  if (command === "app") {
    await buildWorkbenchAppImage(app, parsed, version, arch);
    return;
  }
  const context = stagingDirectory(app.repoRoot, "workbench", arch, "runtime");
  const record = collectMetadataContext({
    sources: app.sources,
    workspaceId: app.workspaceId,
    appImporter: app.appImporter,
    destination: context,
  });
  await copyTools(context);
  copyLicenses(app, context);
  writeFileSync(
    join(context, "runtime-requirements.txt"),
    readFileSync(join(app.publicRoot, "docker/workbench/requirements.txt")),
  );
  const contract = workbenchContract(app, arch);
  const fp = fingerprint(contract);
  const meta = {
    schema: 3,
    family: FAMILY,
    kind: "runtime",
    arch,
    platform: `linux/${arch}`,
    runtimeCompatFingerprint: fp,
  };
  const tag = runtimeTag(FAMILY, fp, arch);
  const alias = runtimeAlias(app, arch);
  console.log(`[build] runtime ${tag}`);
  docker([
    ...baseBuild(arch),
    ...imageBuildArgs(),
    "-f",
    join(app.publicRoot, "docker/workbench/Dockerfile.runtime"),
    "--target",
    "runtime",
    "--load",
    "--build-arg",
    `RUNTIME_META_JSON=${JSON.stringify(meta)}`,
    ...imageLabels(FAMILY, "runtime", version, fp, FAMILY),
    "-t",
    tag,
    "-t",
    alias,
    context,
  ]);
  assertWorkbenchImage(tag, arch, fp);
  saveRuntimeLock(app.lockRoot, FAMILY, arch, contract, INTERFACE);
  if (parsed["--pack-runtime"])
    await exportImage(
      [tag, alias],
      join(app.repoRoot, ".build", "pack", `${app.runtimeImageName}-${tag.slice(tag.indexOf(":") + 1)}.tar.gz`),
    );
}
