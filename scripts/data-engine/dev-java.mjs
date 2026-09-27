// Host Java dev entry for one product's apps/data-engine: stage the resources the app image would
// carry, sync them into the app's .dev data root with the container's rule, then run the reactor's
// spring-boot:run in the foreground. MCP, PostgreSQL and readiness belong to the full-stack entry.
import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { delimiter, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stageResources } from "./build-images.mjs";

const SYNC = join(dirname(fileURLToPath(import.meta.url)), "sync-product-files.sh");

// The app's .env, read as the old host loader did: one KEY=value per line split at the first "=",
// value kept literally (spaces and further "=" included); blank keys and "#" lines are skipped.
// Nothing is sourced or evaluated.
export function readDotEnv(text) {
  const vars = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    const key = at === -1 ? line : line.slice(0, at);
    if (key === "" || key.startsWith("#")) continue;
    vars[key] = at === -1 ? "" : line.slice(at + 1);
  }
  return vars;
}

function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Everything that can fail on missing local setup fails here, before any staging or Maven.
export function startDevJava({ app, appDir, wrapper, profiles }, userArgs, inherited = process.env) {
  const lang = inherited.PROMPT_LANG ?? app.promptLang;
  if (!["en", "zh"].includes(lang)) throw new Error("PROMPT_LANG must be en or zh");
  const envFile = join(appDir, ".env");
  if (!existsSync(envFile)) throw new Error(`Missing ${envFile}: create it with this app's Java settings first`);
  const venvBin = join(appDir, ".venv", "bin");
  if (!executable(join(venvBin, "python")))
    throw new Error(
      `Missing ${join(venvBin, "python")}: prepare it once with python3 -m venv ${join(appDir, ".venv")} && ` +
        `${join(venvBin, "pip")} install -r ${join(app.requirements.root, app.requirements.path)}`,
    );
  const vars = readDotEnv(readFileSync(envFile, "utf8"));

  // The staging directory is rebuilt every time; .dev is only synced into, never cleared.
  const staging = join(app.repoRoot, ".build", "dev", "data-engine");
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  stageResources(app, staging, lang);
  // The staged layout is the app image's payload (conf-defaults and skills), synced as in the container.
  const sync = spawnSync(
    "bash",
    [SYNC, join(staging, "payload/conf-defaults"), join(staging, "payload/skills"), join(appDir, ".dev")],
    { stdio: "inherit" },
  );
  if (sync.status !== 0) throw new Error(`Resource sync into ${join(appDir, ".dev")} failed`);

  const env = { ...inherited, ...vars };
  // Skills call `python` from PATH; the MCP/skills venv comes first.
  env.PATH = `${venvBin}${delimiter}${env.PATH}`;
  const args = ["-B", "-ntp", "-DskipTests", "-pl", relative(app.repoRoot, appDir), "-am",
    ...profiles.map((profile) => `-P${profile}`), "spring-boot:run", ...userArgs];
  return spawn(wrapper, args, { cwd: app.repoRoot, env, stdio: "inherit" });
}

// Foreground CLI: extra Maven arguments pass through unchanged; SIGINT/SIGTERM go to the wrapper and
// its exit code becomes ours (the same rule as scripts/dev-command.mjs).
export function runDevJava(options) {
  let child;
  try {
    child = startDevJava(options, process.argv.slice(2));
  } catch (error) {
    console.error(`[dev-java] ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const interrupt = () => child.kill("SIGINT"),
    terminate = () => child.kill("SIGTERM");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  child.once("error", (error) => {
    console.error(`[dev-java] ${error.message}`);
    process.exitCode = 1;
  });
  child.once("close", (code, signal) => {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
  });
}
