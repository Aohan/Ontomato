// Host builder for the workbench runtime image. The app entry owns only its
// product name, sources and work roots; family, contract interface, recipe,
// tools and requirements are this builder's shared facts. Only the runtime
// subcommand exists: the app image arrives with its own small package later.
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
  COMPAT_LABEL,
  docker,
  exportImage,
  fingerprint,
  imageLabels,
  inspectImage,
  output,
  parseOptions,
  readJson,
  readRevision,
  runtimeTag,
  saveRuntimeLock,
  sourceIdentity,
  validateContract,
} from "../build-support.mjs";
import { collectMetadataContext } from "./metadata-context.mjs";
import { INTERFACE } from "./runtime-contract.mjs";

// Family authority is N3 runtime-contract.mjs (not exported there, and N3 is
// frozen); the interface version is imported from it directly.
const FAMILY = "node-app";
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = dirname(HERE);
const FLAGS = { "--arch": "value", "--pack-runtime": "boolean" };
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

function imageBuildArgs() {
  const args = [];
  for (const name of BUILD_ARG_NAMES) {
    const value = process.env[name];
    if (value) args.push("--build-arg", `${name}=${value}`);
  }
  return args;
}

// One version from the public POM; each source keeps its own revision/dirty.
// The top revision is this version's app repo, the top dirty covers every
// participating source, otherwise a dirty public tree could ship as clean.
export function combineIdentity(version, appRoot, entries) {
  const app = entries.find((entry) => entry.root === appRoot);
  if (!app) throw new Error("this version's app repo is not a build source");
  return {
    version,
    revision: app.identity.revision,
    revisionShort: app.identity.revisionShort,
    created: app.identity.created,
    dirty: entries.some((entry) => entry.identity.dirty),
    sources: entries.map((entry) => ({
      id: entry.id,
      revision: entry.identity.revision,
      revisionShort: entry.identity.revisionShort,
      dirty: entry.identity.dirty,
      created: entry.identity.created,
    })),
  };
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
      "Use make workbench-runtime [ARCH=amd64|arm64] or make workbench-runtime-pack.\nThe app image arrives with its own small package; only runtime is built here.",
    );
    return;
  }
  const [command, ...flags] = args;
  if (command !== "runtime")
    throw new Error("Expected runtime (normally invoked through Make)");
  const parsed = parseOptions(flags, FLAGS);
  const arch = parsed["--arch"];
  const version = readRevision(readFileSync(join(app.publicRoot, "pom.xml"), "utf8"));
  // Each source's identity is captured once, up front: a later read would
  // silently relabel this build's inputs with a newer revision after a long
  // build, and the N4a snapshot must not gain a second authority.
  const entries = app.sources.map((source) => ({
    id: source.id,
    root: source.root,
    identity: sourceIdentity(version, source.root, app.lockExclude),
  }));
  const context = stageContext(app, arch);
  const record = collectMetadataContext({
    sources: app.sources,
    workspaceId: app.workspaceId,
    appImporter: app.appImporter,
    destination: context,
  });
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const source of record.sources)
    if (source.head !== byId.get(source.id).identity.revision)
      throw new Error(`source ${source.id} changed during staging; restart the build`);
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
  for (const entry of entries)
    if (output("git", ["-C", entry.root, "rev-parse", "HEAD"]) !== entry.identity.revision)
      throw new Error(`source ${entry.id} changed during the build; restart the build`);
  saveRuntimeLock(app.lockRoot, FAMILY, arch, contract, INTERFACE);
  console.log(`RUNTIME_IMAGE=${tag}\nRUNTIME_DEPLOY_IMAGE=${alias}\nRUNTIME_COMPAT_FINGERPRINT=${fp}`);
  if (parsed["--pack-runtime"])
    await exportImage(
      [tag, alias],
      join(app.repoRoot, ".build", "pack", `${FAMILY}-runtime-${tag.slice(tag.indexOf(":") + 1)}.tar.gz`),
    );
}
