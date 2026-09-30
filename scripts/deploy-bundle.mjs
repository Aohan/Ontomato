// Offline deployment pack: one tar.gz holding the deploy template, the assembly
// recipes and one gzip archive per already imported image of one architecture.
// Node built-ins and the Docker CLI only; no host shell.
import { cpSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execute, exportImage, inspectImage, parseOptions } from "./build-support.mjs";

// Only the deploy template goes into the pack. .env, backend_data and
// frontend_data are onsite state and are never packed.
export const TEMPLATE_ENTRIES = ["docker-compose.yml", "initdb.sql", "README.md", "assemble"];
const FLAGS = { "--arch": "value", "--deploy-dir": "value", "--name": "value", "--image": "list" };

// The pack is the only place that rewrites a template file, and only this line.
export function renderEnvExample(text, arch) {
  const lines = text.split("\n");
  if (lines.filter((line) => line.startsWith("ARCH=")).length !== 1)
    throw new Error(".env.example must contain exactly one ARCH= line");
  return lines
    .map((line) => (line.startsWith("ARCH=") ? `ARCH=${arch}` : line))
    .join("\n");
}

// inspectImage filters by platform on Docker API 1.49+ and returns null there;
// the explicit comparison covers older servers, where the flag is not sent.
export function assertImagePlatform(image, ref, arch) {
  if (!image || image.Os !== "linux" || image.Architecture !== arch)
    throw new Error(
      `Missing image or wrong architecture (linux/${arch}): ${ref}\n` +
        `Pull it with docker pull --platform linux/${arch} ${ref}, or import the matching architecture with docker load -i.`,
    );
  return image;
}

// Every app image carries the product version; one pack cannot mix two versions.
export function bundleVersion(apps) {
  if (apps.length === 0)
    throw new Error(
      "No app image (io.runtime.kind=app) among --image; the pack version comes from the app images",
    );
  const versions = [...new Set(apps.map((app) => app.version))];
  if (versions.length !== 1 || versions[0] === "")
    throw new Error(
      `App images report different versions: ${apps.map((app) => `${app.ref}=${app.version || "<none>"}`).join(", ")}`,
    );
  return versions[0];
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

export function imageFileName(ref) {
  return `${ref.replace(/[/:]/g, "-")}.tar.gz`;
}

async function main() {
  const options = parseOptions(process.argv.slice(2), FLAGS);
  if (!options["--deploy-dir"]) throw new Error("Required --deploy-dir <deploy directory>");
  if (!options["--name"]) throw new Error("Required --name <product name>");
  if ((options["--image"] || []).length === 0)
    throw new Error("Required at least one --image <reference>");
  const arch = options["--arch"];
  const deployDir = resolve(options["--deploy-dir"]);
  const images = options["--image"].map((ref) => ({
    ref,
    image: assertImagePlatform(inspectImage(ref, `linux/${arch}`), ref, arch),
  }));
  const labels = (image) => image.Config.Labels || {};
  const version = bundleVersion(
    images
      .filter(({ image }) => labels(image)["io.runtime.kind"] === "app")
      .map(({ ref, image }) => ({
        ref,
        version: labels(image)["org.opencontainers.image.version"] || "",
      })),
  );

  const base = bundleName(options["--name"], version, arch, new Date());
  const bundleRoot = resolve(".build", "bundle");
  const staging = join(bundleRoot, base);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  // realpathSync dereferences the deploy/assemble symlink: the pack holds files.
  for (const entry of TEMPLATE_ENTRIES)
    cpSync(realpathSync(join(deployDir, entry)), join(staging, entry), { recursive: true });
  writeFileSync(
    join(staging, ".env.example"),
    renderEnvExample(readFileSync(join(deployDir, ".env.example"), "utf8"), arch),
  );
  mkdirSync(join(staging, "images"));
  for (const { ref } of images)
    await exportImage([ref], join(staging, "images", imageFileName(ref)));

  const archive = `${staging}.tar.gz`;
  rmSync(archive, { force: true });
  execute("tar", ["--exclude=.DS_Store", "-czf", archive, "-C", bundleRoot, base]);
  console.log(`BUNDLE_TAR=${archive}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(`[bundle] ${error.message}`);
    process.exitCode = 1;
  });
