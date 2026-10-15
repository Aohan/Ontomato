// Deployment template plus an oc-mirror delivery. Mirror state stays outside the pack.
// Node built-ins and the Docker CLI only; no host shell.
import { chmodSync, cpSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execute, parseOptions } from "./build-support.mjs";

// Only the deploy template goes into the pack. .env, backend_data and
// frontend_data are onsite state and are never packed.
export const TEMPLATE_ENTRIES = ["docker-compose.yml", "initdb.sql", "README.md", "offline"];
// The fresh-install entry is assembled on the enterprise side (its build.sh
// inlines the shared shell library and injects the version); the pack only
// stages the assembled files. Paths are relative to --install-dir.
// The edition hands over one directory of assembled onsite entries (install.sh and any
// other entry with its helper scripts); the whole directory lands at the pack root, so a
// new entry needs no change here. Top-level shell entries stay executable whatever the umask.
export function stageInstallEntry(installDir, staging) {
  try {
    readFileSync(join(installDir, "install.sh"));
  } catch {
    throw new Error(`Install entry missing: ${join(installDir, "install.sh")}`);
  }
  cpSync(installDir, staging, { recursive: true });
  for (const name of readdirSync(installDir))
    if (name.endsWith(".sh")) chmodSync(join(staging, name), 0o755);
}

const FLAGS = {
  "--arch": "value", "--deploy-dir": "value", "--name": "value",
  "--install-dir": "value", "--version": "value", "--image-tag": "value",
  "--registry": "value", "--state": "value", "--bootstrap": "boolean",
  "--network": "value", "--insecure-source": "boolean", "--postgres": "value",
};

// The pack is the only place that rewrites a template file, and only this line.
export function renderEnvExample(text, arch) {
  const lines = text.split("\n");
  if (lines.filter((line) => line.startsWith("ARCH=")).length !== 1)
    throw new Error(".env.example must contain exactly one ARCH= line");
  return lines
    .map((line) => (line.startsWith("ARCH=") ? `ARCH=${arch}` : line))
    .join("\n");
}

const STAMP_OFFSET_MS = 8 * 3600 * 1000;
// UTC+8 local time, same shape as the build stamp: YYYYMMDD-HHMMSS.
export function bundleStamp(now) {
  return new Date(now.getTime() + STAMP_OFFSET_MS)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
}

export function bundleName(name, version, arch, now) {
  return `${name}-${version}-${bundleStamp(now)}-${arch}`;
}

async function main() {
  const options = parseOptions(process.argv.slice(2), FLAGS);
  if (!options["--deploy-dir"]) throw new Error("Required --deploy-dir <deploy directory>");
  if (!options["--name"]) throw new Error("Required --name <product name>");
  for (const name of ["--version", "--image-tag", "--registry", "--state"])
    if (!options[name]) throw new Error(`Required ${name}`);
  const arch = options["--arch"];
  const version = options["--version"];
  const deployDir = resolve(options["--deploy-dir"]);
  const enterprise = options["--name"] === "data-agent";
  const components = enterprise
    ? ["data-agent", "datarag", "ontology-manager"]
    : ["ontomato-workbench", "ontomato-data-engine", "ontomato-ontology-manager"];
  const image = (component) => `${options["--registry"]}/${component}:${options["--image-tag"]}-${arch}`;
  const base = bundleName(options["--name"], version, arch, new Date());
  const bundleRoot = resolve(".build", "bundle");
  const staging = join(bundleRoot, base);
  mkdirSync(staging, { recursive: true });
  // Dereference the shared offline tool directory; the package is self-contained.
  for (const entry of TEMPLATE_ENTRIES)
    cpSync(realpathSync(join(deployDir, entry)), join(staging, entry), { recursive: true });
  if (options["--install-dir"])
    stageInstallEntry(resolve(options["--install-dir"]), staging);
  writeFileSync(
    join(staging, ".env.example"),
    renderEnvExample(readFileSync(join(deployDir, ".env.example"), "utf8"), arch),
  );
  execute("python3", [
    join(deployDir, "offline", "mirror.py"), "export", "--arch", arch,
    "--edition", enterprise ? "enterprise" : "public", "--version", version,
    "--state", resolve(options["--state"]), "--output", join(staging, "package"),
    "--workbench", image(components[0]), "--data-engine", image(components[1]),
    "--manager", image(components[2]),
    ...(options["--bootstrap"] ? ["--bootstrap"] : []),
    ...(options["--postgres"] ? ["--postgres", options["--postgres"]] : []),
    ...(options["--network"] ? ["--network", options["--network"]] : []),
    ...(options["--insecure-source"] ? ["--insecure-source"] : []),
    ...(process.env.REGISTRY_AUTH_FILE ? ["--authfile", resolve(process.env.REGISTRY_AUTH_FILE)] : []),
  ]);

  const archive = `${staging}.tar.gz`;
  rmSync(archive, { force: true });
  execute("tar", ["--no-xattrs", "--exclude=.DS_Store", "--exclude=__pycache__", "--exclude=*.pyc", "-czf", archive, "-C", bundleRoot, base], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  console.log(`BUNDLE_TAR=${archive}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(`[bundle] ${error.message}`);
    process.exitCode = 1;
  });
