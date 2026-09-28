// Host builder for the standalone ontology manager image. The app entry owns
// only its image name, sources and per-source owners; the recipe with its
// pinned Node builder and Nginx images and the three Nginx runtime files are
// this builder's shared facts. There is no runtime family, lock or fingerprint.
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertEntriesCurrent,
  assertFreshRecord,
  combineIdentity,
  docker,
  exportImage,
  imageLabels,
  inspectImage,
  parseOptions,
  readRevision,
  sampleSources,
} from "../build-support.mjs";
import { collectMetadataContext, copyWorkspace } from "../pnpm-workspace-context.mjs";

const FLAGS = { "--arch": "value", "--pack": "boolean" };
const RECIPE = "docker/ontology-manager";
// Copied to the context root, where the recipe's final stage COPYs them.
const RUNTIME_FILES = ["config.js.template", "nginx.conf.template", "docker-entrypoint.sh"];
// The per-source revisions/dirty flags; no second metadata file is written.
const SOURCES_LABEL = "io.runtime.sources";

function stageContext(app, arch) {
  const base = join(app.repoRoot, ".build", "contexts", "ontology-manager", arch);
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, "run-"));
}

function assertManagerImage(tag, arch, component, identity) {
  const inspected = inspectImage(tag, `linux/${arch}`);
  const labels = inspected && inspected.Config.Labels ? inspected.Config.Labels : {};
  if (
    !inspected ||
    inspected.Os !== "linux" ||
    inspected.Architecture !== arch ||
    labels["io.runtime.component"] !== component ||
    labels["io.runtime.kind"] !== "manager" ||
    labels["org.opencontainers.image.version"] !== identity.version ||
    labels["org.opencontainers.image.revision"] !== identity.revision ||
    labels["io.runtime.source.dirty"] !== String(identity.dirty) ||
    labels[SOURCES_LABEL] !== JSON.stringify(identity.sources)
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
  // Identity is sampled once; the later checks read HEAD only and never resample.
  const entries = sampleSources(app, version);
  const context = stageContext(app, arch);
  const record = collectMetadataContext({
    sources: app.sources,
    workspaceId: app.workspaceId,
    appImporter: app.appImporter,
    destination: context,
  });
  assertFreshRecord(entries, record);
  copyWorkspace(app, context, record, app.owners);
  assertEntriesCurrent(entries, "staging");
  for (const name of RUNTIME_FILES)
    cpSync(join(app.publicRoot, RECIPE, name), join(context, name));
  const combined = combineIdentity(version, app.repoRoot, entries);
  const tag = `${app.component}:${combined.stamp}-${arch}`;
  const alias = `${app.component}:deploy-${arch}`;
  console.log(`[build] manager ${tag}`);
  docker([
    "buildx",
    "build",
    "--provenance=false",
    "--platform",
    `linux/${arch}`,
    // The recipe pins the default builder image; the env only overrides it.
    ...(process.env.NODE_BUILDER_IMAGE
      ? ["--build-arg", `NODE_BUILDER_IMAGE=${process.env.NODE_BUILDER_IMAGE}`]
      : []),
    ...(process.env.PNPM_VERSION ? ["--build-arg", `PNPM_VERSION=${process.env.PNPM_VERSION}`] : []),
    "--load",
    "--build-arg",
    `WORKSPACE=${record.workspaceId}`,
    "--build-arg",
    `APPLICATION=${record.application}`,
    ...imageLabels(app.component, "manager", combined),
    "--label",
    `${SOURCES_LABEL}=${JSON.stringify(combined.sources)}`,
    "-t",
    tag,
    "-t",
    alias,
    "-f",
    join(app.publicRoot, RECIPE, "Dockerfile"),
    context,
  ]);
  assertManagerImage(tag, arch, app.component, combined);
  // The labels describe the sampled inputs: a source that moved during the
  // build fails instead of being relabeled.
  assertEntriesCurrent(entries, "the build");
  console.log(`MANAGER_IMAGE=${tag}\nMANAGER_DEPLOY_IMAGE=${alias}`);
  if (parsed["--pack"])
    await exportImage(
      [tag, alias],
      join(app.repoRoot, ".build", "pack", `${app.component}-${tag.slice(tag.indexOf(":") + 1)}.tar.gz`),
    );
}
