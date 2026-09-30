// Container-side app stager for the workbench app image. Runs in web-builder
// against the real workspace after the full frozen install and the web build:
// it checks pnpm's production selection against the graph closure,
// materializes /stage (selected own members as real dirs, third-party as
// absolute /opt/runtime links whose store paths come from this builder's own
// install of the same lock), copies the built web
// output, and writes .image-meta.json. The launch script and the empty data
// mount point are placed by the recipe, not here.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { output } from "../build-support.mjs";
import { productionClosure } from "./runtime-contract.mjs";
import { bindingIndex, linkPlan, writeStage } from "./runtime-layout.mjs";

const SOURCES = "/build/workspace";
const STAGE = "/stage";
const STORE = "/opt/runtime";
const INPUTS = "/inputs.json";
const SERVER = "@ontomato/workbench-server";
// Payload allowlist per member: manifest, sources, and the package-owned
// default resources the content layouts read. Web sources, tests, configs and
// installed node_modules never enter the image.
const KEEP_DIRS = ["src", "prompts", "skills", "data", "resources"];

// pnpm reports members relative to the workspace root, which is also how the
// lock importers and the graph link targets are keyed. Duplicated from the
// frozen installer: the app stager must not couple to it.
function projects(root, args = ["-r", "list", "--depth", "-1", "--json"]) {
  return JSON.parse(output("pnpm", args)).map((project) => ({
    name: project.name,
    path: relative(root, project.path).split(sep).join("/"),
    absolute: project.path,
    manifest: JSON.parse(readFileSync(join(project.path, "package.json"), "utf8")),
  }));
}

// The /app payload is single-rooted; source adjacency exists only at build
// time, so the ../<source>/ prefix is dropped. A collision across sources is
// a real error and surfaces in linkPlan's app-directories check.
export function stageDirectory(importer) {
  const parts = posix.normalize(importer).split("/");
  let depth = 0;
  while (parts[depth] === "..") depth += 1;
  if (depth > 1) throw new Error(`member path is outside the stage: ${importer}`);
  const dir = parts.slice(depth === 1 ? 2 : 0).join("/");
  if (dir === "" || dir === "." || dir.startsWith("/") || dir.split("/").includes(".."))
    throw new Error(`member path is outside the stage: ${importer}`);
  return dir;
}

export function copyMember(from, to) {
  mkdirSync(to, { recursive: true });
  cpSync(join(from, "package.json"), join(to, "package.json"));
  for (const name of KEEP_DIRS) {
    const source = join(from, name);
    if (!existsSync(source)) continue;
    // Payload boundary matches the workspace input boundary: nested installs,
    // tests and local env files never enter the image. writeStage's occupied
    // check is the backstop, not the filter.
    cpSync(source, join(to, name), {
      recursive: true,
      filter: (path) => {
        const parts = path.split(sep);
        if (parts.includes("node_modules") || parts.includes("__tests__")) return false;
        const base = parts.at(-1);
        return base !== ".env" && base !== ".npmrc" && !base.startsWith(".env.");
      },
    });
  }
}

// Pure assembly: bindings plus the pnpm-reported members plus the binding
// index from this builder's own install become stage directories, the link
// plan, and the member copies.
export function stagePlan(graph, members, index) {
  const directories = Object.fromEntries(
    Object.keys(graph.bindings).map((importer) => [importer, stageDirectory(importer)]),
  );
  const plan = linkPlan(graph.bindings, directories, index);
  const byPath = new Map(members.map((member) => [member.path, member]));
  const copies = Object.keys(graph.bindings).map((importer) => {
    const member = byPath.get(importer);
    if (!member) throw new Error(`binding has no member: ${importer}`);
    return { importer, from: member.absolute, to: directories[importer] };
  });
  return { directories, plan, copies };
}

// The production assembly step, called by main with boundary-read inputs:
// pnpm-reported members and selection come from the caller, everything else
// is computed here and can run against fixtures without pnpm.
export function assembleAppStage({
  root,
  stageRoot,
  storeRoot,
  record,
  meta,
  lock,
  members,
  selected,
}) {
  if (!meta || typeof meta.platform !== "string")
    throw new Error("meta.platform is required");
  const manifests = Object.fromEntries(members.map((member) => [member.path, member.manifest]));
  const platform = meta.platform;
  const graph = productionClosure(
    { importer: record.appImporter, manifests },
    lock,
    platform,
  );
  const index = bindingIndex(root, root, graph);
  const closure = Object.keys(graph.bindings).sort().join("\n");
  const chosen = selected.map((member) => member.path).sort().join("\n");
  if (closure !== chosen)
    throw new Error(
      `pnpm production selection differs from the graph closure\nselected:\n${chosen}\nclosure:\n${closure}`,
    );
  const { plan, copies } = stagePlan(graph, members, index);
  for (const copy of copies) copyMember(copy.from, join(stageRoot, copy.to));
  cpSync(join(root, "dist/web"), join(stageRoot, "dist/web"), { recursive: true });
  writeFileSync(join(stageRoot, ".image-meta.json"), `${JSON.stringify(meta)}\n`);
  writeStage(stageRoot, storeRoot, plan);
  return { graph, plan, copies };
}

function main() {
  const appMeta = process.env.APP_META_JSON;
  if (!appMeta) throw new Error("APP_META_JSON is required");
  const meta = JSON.parse(appMeta);
  const record = JSON.parse(readFileSync(INPUTS, "utf8"));
  const root = join(SOURCES, record.workspaceId);
  process.chdir(root);
  const members = projects(root);
  const server = members.find((member) => member.name === SERVER);
  if (!server) throw new Error(`workspace has no ${SERVER} member`);
  const yaml = createRequire(join(server.absolute, "package.json"))("yaml");
  const lock = yaml.parse(readFileSync(join(root, "pnpm-lock.yaml"), "utf8"));
  const selected = projects(root, [
    "--filter-prod",
    `${record.application}...`,
    "list",
    "--depth",
    "-1",
    "--json",
  ]);
  assembleAppStage({
    root,
    stageRoot: STAGE,
    storeRoot: STORE,
    record,
    meta,
    lock,
    members,
    selected,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
