// Host-side build utilities. Node built-ins only; never invoke a host shell.
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

// Stable serialization for workspace metadata comparisons.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
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
  { capture = false, input, allowFailure = false, env } = {},
) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    input,
    env,
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
// Release CI can reuse the previous final image's inline BuildKit cache.
export function imageCacheArgs() {
  const ref = process.env.BUILD_CACHE_REF;
  return ref ? ["--cache-from", `type=registry,ref=${ref}`, "--cache-to", "type=inline"] : [];
}

// `docker image inspect` accepts --platform from API 1.49; omit it on older servers.
function supportsPlatformFlag() {
  const api =
    process.env.DOCKER_API_VERSION ||
    output("docker", ["version", "--format", "{{.Server.APIVersion}}"]);
  return Number(api.split(".")[1]) >= 49;
}
export function inspectImage(image, platform) {
  const platformArgs = supportsPlatformFlag() ? ["--platform", platform] : [];
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
export function sourceIdentity(root) {
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
    ]) !== "";
  return { revision, dirty };
}
export function imageLabels(component, version) {
  return Object.entries({
    "org.opencontainers.image.version": version,
    "io.ontomato.component": component,
  }).flatMap(([key, value]) => ["--label", `${key}=${value}`]);
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
    ...sourceIdentity(source.root),
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
