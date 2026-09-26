// Host builder for the workbench runtime and app images. The app entry owns
// only its product name, sources and work roots; family, contract interface,
// recipes, tools and requirements are this builder's shared facts. The
// runtime subcommand builds and locks the shared dependency runtime; the app
// subcommand consumes an already locked runtime and never rebuilds it.
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertEntriesCurrent,
  assertFreshRecord,
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
import { collectMetadataContext, copyWorkspace } from "../pnpm-workspace-context.mjs";
import { checkPythonRequirements, INTERFACE } from "./runtime-contract.mjs";

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
  "data-engine/runtime_dependencies.py",
];
// The app container needs only the stager and its real dependencies: the
// installer and the metadata collector stay on the host.
const APP_TOOLS = [
  "workbench/stage-app.mjs",
  "workbench/runtime-layout.mjs",
  "workbench/production-graph.mjs",
  "workbench/runtime-contract.mjs",
  "build-support.mjs",
];
// Only arguments the old Node entry supported; recipe defaults already pin the
// images, mirrors and index, so these pass through only when the env sets them.
const BUILD_ARG_NAMES = [
  "NODE_RUNTIME_IMAGE",
  "PYTHON_RUNTIME_IMAGE",
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

function stageContext(app, arch) {
  const base = join(app.repoRoot, ".build", "contexts", "workbench", arch);
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, "run-"));
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

// The locked runtime is consumed read-only: a missing image fails with the
// import instructions, it is never pulled or rebuilt, and its lock is never
// written by the app command.
function existingRuntime(app, arch) {
  const fp = loadRuntimeLock(app.lockRoot, FAMILY, arch);
  const tag = requireRuntime(FAMILY, arch, fp);
  const contract = validateContract(
    FAMILY,
    `linux/${arch}`,
    readImageContract(tag, arch),
    fp,
    INTERFACE,
  );
  checkPythonRequirements(
    readFileSync(join(app.publicRoot, "docker/workbench/requirements.txt"), "utf8"),
    contract.python.packages,
  );
  return { tag, fp, contract };
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

async function buildWorkbenchAppImage(app, parsed, version, arch) {
  const entries = sampleSources(app, version);
  const context = stageContext(app, arch);
  const record = collectMetadataContext({
    sources: app.sources,
    workspaceId: app.workspaceId,
    appImporter: app.appImporter,
    destination: context,
  });
  assertFreshRecord(entries, record);
  copyWorkspace(app, context, record);
  // The live tree was copied file by file after sampling: the recorded HEADs
  // must still hold. This is a change check, not an atomic snapshot of dirty
  // worktree edits, and it never resamples.
  assertEntriesCurrent(entries, "staging");
  await copyAppTools(app, context);
  const runtime = existingRuntime(app, arch);
  writeFileSync(join(context, "runtime-contract.json"), `${JSON.stringify(runtime.contract)}\n`);
  const combined = combineIdentity(version, app.repoRoot, entries);
  const meta = {
    schema: 3,
    family: FAMILY,
    component: app.component,
    kind: "app",
    version: combined.version,
    revision: combined.revision,
    revisionShort: combined.revisionShort,
    created: combined.created,
    dirty: combined.dirty,
    stamp: combined.stamp,
    arch,
    platform: `linux/${arch}`,
    runtimeCompatFingerprint: runtime.fp,
    sources: combined.sources,
  };
  const tag = `${app.component}-app:${combined.stamp}-${arch}`;
  const alias = `${app.component}-app:deploy`;
  const dockerfile = join(app.publicRoot, "docker/workbench/Dockerfile.app");
  console.log(`[build] app ${tag}`);
  docker([
    ...baseBuild(arch),
    ...imageBuildArgs([...BUILD_ARG_NAMES, "NODE_BUILDER_IMAGE"]),
    "--load",
    "--build-arg",
    `WORKSPACE=${record.workspaceId}`,
    "--build-arg",
    `APP_META_JSON=${JSON.stringify(meta)}`,
    ...imageLabels(app.component, "app", combined, runtime.fp, FAMILY),
    "-t",
    tag,
    "-t",
    alias,
    "-f",
    dockerfile,
    context,
  ]);
  assertAppImage(tag, arch, app.component, runtime.fp);
  console.log(`APP_IMAGE=${tag}\nAPP_DEPLOY_IMAGE=${alias}`);
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

function readImageContract(tag, arch) {
  return JSON.parse(
    output("docker", [
      "run",
      "--rm",
      "--platform",
      `linux/${arch}`,
      "--entrypoint",
      "cat",
      tag,
      "/runtime/contract.json",
    ]),
  );
}

export async function buildWorkbenchApp(app, args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Use make workbench-runtime [ARCH=amd64|arm64], make workbench-runtime-pack,\nmake workbench-app [ARCH=amd64|arm64] or make workbench-app-pack.\nThe app command consumes the locked runtime and never rebuilds it.",
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
  // Each source's identity is captured once, up front: a later read would
  // silently relabel this build's inputs with a newer revision after a long
  // build, and the N4a snapshot must not gain a second authority.
  const entries = sampleSources(app, version);
  const context = stageContext(app, arch);
  const record = collectMetadataContext({
    sources: app.sources,
    workspaceId: app.workspaceId,
    appImporter: app.appImporter,
    destination: context,
  });
  assertFreshRecord(entries, record);
  await copyTools(context);
  writeFileSync(
    join(context, "runtime-requirements.txt"),
    readFileSync(join(app.publicRoot, "docker/workbench/requirements.txt")),
  );
  const platform = `linux/${arch}`;
  const dockerfile = join(app.publicRoot, "docker/workbench/Dockerfile.runtime");
  const common = [...baseBuild(arch), ...imageBuildArgs(), "-f", dockerfile];
  output("docker", ["version", "--format", "{{.Server.Version}}"]);
  const directory = join(context, "contract");
  mkdirSync(directory, { recursive: true });
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
  validateContract(FAMILY, platform, contract, fp, INTERFACE);
  const combined = combineIdentity(version, app.repoRoot, entries);
  const meta = {
    schema: 3,
    family: FAMILY,
    component: FAMILY,
    kind: "runtime",
    version: combined.version,
    revision: combined.revision,
    revisionShort: combined.revisionShort,
    created: combined.created,
    dirty: combined.dirty,
    arch,
    platform,
    runtimeCompatFingerprint: fp,
    sources: combined.sources,
  };
  const tag = runtimeTag(FAMILY, fp, arch);
  const alias = `${app.component}-runtime:deploy-${arch}`;
  console.log(`[build] runtime ${tag}`);
  docker([
    ...common,
    "--target",
    "runtime",
    "--load",
    "--build-arg",
    `RUNTIME_META_JSON=${JSON.stringify(meta)}`,
    ...imageLabels(FAMILY, "runtime", combined, fp, FAMILY),
    "-t",
    tag,
    "-t",
    alias,
    context,
  ]);
  assertWorkbenchImage(tag, arch, fp);
  if (fingerprint(readImageContract(tag, arch)) !== fp)
    throw new Error("Built runtime contract differs from the exported contract");
  // The lock must describe this build's inputs: a source that moved since the
  // start fails instead of being relabeled or retried. This reads HEAD only;
  // it never saves a new dirty identity.
  assertEntriesCurrent(entries, "the build");
  saveRuntimeLock(app.lockRoot, FAMILY, arch, contract, INTERFACE);
  console.log(`RUNTIME_IMAGE=${tag}\nRUNTIME_DEPLOY_IMAGE=${alias}\nRUNTIME_COMPAT_FINGERPRINT=${fp}`);
  if (parsed["--pack-runtime"])
    await exportImage(
      [tag, alias],
      join(app.repoRoot, ".build", "pack", `${FAMILY}-runtime-${tag.slice(tag.indexOf(":") + 1)}.tar.gz`),
    );
}
