import { lstatSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";

function mergedEdges(node) {
  const edges = { ...node.dependencies };
  for (const [name, key] of Object.entries(node.optionalDependencies)) {
    if (edges[name] && edges[name] !== key)
      throw new Error(`dependency and optional disagree: ${name}`);
    edges[name] = key;
  }
  return edges;
}

function storeNodeModules(pkgReal) {
  const parts = pkgReal.split(sep);
  const at = parts.lastIndexOf(".pnpm");
  if (parts[at + 2] !== "node_modules") throw new Error(`not a store package: ${pkgReal}`);
  return parts.slice(0, at + 3).join(sep);
}

function occupied(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function storeRelative(rel) {
  if (typeof rel !== "string" || rel === "") throw new Error(`store path escapes: ${rel}`);
  const norm = posix.normalize(rel);
  if (norm.startsWith("/") || norm.split("/").includes(".."))
    throw new Error(`store path escapes: ${rel}`);
  return norm;
}

function appDirectory(dir, importer) {
  if (typeof dir !== "string" || dir === "")
    throw new Error(`app directory is outside the stage: ${importer}`);
  const norm = posix.normalize(dir);
  const parts = norm.split("/");
  if (norm.startsWith("/") || parts.includes(".."))
    throw new Error(`app directory is outside the stage: ${importer}`);
  if (parts.includes("node_modules"))
    throw new Error(`app directory is inside node_modules: ${importer}`);
  return norm;
}

export function snapshotIndex(linkRoot, storeRoot, graph) {
  const storeReal = realpathSync(storeRoot);
  const index = {};
  const visit = (nodeModules, deps) => {
    for (const [name, key] of Object.entries(deps)) {
      const rel = storeRelative(
        relative(storeReal, realpathSync(join(nodeModules, name))).split(sep).join("/"),
      );
      if (Object.hasOwn(index, key) && index[key] !== rel)
        throw new Error(`inconsistent ${key}`);
      if (Object.hasOwn(index, key)) continue;
      const node = graph.packages[key];
      if (!node) throw new Error(`graph has no ${key}`);
      index[key] = rel;
      visit(storeNodeModules(realpathSync(join(nodeModules, name))), mergedEdges(node));
    }
  };
  for (const [importer, binding] of Object.entries(graph.bindings))
    visit(join(linkRoot, importer, "node_modules"), mergedEdges(binding));
  const missing = Object.keys(graph.packages).filter((key) => !Object.hasOwn(index, key));
  if (missing.length) throw new Error(`index missing ${missing[0]}`);
  if (graph.skipped.some((key) => Object.hasOwn(index, key)))
    throw new Error("skipped package was indexed");
  return index;
}

// The store directories of the stage's own links: each binding's direct
// dependencies, resolved in the app builder's install. Transitive packages are
// never linked by the stage, so a platform package the build host did not
// install (another architecture's optional binary) is never looked up.
export function bindingIndex(linkRoot, storeRoot, graph) {
  const storeReal = realpathSync(storeRoot);
  const index = {};
  for (const [importer, binding] of Object.entries(graph.bindings)) {
    for (const [name, key] of Object.entries(mergedEdges(binding))) {
      const rel = storeRelative(
        relative(storeReal, realpathSync(join(linkRoot, importer, "node_modules", name)))
          .split(sep)
          .join("/"),
      );
      if (Object.hasOwn(index, key) && index[key] !== rel) throw new Error(`inconsistent ${key}`);
      index[key] = rel;
    }
  }
  return index;
}

export function linkPlan(bindings, directories, index) {
  const dirs = {};
  const used = new Map();
  for (const importer of Object.keys(bindings)) {
    const dir = appDirectory(directories[importer], importer);
    const prior = used.get(dir);
    if (prior) throw new Error(`app directories collide: ${prior} ${importer}`);
    used.set(dir, importer);
    dirs[importer] = dir;
  }
  const stores = {};
  for (const binding of Object.values(bindings)) {
    for (const group of ["dependencies", "optionalDependencies"]) {
      for (const key of Object.values(binding[group])) {
        if (Object.hasOwn(stores, key)) continue;
        if (typeof index[key] !== "string") throw new Error(`index has no ${key}`);
        stores[key] = storeRelative(index[key]);
      }
    }
  }
  const links = [];
  for (const [importer, binding] of Object.entries(bindings)) {
    const dir = dirs[importer];
    for (const group of ["dependencies", "optionalDependencies"]) {
      for (const [name, key] of Object.entries(binding[group]))
        links.push({ at: `${dir}/node_modules/${name}`, store: stores[key] });
    }
    for (const [name, target] of Object.entries(binding.links))
      links.push({ at: `${dir}/node_modules/${name}`, own: dirs[target] });
  }
  links.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { links };
}

export function writeStage(stageRoot, storeRoot, plan) {
  if (stageRoot.split(sep).includes("node_modules"))
    throw new Error("stage is inside node_modules");
  const root = stageRoot.endsWith(sep) ? stageRoot : `${stageRoot}${sep}`;
  const dests = [];
  for (const link of plan.links) {
    const dest = join(stageRoot, link.at);
    if (!dest.startsWith(root)) throw new Error(`stage link escapes: ${link.at}`);
    if (occupied(dest)) throw new Error(`stage link already exists: ${link.at}`);
    dests.push({ link, dest });
  }
  for (const { link, dest } of dests) {
    mkdirSync(dirname(dest), { recursive: true });
    symlinkSync(
      link.store
        ? join(storeRoot, link.store)
        : relative(dirname(dest), join(stageRoot, link.own)),
      dest,
    );
  }
}
