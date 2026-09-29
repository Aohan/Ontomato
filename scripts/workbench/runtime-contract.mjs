import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
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

export { parsePythonRequirements } from "../build-support.mjs";

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
  if (!dockerfileAppText) throw new Error("dockerfileAppText is required");
  const nodeMatch = /ARG\s+NODE_RUNTIME_IMAGE=[^\s]+node:(\d+\.\d+)/.exec(dockerfileRuntimeText);
  if (!nodeMatch) throw new Error("Could not parse Node version line from Dockerfile.runtime");
  const node = nodeMatch[1];

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

export function pairMetadata(app, runtime, actualArch) {
  assertPair(app, runtime, actualArch);
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
export function assembleMetadata(app, runtime, actualArch, expectedArch, appDir = "/app") {
  pairMetadata(app, runtime, actualArch);
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

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "assemble") {
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
