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
  runtimeTag,
  sampleSources,
  saveRuntimeLock,
  validateContract,
} from "../build-support.mjs";
import { collectMetadataContext, copyWorkspace } from "../pnpm-workspace-context.mjs";
import {
  computeWorkbenchContract,
  INTERFACE,
  parseLock,
  productionClosure,
} from "./runtime-contract.mjs";

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
  "PNPM_VERSION",
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

function stageContext(app, arch) {
  const base = join(app.repoRoot, ".build", "contexts", "workbench", arch);
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, "run-"));
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

function readWorkspaceManifests(context, record) {
  const manifests = {};
  for (const source of record.sources) {
    for (const candidate of source.candidates) {
      if (candidate.path.endsWith("/package.json") || candidate.path === "package.json") {
        const file = join(context, "sources", source.id, candidate.path);
        let relDir = candidate.path === "package.json" ? "." : dirname(candidate.path);
        if (source.id !== record.workspaceId) {
          relDir = candidate.path === "package.json" ? `../${source.id}` : `../${source.id}/${dirname(candidate.path)}`;
        }
        manifests[relDir] = JSON.parse(readFileSync(file, "utf8"));
      }
    }
  }
  return manifests;
}

async function buildWorkbenchAppImage(app, parsed, version, arch) {
  const lockedFp = loadRuntimeLock(app.lockRoot, FAMILY, arch);
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
  assertEntriesCurrent(entries, "staging");
  await copyAppTools(app, context);
  copyLicenses(app, context);

  const lock = parseLock(readFileSync(join(app.repoRoot, "pnpm-lock.yaml"), "utf8"));
  const manifests = readWorkspaceManifests(context, record);
  const graph = productionClosure(
    { importer: record.appImporter, manifests },
    lock,
    `linux/${arch}`,
  );
  const dockerfileRuntimeText = readFileSync(join(app.publicRoot, "docker/workbench/Dockerfile.runtime"), "utf8");
  const dockerfileAppText = readFileSync(join(app.publicRoot, "docker/workbench/Dockerfile.app"), "utf8");
  const requirementsText = readFileSync(join(app.publicRoot, "docker/workbench/requirements.txt"), "utf8");
  const currentContract = computeWorkbenchContract({
    dockerfileRuntimeText,
    requirementsText,
    graph,
    arch,
    dockerfileAppText,
  });
  const currentFp = fingerprint(currentContract);
  if (currentFp !== lockedFp) {
    throw new Error(
      `Runtime dependencies or contract changed (expected ${lockedFp}, current ${currentFp}); rebuild runtime first with make workbench-runtime ARCH=${arch}. No app build was started.`,
    );
  }

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
    runtimeCompatFingerprint: lockedFp,
    sources: combined.sources,
  };
  const tag = `${app.component}-app:${combined.stamp}-${arch}`;
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
    ...imageLabels(app.component, "app", combined, lockedFp, FAMILY),
    "-t",
    tag,
    "-t",
    alias,
    "-f",
    dockerfile,
    context,
  ]);
  assertAppImage(tag, arch, app.component, lockedFp);
  assertEntriesCurrent(entries, "the build");
  console.log(`RUNTIME_COMPAT_FINGERPRINT=${lockedFp}`);
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
  copyLicenses(app, context);
  writeFileSync(
    join(context, "runtime-requirements.txt"),
    readFileSync(join(app.publicRoot, "docker/workbench/requirements.txt")),
  );
  const platform = `linux/${arch}`;
  const dockerfile = join(app.publicRoot, "docker/workbench/Dockerfile.runtime");
  const common = [...baseBuild(arch), ...imageBuildArgs(), "-f", dockerfile];
  output("docker", ["version", "--format", "{{.Server.Version}}"]);

  const lock = parseLock(readFileSync(join(app.repoRoot, "pnpm-lock.yaml"), "utf8"));
  const manifests = readWorkspaceManifests(context, record);
  const graph = productionClosure(
    { importer: record.appImporter, manifests },
    lock,
    platform,
  );
  const dockerfileRuntimeText = readFileSync(dockerfile, "utf8");
  const dockerfileAppText = readFileSync(join(app.publicRoot, "docker/workbench/Dockerfile.app"), "utf8");
  const requirementsText = readFileSync(join(app.publicRoot, "docker/workbench/requirements.txt"), "utf8");
  const contract = computeWorkbenchContract({
    dockerfileRuntimeText,
    requirementsText,
    graph,
    arch,
    dockerfileAppText,
  });
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
  const alias = runtimeAlias(app, arch);
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
  assertEntriesCurrent(entries, "the build");
  saveRuntimeLock(app.lockRoot, FAMILY, arch, contract, INTERFACE);
  console.log(`RUNTIME_IMAGE=${tag}\nRUNTIME_DEPLOY_IMAGE=${alias}\nRUNTIME_COMPAT_FINGERPRINT=${fp}`);
  if (parsed["--pack-runtime"])
    await exportImage(
      [tag, alias],
      join(app.repoRoot, ".build", "pack", `${app.runtimeImageName}-${tag.slice(tag.indexOf(":") + 1)}.tar.gz`),
    );
}
