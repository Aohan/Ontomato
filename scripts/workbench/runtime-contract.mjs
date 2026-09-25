import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readdirSync, readSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, fingerprint } from "../build-support.mjs";
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

export function buildContract(graph, snapshotPaths, observed) {
  return {
    family: FAMILY,
    interfaceVersion: INTERFACE,
    platform: observed.platform,
    node: observed.node,
    productionDependencies: productionFingerprint(graph),
    snapshotPaths,
    nativeDependencies: observed.nativeDependencies,
    python: observed.python,
  };
}

export function checkPythonRequirements(text, packages) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s*#.*$/, "").trim();
    if (!line) continue;
    const match = /^([A-Za-z0-9_.-]+)==([^\s;]+)$/.exec(line);
    if (!match)
      throw new Error(`Runtime Python requirements must use exact name==version pins: ${line}`);
    const name = match[1].toLowerCase().replace(/[-_.]+/g, "-");
    if (packages[name] !== match[2])
      throw new Error(
        `Runtime Python dependency mismatch: ${name} requires ${match[2]}, provides ${packages[name] || "missing"}; publish a matching runtime`,
      );
  }
}

export function nativeFiles(root) {
  const files = {};
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        const fd = openSync(path, "r");
        const magic = Buffer.alloc(4);
        try {
          readSync(fd, magic, 0, 4, 0);
        } finally {
          closeSync(fd);
        }
        if (magic.equals(Buffer.from([127, 69, 76, 70])) || entry.name.endsWith(".node")) {
          files[relative(root, path).split("\\").join("/")] = createHash("sha256")
            .update(readFileSync(path))
            .digest("hex");
        }
      }
    }
  }
  walk(root);
  return fingerprint(files);
}

function readNodeFacts() {
  return {
    api: process.versions.node.split(".").slice(0, 2).join("."),
    modules: process.versions.modules,
    glibc: process.report.getReport().header.glibcVersionRuntime,
  };
}

function readPython() {
  return JSON.parse(
    execFileSync("python3", ["/runtime/runtime_dependencies.py", "/tmp/runtime-requirements.txt"], {
      encoding: "utf8",
    }),
  );
}

function installedContract(graph, snapshotPaths) {
  return buildContract(graph, snapshotPaths, {
    platform: `linux/${liveArch()}`,
    node: readNodeFacts(),
    nativeDependencies: nativeFiles("/opt/runtime/node_modules"),
    python: readPython(),
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

export function checkAgainst(input, contract) {
  const graph = productionClosure(
    { importer: input.importer, manifests: input.manifests },
    input.lock,
    contract.platform,
  );
  if (productionFingerprint(graph) !== contract.productionDependencies)
    throw new Error(
      "Production dependency graph differs from the runtime; publish a matching runtime with make pack. No runtime rebuild was started.",
    );
  const python = objectMap(contract.python, "runtime contract has no python packages");
  objectMap(python.packages, "runtime contract has no python packages");
  checkPythonRequirements(input.pythonRequirements, python.packages);
}

export function checkBuild(graph, contract, expected) {
  if (fingerprint(contract) !== expected)
    throw new Error("Builder runtime contract does not match the required fingerprint");
  if (productionFingerprint(graph) !== contract.productionDependencies)
    throw new Error("App production dependency graph does not match runtime");
}

export function pairMetadata(app, runtime, contract, actualArch) {
  assertPair(app, runtime, actualArch);
  if (fingerprint(contract) !== runtime.runtimeCompatFingerprint)
    throw new Error("Runtime contract metadata is inconsistent");
}

function parseLock(text) {
  return createRequire(import.meta.url)("yaml").parse(text);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function objectMap(value, message) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value;
}

function readGraph(path) {
  const graph = objectMap(readJson(path), "graph has no packages");
  objectMap(graph.packages, "graph has no packages");
  return graph;
}

function readSnapshotPaths(path) {
  return objectMap(readJson(path), "snapshot paths must be an object");
}

function readContract(path) {
  return objectMap(readJson(path), "runtime contract must be an object");
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "production") {
    if (args.length !== 3) throw new Error("production requires manifest bundle, lock and architecture");
    const [bundlePath, lockPath, arch] = args;
    const graph = productionClosure(readJson(bundlePath), parseLock(readFileSync(lockPath, "utf8")), arch);
    process.stdout.write(canonical(graph));
  } else if (command === "inspect") {
    if (args.length !== 2) throw new Error("inspect requires graph and snapshot paths");
    const [graphPath, pathsPath] = args;
    process.stdout.write(canonical(installedContract(readGraph(graphPath), readSnapshotPaths(pathsPath))));
  } else if (command === "check") {
    // Docker attach can leave stdin nonblocking; readFileSync(0) throws EAGAIN.
    process.stdin.setEncoding("utf8");
    let body = "";
    for await (const chunk of process.stdin) body += chunk;
    const input = JSON.parse(body);
    if (typeof input.lockfile !== "string") throw new Error("check input requires lockfile text");
    if (typeof input.pythonRequirements !== "string")
      throw new Error("check input requires pythonRequirements");
    checkAgainst(
      {
        importer: input.importer,
        manifests: input.manifests,
        lock: parseLock(input.lockfile),
        pythonRequirements: input.pythonRequirements,
      },
      readContract("/runtime/contract.json"),
    );
    console.log("Runtime dependencies match");
  } else if (command === "pair") {
    pairMetadata(
      readJson("/app/.image-meta.json"),
      readJson("/runtime/.image-meta.json"),
      readContract("/runtime/contract.json"),
      liveArch(),
    );
  } else if (command === "check-build") {
    if (args.length !== 3) throw new Error("check-build requires graph, contract and fingerprint");
    const [graphPath, contractPath, expected] = args;
    checkBuild(readGraph(graphPath), readContract(contractPath), expected);
  } else throw new Error(`Unknown runtime contract command: ${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[contract] ${error.message}`);
    process.exitCode = 1;
  });
}
