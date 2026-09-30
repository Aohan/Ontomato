// Build-time installer for the workbench runtime image. It runs in the installer
// stage against the N4a metadata context under /src and produces the fixed
// virtual-store runtime tree.
// Workspace members are resolved by pnpm itself; the host passes no globs.
import { createRequire } from "node:module";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execute, output } from "../build-support.mjs";
import { productionGraph } from "./production-graph.mjs";
import { snapshotIndex } from "./runtime-layout.mjs";

const SOURCES = "/src";
const RUNTIME = "/opt/runtime";
const STORE = join(RUNTIME, "node_modules/.pnpm");
// pnpm's license report of this installation, read by the runtime stage's
// third-party notice generator; it never enters the runtime tree.
const NPM_LICENSES = "/tmp/npm-licenses.json";
const SERVER = "@ontomato/workbench-server";

function inside(root, path) {
  return path === root || path.startsWith(`${root}${sep}`);
}

function runtimeLinks(nodeModules, runtimeRoot) {
  for (const name of readdirSync(nodeModules)) {
    const path = join(nodeModules, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      const target = realpathSync(path);
      if (!inside(runtimeRoot, target))
        throw new Error(`runtime link leaves the runtime: ${path} -> ${target}`);
    } else if (stat.isDirectory()) runtimeLinks(path, runtimeRoot);
  }
}

// pnpm's own hoist links workspace members to their source directories. The
// full member list is the authority: a link is removed only when it is a
// symlink to that member's own directory. A same-named link to anything else
// stays and is rejected by the runtime link check below, and a link that
// resolves inside the store is an installed package, so it also stays.
export function finalizeRuntime({ runtimeRoot, members, index }) {
  const runtime = realpathSync(runtimeRoot);
  const store = join(runtime, "node_modules/.pnpm");
  rmSync(join(store, "lock.yaml"), { force: true });
  rmSync(join(runtime, "node_modules/.modules.yaml"), { force: true });
  const hoist = join(store, "node_modules");
  const emptied = new Set();
  for (const member of members) {
    const link = join(hoist, member.name);
    if (!existsSync(link)) continue;
    if (!lstatSync(link).isSymbolicLink()) continue;
    if (realpathSync(link) !== realpathSync(member.absolute)) continue;
    rmSync(link);
    if (member.name.includes("/")) emptied.add(dirname(link));
  }
  // A scope that only held own members leaves the runtime; a scope that still
  // holds a third-party entry stays.
  for (const scope of emptied) if (readdirSync(scope).length === 0) rmdirSync(scope);
  const used = new Set(Object.values(index).map((rel) => rel.split("/")[2]));
  const present = readdirSync(store).filter(
    (name) => name !== "node_modules" && statSync(join(store, name)).isDirectory(),
  );
  const missing = [...used].filter((dir) => !present.includes(dir));
  const extra = present.filter((dir) => !used.has(dir));
  if (missing.length || extra.length)
    throw new Error(
      `virtual store does not match the production index: missing ${missing.join(", ")}; extra ${extra.join(", ")}`,
    );
  runtimeLinks(join(runtime, "node_modules"), runtime);
}

// pnpm reports members relative to the workspace root, which is also how the
// lock importers and the graph link targets are keyed.
function projects(root, args) {
  return JSON.parse(output("pnpm", args)).map((project) => ({
    name: project.name,
    path: relative(root, project.path).split(sep).join("/"),
    absolute: project.path,
    manifest: JSON.parse(readFileSync(join(project.path, "package.json"), "utf8")),
  }));
}

function main() {
  const record = JSON.parse(readFileSync("/inputs.json", "utf8"));
  const root = join(SOURCES, record.workspaceId);
  const selection = ["--filter-prod", `${record.application}...`];
  mkdirSync(join(RUNTIME, "node_modules"), { recursive: true });
  process.chdir(root);
  execute("pnpm", [
    ...selection,
    "install",
    "--frozen-lockfile",
    "--prod",
    "--virtual-store-dir",
    STORE,
  ]);
  // esbuild's postinstall replaces its published bin placeholder (a node
  // script, so the hoist shim is generated as a node-shim) with the platform
  // executable after the hoist .bin shims are linked: a cold install leaves a
  // node-shim pointing at an ELF. Reinstalling from the now-warm store with
  // scripts skipped restores the executable before linking, so the shims are
  // generated as direct execs (N1d fixed-store evidence). The relink changes
  // no selection; the selected==bindings check below still guards the closure.
  rmSync(join(RUNTIME, "node_modules"), { recursive: true, force: true });
  execute("pnpm", [
    ...selection,
    "install",
    "--frozen-lockfile",
    "--prod",
    "--offline",
    "--virtual-store-dir",
    STORE,
  ]);
  // Fail closed: a stale shim must never leave the installer stage. The
  // version is printed into the build log as evidence.
  execute(join(STORE, "node_modules/.bin/esbuild"), ["--version"]);
  // Same selection as the install. pnpm reports package paths under its
  // default virtual store unless it is given the one this install used.
  writeFileSync(
    NPM_LICENSES,
    output("pnpm", [
      ...selection,
      "licenses",
      "list",
      "--prod",
      "--json",
      `--config.virtual-store-dir=${STORE}`,
    ]),
  );
  const members = projects(root, ["-r", "list", "--depth", "-1", "--json"]);
  const selected = projects(root, [...selection, "list", "--depth", "-1", "--json"]);
  const manifests = Object.fromEntries(members.map((member) => [member.path, member.manifest]));
  const server = members.find((member) => member.name === SERVER);
  if (!server) throw new Error(`workspace has no ${SERVER} member`);
  const yaml = createRequire(join(server.absolute, "package.json"))("yaml");
  const lock = yaml.parse(readFileSync(join(root, "pnpm-lock.yaml"), "utf8"));
  const graph = productionGraph(lock, record.appImporter, manifests, process.arch);
  const closure = Object.keys(graph.bindings).sort().join("\n");
  const chosen = selected.map((member) => member.path).sort().join("\n");
  if (closure !== chosen)
    throw new Error(
      `pnpm production selection differs from the graph closure\nselected:\n${chosen}\nclosure:\n${closure}`,
    );
  const index = snapshotIndex(root, RUNTIME, graph);
  finalizeRuntime({ runtimeRoot: RUNTIME, members, index });
  console.log(
    `INSTALLED ${record.workspaceId} members=${members.length} selected=${selected.length} packages=${Object.keys(graph.packages).length}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
