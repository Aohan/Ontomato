// Shared data-engine image orchestration. Product names and source lists come from the app entry.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPAT_LABEL,
  docker,
  exportImage,
  fingerprint,
  imageLabels,
  inspectImage,
  loadRuntimeLock,
  output,
  parseOptions,
  readJson,
  requireRuntime,
  runtimeTag,
  saveRuntimeLock,
  sourceIdentity,
  validateContract,
} from "../build-support.mjs";

const FLAGS = {
  "--arch": "value",
  "--prompt-lang": "value",
  "--pack-runtime": "boolean",
  "--pack-app": "boolean",
};
const RECIPE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../docker/data-engine",
);

export function readRevision(text) {
  const found = [...text.matchAll(/<revision>([^<]*)<\/revision>/g)].map(
    (match) => match[1],
  );
  if (found.length !== 1 || found[0].length === 0 || found[0].includes("$"))
    throw new Error("Public POM must contain one concrete revision");
  return found[0];
}
export function selectPromptLanguage(root, lang) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) selectPromptLanguage(path, lang);
    else if (entry.isFile() && /\.en\.[^.]+$/.test(entry.name)) {
      if (lang === "en")
        renameSync(path, join(root, entry.name.replace(/\.en(\.[^.]+)$/, "$1")));
      else rmSync(path);
    }
  }
}
export function checkPythonRequirements(text, packages) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s*#.*$/, "").trim();
    if (!line) continue;
    const match = /^([A-Za-z0-9_.-]+)==([^\s;]+)$/.exec(line);
    if (!match)
      throw new Error(
        `Runtime Python requirements need exact name==version pins: ${line}`,
      );
    const name = match[1].toLowerCase().replace(/[-_.]+/g, "-");
    if (packages[name] !== match[2])
      throw new Error(
        `Runtime Python dependency mismatch: ${name} requires ${match[2]}, provides ${packages[name] || "missing"}. Publish a matching runtime with make pack.`,
      );
  }
}
function resetDirectory(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}
function copyFrom(root, source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(join(root, source), destination, { recursive: true });
}
function baseBuild(arch) {
  return ["buildx", "build", "--provenance=false", "--platform", `linux/${arch}`];
}
function envArgs(names) {
  const args = [];
  for (const name of names) {
    const value = process.env[name];
    if (value) args.push("--build-arg", `${name}=${value}`);
  }
  return args;
}
function dockerfile(name) {
  return join(RECIPE_DIR, name);
}
function readImageContract(image, arch) {
  return JSON.parse(
    output("docker", [
      "run",
      "--rm",
      "--platform",
      `linux/${arch}`,
      "--entrypoint",
      "cat",
      image,
      "/opt/datarag/runtime-contract.json",
    ]),
  );
}
function assertImage(image, arch, kind, component, fp, lang, promptLabel) {
  const inspected = inspectImage(image, `linux/${arch}`);
  const labels = inspected && inspected.Config.Labels ? inspected.Config.Labels : {};
  if (
    !inspected ||
    inspected.Os !== "linux" ||
    inspected.Architecture !== arch ||
    labels["io.runtime.component"] !== component ||
    labels["io.runtime.kind"] !== kind ||
    labels[COMPAT_LABEL] !== fp ||
    (lang && labels[promptLabel] !== lang)
  )
    throw new Error(`Built image identity mismatch: ${image}`);
}
export function importedRuntime(app, arch) {
  const fp = loadRuntimeLock(app.lockRoot, app.family, arch);
  const tag = requireRuntime(app.family, arch, fp);
  const contract = validateContract(
    app.family,
    `linux/${arch}`,
    readImageContract(tag, arch),
    fp,
    app.interfaceVersion,
  );
  checkPythonRequirements(
    readFileSync(join(app.repoRoot, app.requirements), "utf8"),
    contract.python.packages,
  );
  return { tag, alias: `${app.component}-runtime:deploy-${arch}`, fp, contract };
}
function exportJava(app, arch) {
  const context = join(app.repoRoot, ".build", "contexts", arch, "export");
  const dest = join(app.repoRoot, ".build", "contexts", arch, "exported");
  resetDirectory(context);
  resetDirectory(dest);
  for (const tree of app.contextTrees)
    for (const path of tree.paths)
      copyFrom(tree.root, path, join(context, tree.dest, path));
  console.log("MAVEN_EXPORT=export-central");
  docker([
    ...baseBuild(arch),
    ...envArgs(app.exportImages),
    "--target",
    "export-central",
    "--build-arg",
    `REACTOR_DIR=${app.reactorDir}`,
    "--build-arg",
    `APP_MODULE=${app.appModule}`,
    "--build-arg",
    `APP_LIB_MODULES=${app.appLibModules.join(" ")}`,
    "--build-arg",
    `EXCLUDE_ARTIFACT_IDS=${app.excludeArtifactIds}`,
    "-f",
    dockerfile("Dockerfile.build"),
    "--output",
    `type=local,dest=${dest}`,
    context,
  ]);
  return dest;
}
function stageRuntime(app, arch, exported) {
  const context = join(app.repoRoot, ".build", "contexts", arch, "runtime");
  resetDirectory(context);
  copyFrom(app.repoRoot, app.requirements, join(context, "requirements-py310.txt"));
  copyFrom(app.repoRoot, app.mcp, join(context, "mcp/mcpserver.py"));
  cpSync(join(exported, "runtime-lib"), join(context, "lib"), { recursive: true });
  for (const [source, dest] of app.bin)
    copyFrom(app.repoRoot, source, join(context, dest));
  writeFileSync(join(context, "runtime-arch.txt"), arch);
  return context;
}
function buildRuntime(app, arch, identity, exported) {
  const context = stageRuntime(app, arch, exported);
  const directory = join(app.repoRoot, ".build", `runtime-contract-${arch}`);
  const common = [
    ...baseBuild(arch),
    ...envArgs(app.runtimeImages),
    "--build-arg",
    `PAIR_CONTRACT=${app.pairContract}`,
    "--build-arg",
    `RUNTIME_CONTRACT_VERSION=${app.interfaceVersion}`,
    "-f",
    dockerfile("Dockerfile.runtime"),
  ];
  resetDirectory(directory);
  docker([
    ...common,
    "--target",
    "contract-export",
    "--output",
    `type=local,dest=${directory}`,
    context,
  ]);
  const contract = readJson(join(directory, "contract.json"));
  const fp = fingerprint(contract);
  validateContract(app.family, `linux/${arch}`, contract, fp, app.interfaceVersion);
  const tag = runtimeTag(app.family, fp, arch);
  const alias = `${app.component}-runtime:deploy-${arch}`;
  console.log(`[build] runtime ${tag}`);
  docker([
    ...common,
    "--target",
    "runtime",
    "--load",
    "--build-arg",
    `RUNTIME_COMPAT_FINGERPRINT=${fp}`,
    ...imageLabels(app.family, "runtime", identity, fp, app.family),
    "-t",
    tag,
    "-t",
    alias,
    context,
  ]);
  assertImage(tag, arch, "runtime", app.family, fp);
  if (fingerprint(readImageContract(tag, arch)) !== fp)
    throw new Error("Built runtime contract differs from exported contract");
  saveRuntimeLock(app.lockRoot, app.family, arch, contract, app.interfaceVersion);
  return { tag, alias, fp, contract };
}
function stageApp(app, arch, exported, lang) {
  const context = join(app.repoRoot, ".build", "contexts", arch, "app");
  resetDirectory(context);
  cpSync(join(exported, "runtime-lib"), join(context, "runtime-lib"), {
    recursive: true,
  });
  cpSync(join(exported, "app", "lib"), join(context, "payload", "lib"), {
    recursive: true,
  });
  copyFrom(app.repoRoot, app.requirements, join(context, "requirements-py310.txt"));
  for (const [source, dest] of app.resources) {
    const destination = join(context, dest);
    copyFrom(app.repoRoot, source, destination);
    selectPromptLanguage(destination, lang);
  }
  if (!existsSync(join(context, app.requiredSkill)))
    throw new Error("Missing default trend-forecaster skill");
  return context;
}
function buildApp(app, arch, identity, exported, runtime, lang) {
  const context = stageApp(app, arch, exported, lang);
  const tag = `${app.component}-app:${identity.stamp}-${arch}`;
  const alias = `${app.component}-app:deploy`;
  console.log(`[build] app ${tag} (prompt=${lang})`);
  docker([
    ...baseBuild(arch),
    "--load",
    "--build-arg",
    `RUNTIME_IMAGE=${runtime.tag}`,
    "--build-arg",
    `RUNTIME_COMPAT_FINGERPRINT=${runtime.fp}`,
    ...imageLabels(app.component, "app", identity, runtime.fp, app.family),
    "--label",
    `${app.promptLabel}=${lang}`,
    "-t",
    tag,
    "-t",
    alias,
    "-f",
    dockerfile("Dockerfile.app"),
    context,
  ]);
  assertImage(tag, arch, "app", app.component, runtime.fp, lang, app.promptLabel);
  docker(["tag", runtime.tag, runtime.alias]);
  return { tag, alias };
}
async function pack(app, image, role) {
  const suffix = image.tag.slice(image.tag.indexOf(":") + 1);
  await exportImage(
    [image.tag, image.alias],
    join(app.repoRoot, ".build", "pack", `${app.component}-${role}-${suffix}.tar.gz`),
  );
}
export async function buildJavaApp(app, args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Use make [ARCH=amd64|arm64] [PROMPT_LANG=zh|en], make pack, or make pack-app.\npack-app uses the locked, imported runtime and never rebuilds it.",
    );
    return;
  }
  const [command, ...flags] = args;
  if (!["all", "app"].includes(command))
    throw new Error("Expected all or app (normally invoked through Make)");
  const parsed = parseOptions(flags, FLAGS);
  const arch = parsed["--arch"];
  const lang = parsed["--prompt-lang"] ?? app.promptLang;
  if (!["zh", "en"].includes(lang)) throw new Error("Expected --prompt-lang zh|en");
  if (command === "app" && parsed["--pack-runtime"])
    throw new Error("Packaging flag does not match build action");
  console.log(`DOCKERFILES=${RECIPE_DIR}`);
  const version = readRevision(readFileSync(app.versionPom, "utf8"));
  const identity = sourceIdentity(version, app.repoRoot, app.lockExclude);
  console.log(
    `SOURCE_REVISION=${identity.revision} SOURCE_DIRTY=${identity.dirty} VERSION=${version}`,
  );
  output("docker", ["version", "--format", "{{.Server.Version}}"]);
  // Lock and imported-image failures happen before the Maven export.
  const imported = command === "app" ? importedRuntime(app, arch) : null;
  const exported = exportJava(app, arch);
  const runtime = imported ?? buildRuntime(app, arch, identity, exported);
  console.log(
    `RUNTIME_IMAGE=${runtime.tag}\nRUNTIME_DEPLOY_IMAGE=${runtime.alias}\nRUNTIME_COMPAT_FINGERPRINT=${runtime.fp}`,
  );
  if (parsed["--pack-runtime"]) await pack(app, runtime, "runtime");
  const built = buildApp(app, arch, identity, exported, runtime, lang);
  console.log(`APP_IMAGE=${built.tag}\nAPP_DEPLOY_IMAGE=${built.alias}`);
  if (parsed["--pack-app"]) await pack(app, built, "app");
}
