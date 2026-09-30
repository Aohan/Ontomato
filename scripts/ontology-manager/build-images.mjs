// Host builder for the standalone ontology manager image. The app entry owns
// only its image name, sources and per-source owners; the recipe with its
// pinned Node builder and Nginx images and the three Nginx runtime files are
// this builder's shared facts. There is no runtime family, lock or fingerprint.
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildStamp,
  docker,
  exportImage,
  imageLabels,
  inspectImage,
  parseOptions,
  readRevision,
  sampleSources,
  stagingDirectory,
} from "../build-support.mjs";
import { collectMetadataContext, copyWorkspace } from "../pnpm-workspace-context.mjs";

const FLAGS = { "--arch": "value", "--pack": "boolean" };
const RECIPE = "docker/ontology-manager";
// Copied to the context root, where the recipe's final stage COPYs them.
const RUNTIME_FILES = ["config.js.template", "nginx.conf.template", "docker-entrypoint.sh"];
// The public repository's own license files and the notice generator:
// [source under publicRoot, context path the recipe names].
const LICENSE_FILES = [
  ["LICENSE", "LICENSE"],
  ["NOTICE", "NOTICE"],
  ["scripts/third_party_notices.py", "tools/third_party_notices.py"],
];
function assertManagerImage(tag, arch, component, version) {
  const inspected = inspectImage(tag, `linux/${arch}`);
  const labels = inspected && inspected.Config.Labels ? inspected.Config.Labels : {};
  if (
    !inspected ||
    inspected.Os !== "linux" ||
    inspected.Architecture !== arch ||
    labels["io.runtime.component"] !== component ||
    labels["io.runtime.kind"] !== "manager" ||
    labels["org.opencontainers.image.version"] !== version
  )
    throw new Error(`Built image identity mismatch: ${tag}`);
}

export async function buildManagerImage(app, args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Use make ontology-manager [ARCH=amd64|arm64] or make pack-ontology-manager [ARCH=amd64|arm64].",
    );
    return;
  }
  const parsed = parseOptions(args, FLAGS);
  const arch = parsed["--arch"];
  const version = readRevision(readFileSync(join(app.publicRoot, "pom.xml"), "utf8"));
  const entries = sampleSources(app);
  const context = stagingDirectory(app.repoRoot, "ontology-manager", arch);
  const record = collectMetadataContext({
    sources: app.sources,
    workspaceId: app.workspaceId,
    appImporter: app.appImporter,
    destination: context,
  });
  copyWorkspace(app, context, record, app.owners);
  for (const name of RUNTIME_FILES)
    cpSync(join(app.publicRoot, RECIPE, name), join(context, name));
  for (const [source, dest] of LICENSE_FILES)
    cpSync(join(app.publicRoot, source), join(context, dest));
  const tag = `${app.component}:${buildStamp(version, app.repoRoot, entries)}-${arch}`;
  const alias = `${app.component}:deploy-${arch}`;
  console.log(`[build] manager ${tag}`);
  docker([
    "buildx",
    "build",
    "--provenance=false",
    "--platform",
    `linux/${arch}`,
    "--load",
    "--build-arg",
    `WORKSPACE=${record.workspaceId}`,
    "--build-arg",
    `APPLICATION=${record.application}`,
    ...imageLabels(app.component, "manager", version),
    "-t",
    tag,
    "-t",
    alias,
    "-f",
    join(app.publicRoot, RECIPE, "Dockerfile"),
    context,
  ]);
  assertManagerImage(tag, arch, app.component, version);
  if (parsed["--pack"])
    await exportImage(
      [tag, alias],
      join(app.repoRoot, ".build", "pack", `${app.component}-${tag.slice(tag.indexOf(":") + 1)}.tar.gz`),
    );
}
