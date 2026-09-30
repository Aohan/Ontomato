// Host-side build utilities. Node built-ins only; never invoke a host shell.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

// Callers pass the interface version. Java data-engine is 3; this file does not own a product version.
export const COMPAT_LABEL = "io.runtime.compat-fingerprint";
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
export const fingerprint = (contract) =>
  createHash("sha256").update(canonical(contract)).digest("hex");
export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
export function parsePythonRequirements(text) {
  const packages = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s*#.*$/, "").trim();
    if (!line) continue;
    const match = /^([A-Za-z0-9_.-]+)==([^\s;]+)$/.exec(line);
    if (!match)
      throw new Error(`Runtime Python requirements must use exact name==version pins: ${line}`);
    const name = match[1].toLowerCase().replace(/[-_.]+/g, "-");
    packages[name] = match[2];
  }
  return packages;
}
export function readRevision(text) {
  const found = [...text.matchAll(/<revision>([^<]*)<\/revision>/g)].map(
    (match) => match[1],
  );
  if (found.length !== 1 || found[0].length === 0 || found[0].includes("$"))
    throw new Error("Public POM must contain one concrete revision");
  return found[0];
}

export function execute(
  executable,
  args,
  { capture = false, input, allowFailure = false } = {},
) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    input,
    maxBuffer: 32 * 1024 * 1024,
    stdio: capture
      ? ["pipe", "pipe", "pipe"]
      : ["inherit", "inherit", "inherit"],
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(
      `${executable} ${args.slice(0, 2).join(" ")} failed (${result.status ?? result.signal})${capture ? `\n${result.stderr}` : ""}`,
    );
  }
  return result;
}
export const output = (executable, args) =>
  execute(executable, args, { capture: true }).stdout.trim();
export const docker = (args) => execute("docker", args);
export function inspectImage(image, platform) {
  const api =
    process.env.DOCKER_API_VERSION ||
    output("docker", ["version", "--format", "{{.Server.APIVersion}}"]);
  const platformArgs =
    Number(api.split(".")[1]) >= 49 ? ["--platform", platform] : [];
  const result = execute(
    "docker",
    ["image", "inspect", ...platformArgs, image],
    { capture: true, allowFailure: true },
  );
  if (result.status !== 0) {
    if (
      /no such image|not found|does not match|does not provide/i.test(
        result.stderr,
      )
    )
      return null;
    throw new Error(`Cannot inspect ${image}: ${result.stderr}`);
  }
  return JSON.parse(result.stdout)[0];
}
export function runtimeTag(family, fp, arch) {
  return `${family}-runtime:compat-${fp.slice(0, 16)}-${arch}`;
}
export function validateContract(
  family,
  platform,
  contract,
  expected,
  interfaceVersion,
) {
  if (
    contract.family !== family ||
    contract.platform !== platform ||
    contract.interfaceVersion !== interfaceVersion
  )
    throw new Error(
      `Runtime contract does not match ${family}/${platform} or interface version ${interfaceVersion}`,
    );
  if (!/^[a-f0-9]{64}$/.test(expected) || fingerprint(contract) !== expected)
    throw new Error("Runtime contract/fingerprint mismatch");
  return contract;
}
function readLock(file, family) {
  const lock = readJson(file);
  if (
    lock.schema !== 3 ||
    lock.family !== family ||
    !lock.runtimes ||
    typeof lock.runtimes !== "object" ||
    Array.isArray(lock.runtimes) ||
    Object.entries(lock.runtimes).some(
      ([platform, fp]) =>
        !/^linux\/(amd64|arm64)$/.test(platform) ||
        typeof fp !== "string" ||
        !/^[a-f0-9]{64}$/.test(fp),
    )
  )
    throw new Error(
      "Invalid runtime-lock.json: expected schema 3, this runtime family and platform fingerprints",
    );
  return lock;
}
export function loadRuntimeLock(root, family, arch) {
  const file = join(root, "runtime-lock.json");
  if (!existsSync(file))
    throw new Error(
      "runtime-lock.json missing. Obtain it with the matching runtime release, or generate it with make pack.",
    );
  const fp = readLock(file, family).runtimes[`linux/${arch}`];
  if (!fp)
    throw new Error(
      `runtime-lock.json has no linux/${arch} release. Obtain that platform's runtime/lock, or publish it with make pack ARCH=${arch}.`,
    );
  return fp;
}
export function saveRuntimeLock(
  root,
  family,
  arch,
  contract,
  interfaceVersion,
) {
  const fp = fingerprint(contract);
  validateContract(family, `linux/${arch}`, contract, fp, interfaceVersion);
  const file = join(root, "runtime-lock.json");
  const prior = existsSync(file)
    ? readLock(file, family)
    : { schema: 3, family, runtimes: {} };
  const runtimes = { ...prior.runtimes, [`linux/${arch}`]: fp };
  const lock = {
    schema: 3,
    family,
    runtimes: Object.fromEntries(Object.entries(runtimes).sort()),
  };
  const text = `${JSON.stringify(lock, null, 2)}\n`;
  if (existsSync(file) && readFileSync(file, "utf8") === text) return fp;
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, file);
  return fp;
}
// lockPath is the service's own runtime lock (Node/Java); a builder without a
// runtime lock (Manager) omits it and the whole source state counts as dirty.
export function sourceIdentity(root, lockPath) {
  const revision = output("git", ["-C", root, "rev-parse", "HEAD"]);
  const dirty =
    output("git", [
      "-C",
      root,
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      ".",
      ...(lockPath ? [`:(exclude)${lockPath}`] : []),
    ]) !== "";
  return { revision, dirty };
}
export function imageLabels(component, kind, version, fp, family) {
  const labels = {
    "org.opencontainers.image.version": version,
    "io.runtime.component": component,
    "io.runtime.kind": kind,
  };
  if (fp) {
    labels[COMPAT_LABEL] = fp;
    labels["io.runtime.family"] = family;
  }
  return Object.entries(labels).flatMap(([key, value]) => [
    "--label",
    `${key}=${value}`,
  ]);
}
export async function exportImage(tags, file) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const child = spawn("docker", ["save", ...tags], {
    stdio: ["ignore", "pipe", "inherit"],
    shell: false,
    windowsHide: true,
  });
  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`docker save failed (${code ?? signal})`)),
    );
  });
  const writer = createWriteStream(temporary);
  const closed = new Promise((resolve) => writer.once("close", resolve));
  const compressed = pipeline(child.stdout, createGzip({ level: 9 }), writer);
  try {
    await Promise.all([completed, compressed]);
    await closed;
    renameSync(temporary, file);
  } catch (error) {
    child.kill();
    await Promise.allSettled([completed, compressed]);
    await closed; // Windows may leave a delete-pending file until this handle closes.
    rmSync(temporary, { force: true });
    throw error;
  }
  console.log(`[build] pack ${file}`);
}
export function parseOptions(args, allowedFlags) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const name = args[i];
    if (!Object.hasOwn(allowedFlags, name))
      throw new Error(`Unknown argument: ${name}`);
    if (allowedFlags[name] === "boolean") options[name] = true;
    else {
      if (i + 1 >= args.length || args[i + 1].startsWith("--"))
        throw new Error(`Missing value for ${name}`);
      const value = args[++i];
      if (allowedFlags[name] === "list")
        options[name] = [...(options[name] || []), value];
      else options[name] = value;
    }
  }
  if (!["amd64", "arm64"].includes(options["--arch"]))
    throw new Error(
      "Required --arch amd64|arm64; Make is the only source of ARCH.",
    );
  return options;
}

// Every participating source is sampled once, before staging. The stamp names
// the version tag: this version's app repo supplies the revision, and any dirty
// source marks the whole build dirty, otherwise a dirty public tree could ship
// as clean.
export function sampleSources(app) {
  return app.sources.map((source) => ({
    id: source.id,
    root: source.root,
    ...sourceIdentity(source.root, app.lockExclude),
  }));
}

export function buildStamp(version, appRoot, entries) {
  const app = entries.find((entry) => entry.root === appRoot);
  if (!app) throw new Error("this version's app repo is not a build source");
  const dirty = entries.some((entry) => entry.dirty);
  const local = new Date(Date.now() + 8 * 3600 * 1000)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
  return `${version}-${local}-g${app.revision.slice(0, 12)}${dirty ? "-dirty" : ""}`;
}

// A fixed per-builder staging directory, emptied before every build.
export function stagingDirectory(root, ...parts) {
  const directory = join(root, ".build", "contexts", ...parts);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  return directory;
}
