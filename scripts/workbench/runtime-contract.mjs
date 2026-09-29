import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, fingerprint, parsePythonRequirements } from "../build-support.mjs";
import { productionGraph } from "./production-graph.mjs";

export const INTERFACE = 3;
const FAMILY = "node-app";

function cpuFor(arch) {
  if (arch === "linux/amd64") return "x64";
  if (arch === "linux/arm64") return "arm64";
  throw new Error(`unsupported architecture ${arch}`);
}

function liveArch() {
  return process.arch === "x64" ? "amd64" : process.arch;
}

function bundleOf(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof value.importer !== "string" ||
    typeof value.manifests !== "object" ||
    value.manifests === null ||
    Array.isArray(value.manifests)
  )
    throw new Error("manifest bundle must contain importer and manifests");
  return value;
}

export function productionClosure(bundle, lock, arch) {
  const source = bundleOf(bundle);
  return productionGraph(lock, source.importer, source.manifests, cpuFor(arch));
}

export function productionFingerprint(graph) {
  return fingerprint(graph.packages);
}

export function buildContract(graph, observed) {
  return {
    family: FAMILY,
    interfaceVersion: INTERFACE,
    platform: observed.platform,
    node: observed.node,
    pnpm: observed.pnpm,
    productionDependencies: productionFingerprint(graph),
    python: observed.python,
  };
}

export function computeWorkbenchContract({
  dockerfileRuntimeText,
  requirementsText,
  graph,
  arch,
  dockerfileAppText,
}) {
  // The app builder installs the same lock with pnpm to find the link paths,
  // and optional packages are chosen by the Node version: both recipes must
  // declare the same Node release, as they must the same pnpm.
  const nodeMatch = /ARG\s+NODE_RUNTIME_IMAGE=[^\s]+node:(\d+\.\d+\.\d+)/.exec(dockerfileRuntimeText);
  if (!nodeMatch) throw new Error("Could not parse Node version from Dockerfile.runtime");
  const builderMatch = /ARG\s+NODE_BUILDER_IMAGE=[^\s]+node:(\d+\.\d+\.\d+)/.exec(dockerfileAppText);
  if (!builderMatch) throw new Error("Could not parse Node version from Dockerfile.app");
  if (builderMatch[1] !== nodeMatch[1])
    throw new Error(`Node version mismatch: runtime ${nodeMatch[1]} vs app builder ${builderMatch[1]}`);
  const node = nodeMatch[1].split(".").slice(0, 2).join(".");

  const pnpmMatch = /ARG\s+PNPM_VERSION=([^\s]+)/.exec(dockerfileRuntimeText);
  if (!pnpmMatch) throw new Error("Could not parse PNPM_VERSION from Dockerfile.runtime");
  const pnpm = pnpmMatch[1];

  const appPnpmMatch = /ARG\s+PNPM_VERSION=([^\s]+)/.exec(dockerfileAppText);
  if (!appPnpmMatch) throw new Error("Could not parse PNPM_VERSION from Dockerfile.app");
  if (appPnpmMatch[1] !== pnpm)
    throw new Error(`pnpm version mismatch: runtime ${pnpm} vs app ${appPnpmMatch[1]}`);

  const pythonMatch = /ARG\s+PYTHON_RUNTIME_IMAGE=[^\s]+python:(\d+\.\d+)/.exec(dockerfileRuntimeText);
  if (!pythonMatch) throw new Error("Could not parse Python version line from Dockerfile.runtime");
  const pythonVersion = pythonMatch[1];

  const pythonPackages = parsePythonRequirements(requirementsText);
  return buildContract(graph, {
    platform: `linux/${arch}`,
    node,
    pnpm,
    python: { version: pythonVersion, packages: pythonPackages },
  });
}

export function assertPair(app, runtime, actualArch) {
  if (
    app.schema !== 3 ||
    runtime.schema !== 3 ||
    app.kind !== "app" ||
    runtime.kind !== "runtime" ||
    app.family !== FAMILY ||
    runtime.family !== FAMILY
  )
    throw new Error("Unexpected metadata schema, runtime family or image kind");
  if (runtime.arch !== actualArch)
    throw new Error(`Runtime architecture mismatch: recorded ${runtime.arch}, actual ${actualArch}`);
  if (
    !/^[a-f0-9]{64}$/.test(app.runtimeCompatFingerprint) ||
    app.runtimeCompatFingerprint !== runtime.runtimeCompatFingerprint
  )
    throw new Error("Runtime compatibility fingerprint mismatch");
}

export function checkNoBrokenSymlinks(root) {
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        if (!existsSync(path)) {
          throw new Error(`Broken symbolic link: ${path}`);
        }
      } else if (stat.isDirectory()) {
        walk(path);
      }
    }
  }
  walk(root);
}

// Deployment assembly: the pairing plus the architecture the assembler
// expects and no broken symlinks under /app.
export function assembleMetadata(app, runtime, actualArch, expectedArch, appDir) {
  assertPair(app, runtime, actualArch);
  if (expectedArch !== actualArch)
    throw new Error(`Assembly architecture mismatch: expected ${expectedArch}, actual ${actualArch}`);
  checkNoBrokenSymlinks(appDir);
}

export function parseLock(text) {
  return createRequire(import.meta.url)("yaml").parse(text);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Every workspace manifest of the staged metadata context, keyed by its
// directory relative to the workspace root (other sources sit beside it).
function contextManifests(root, record) {
  const manifests = {};
  for (const source of record.sources)
    for (const candidate of source.candidates) {
      if (candidate.path !== "package.json" && !candidate.path.endsWith("/package.json")) continue;
      const dir = candidate.path === "package.json" ? "." : dirname(candidate.path);
      const key = source.id === record.workspaceId ? dir : dir === "." ? `../${source.id}` : `../${source.id}/${dir}`;
      manifests[key] = readJson(join(root, "sources", source.id, candidate.path));
    }
  return manifests;
}

// The compatibility contract of one target architecture, from the staged
// sources only: the metadata context, both workbench recipes and the Python
// requirements. It needs the yaml parser, so it runs in the recipe's contract
// stage and never on the build host.
export function contractFromContext(root, arch) {
  const record = readJson(join(root, "inputs.json"));
  const lock = parseLock(readFileSync(join(root, "sources", record.workspaceId, "pnpm-lock.yaml"), "utf8"));
  const graph = productionClosure(
    { importer: record.appImporter, manifests: contextManifests(root, record) },
    lock,
    `linux/${arch}`,
  );
  const input = (name) => readFileSync(join(root, "contract-inputs", name), "utf8");
  return computeWorkbenchContract({
    dockerfileRuntimeText: input("Dockerfile.runtime"),
    dockerfileAppText: input("Dockerfile.app"),
    requirementsText: input("requirements.txt"),
    graph,
    arch,
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "contract") {
    if (args.length !== 2 || !["amd64", "arm64"].includes(args[1]))
      throw new Error("contract requires the context root and the architecture amd64|arm64");
    process.stdout.write(canonical(contractFromContext(args[0], args[1])));
  } else if (command === "assemble") {
    if (args.length !== 1 || !["amd64", "arm64"].includes(args[0]))
      throw new Error("assemble requires the expected architecture amd64|arm64");
    assembleMetadata(
      readJson("/app/.image-meta.json"),
      readJson("/runtime/.image-meta.json"),
      liveArch(),
      args[0],
      "/app",
    );
  } else throw new Error(`Unknown runtime contract command: ${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[contract] ${error.message}`);
    process.exitCode = 1;
  });
}
