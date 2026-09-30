import { posix } from "node:path";

const groups = ["dependencies", "optionalDependencies"];

function allows(constraint, value) {
  if (!constraint) return true;
  if (constraint.includes(`!${value}`)) return false;
  if (constraint.every((item) => item.startsWith("!"))) return true;
  return constraint.includes(value);
}

function manifestAt(manifests, path) {
  const manifest = manifests[path];
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    typeof manifest.name !== "string" ||
    manifest.name === ""
  )
    throw new Error(`manifest has no name: ${path}`);
  return manifest;
}

function declarationMap(manifest, group, path) {
  if (!Object.hasOwn(manifest, group)) return {};
  const block = manifest[group];
  if (typeof block !== "object" || block === null || Array.isArray(block))
    throw new Error(`manifest ${group} is not a declaration map: ${path}`);
  for (const [name, spec] of Object.entries(block)) {
    if (typeof spec !== "string")
      throw new Error(`manifest specifier is not a string: ${path} ${name}`);
  }
  return block;
}

function lockGroup(record, group, path) {
  if (!Object.hasOwn(record, group)) return {};
  const block = record[group];
  if (typeof block !== "object" || block === null || Array.isArray(block))
    throw new Error(`lock ${group} is not a record map: ${path}`);
  return block;
}

function readImporterDep(entry, where) {
  if (
    typeof entry !== "object" ||
    entry === null ||
    typeof entry.specifier !== "string" ||
    typeof entry.version !== "string"
  )
    throw new Error(`lock importer dependency is not a record: ${where}`);
  return entry;
}

function readSnapshotRef(spec, where) {
  if (typeof spec !== "string") throw new Error(`snapshot dependency is not a ref: ${where}`);
  return spec;
}

function snapshotKey(lock, name, version) {
  const named = `${name}@${version}`;
  if (Object.hasOwn(lock.snapshots, named)) return named;
  if (Object.hasOwn(lock.snapshots, version)) return version;
  return named;
}

export function productionGraph(lock, importer, manifests, cpu) {
  if (lock.lockfileVersion !== "9.0") throw new Error("lockfileVersion is not 9.0");
  if (cpu !== "arm64" && cpu !== "x64") throw new Error("cpu must be arm64 or x64");
  if (!Object.hasOwn(manifests, importer))
    throw new Error(`importer is outside the manifest map: ${importer}`);
  const packages = {};
  const skipped = [];
  const bindings = {};
  const seen = new Set();

  function visit(name, version, optional, from) {
    const key = snapshotKey(lock, name, version);
    const snap = lock.snapshots[key];
    const meta = lock.packages[key.split("(")[0]];
    if (!snap || !meta) throw new Error(`unresolved ${key} from ${from}`);
    if (!allows(meta.os, "linux") || !allows(meta.cpu, cpu) || !allows(meta.libc, "glibc")) {
      if (!optional) throw new Error(`required ${key} is not linux/${cpu} glibc`);
      skipped.push(key);
      return null;
    }
    const integrity = meta.resolution && meta.resolution.integrity;
    if (!integrity) throw new Error(`no integrity: ${key}`);
    if (packages[key]) return key;
    const node = (packages[key] = {
      integrity,
      dependencies: {},
      optionalDependencies: {},
      peers: meta.peerDependencies ? Object.keys(meta.peerDependencies) : [],
      requiresBuild: meta.requiresBuild === true,
      hasBin: meta.hasBin === true,
    });
    for (const group of groups) {
      const deps = snap[group];
      if (!deps) continue;
      for (const [child, spec] of Object.entries(deps)) {
        const childKey = visit(
          child,
          readSnapshotRef(spec, `${key} ${child}`),
          group === "optionalDependencies",
          key,
        );
        if (childKey) node[group][child] = childKey;
      }
    }
    return key;
  }

  function walk(path) {
    if (seen.has(path)) return;
    seen.add(path);
    const record = lock.importers[path];
    if (!record) throw new Error(`lock has no importer: ${path}`);
    const manifest = manifestAt(manifests, path);
    const binding = (bindings[path] = {
      dependencies: {},
      optionalDependencies: {},
      links: {},
    });
    for (const group of groups) {
      const declared = declarationMap(manifest, group, path);
      const locked = lockGroup(record, group, path);
      const declaredNames = Object.keys(declared).sort();
      const lockedNames = Object.keys(locked).sort();
      if (declaredNames.join("\n") !== lockedNames.join("\n"))
        throw new Error(`manifest and lock ${group} differ: ${path}`);
      for (const name of lockedNames) {
        const entry = readImporterDep(locked[name], `${path} ${name}`);
        if (entry.specifier !== declared[name])
          throw new Error(`specifier mismatch: ${path} ${name}`);
        if (entry.version.startsWith("link:")) {
          const target = posix.normalize(posix.join(path, entry.version.slice(5)));
          if (!Object.hasOwn(manifests, target))
            throw new Error(`link target is outside the manifest map: ${target}`);
          if (manifestAt(manifests, target).name !== name)
            throw new Error(`link ${name} does not match manifest ${target}`);
          binding.links[name] = target;
          walk(target);
        } else {
          const key = visit(name, entry.version, group === "optionalDependencies", path);
          if (key) binding[group][name] = key;
        }
      }
    }
  }

  walk(importer);
  return { packages, skipped: [...new Set(skipped)].sort(), bindings };
}
