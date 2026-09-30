// Host Java dev entry for one product's apps/data-engine: stage the resources the app image would
// carry, sync them into the app's .dev data root with the container's rule (the shared Python sync,
// no bash), then run the reactor's spring-boot:run in the foreground. MCP, PostgreSQL and readiness
// belong to the full-stack entry.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { holdForeground } from "../dev-command.mjs";
import { stageResources } from "./build-images.mjs";

const SYNC = join(dirname(fileURLToPath(import.meta.url)), "sync-product-files.py");

// The one owner of the venv Python location: the host dev entry uses it for the sync, the
// full-stack entry for the MCP/skills service, and Windows venvs put it under Scripts/python.exe.
export function pythonExecutable(appDir, platform = process.platform) {
  return join(appDir, ".venv", ...(platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]));
}

// The venv follows the product's requirements file: created with the host Python when missing and
// reinstalled when the file changes. The installed file's hash is kept inside the venv, so a venv
// created by hand is brought up to date once and then reused.
export function ensurePythonEnv(appDir, requirements, env = process.env, platform = process.platform) {
  const python = pythonExecutable(appDir, platform);
  const venv = join(appDir, ".venv");
  const marker = join(venv, "requirements.sha256");
  const hash = createHash("sha256").update(readFileSync(requirements)).digest("hex");
  if (executable(python) && existsSync(marker) && readFileSync(marker, "utf8") === hash) return python;
  if (!executable(python)) {
    const host = platform === "win32" ? ["py", "-3"] : ["python3"];
    runSetup(host[0], [...host.slice(1), "-m", "venv", venv], env, `Creating ${venv} with ${host.join(" ")}`);
  }
  runSetup(python, ["-m", "pip", "install", "-r", requirements], env, `Installing ${requirements}`);
  writeFileSync(marker, hash);
  return python;
}

function runSetup(command, args, env, description) {
  console.log(`[python] ${description}`);
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.status !== 0)
    throw new Error(`${description} failed${result.error ? `: ${result.error.message}` : ""}; Python 3.10+ is required`);
}

// The official Maven wrapper pair shipped by the reactor root.
export function mavenWrapper(root, platform = process.platform) {
  return join(root, platform === "win32" ? "mvnw.cmd" : "mvnw");
}

// A .cmd file is a batch script, not an executable Node can start on its own, and Node would join
// file and arguments into one unescaped string. Windows therefore runs cmd.exe /c with the same
// per-argument escaping npm's cross-spawn applies: quotes and cmd meta characters (spaces included)
// are caret escaped, trailing backslashes are doubled, and the line is passed verbatim so Node
// never re-splits or re-joins a user Maven argument. Non-Windows keeps the direct exec. Whether
// cmd.exe preserves the arguments is covered by the Windows-only fake-wrapper test; the real
// Maven wrapper remains part of Windows integration verification.
//
// Escaping transcribed from cross-spawn 7.0.6 lib/util/escape.js, MIT License,
// Copyright (c) 2018 Made With MOXY Lda <hello@moxy.studio>.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

function cmdArgument(value) {
  const arg = value
    .replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')
    .replace(/(?=(\\+?)?)\1$/, "$1$1");
  return `"${arg}"`.replace(CMD_META, "^$1");
}

export function mavenInvocation(wrapper, args, platform = process.platform, comspec = process.env.ComSpec || "cmd.exe") {
  if (platform !== "win32") return { command: wrapper, args, verbatim: false };
  const line = [wrapper.replace(CMD_META, "^$1"), ...args.map(cmdArgument)].join(" ");
  return { command: comspec, args: ["/d", "/s", "/c", `"${line}"`], verbatim: true };
}

// The app's .env, read as the old host loader did: one KEY=value per line split at the first "=",
// value kept literally (spaces and further "=" included); blank keys and "#" lines are skipped.
// A trailing CR is a line terminator, not part of the value. Nothing is sourced or evaluated.
export function readDotEnv(text) {
  const vars = {};
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
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

// The child environment: file values override inherited ones. Windows variable names are
// case-insensitive, so an inherited Path and a file PATH are the same variable and only the file
// value survives; POSIX names stay case-sensitive and are merged as before.
export function mergeEnvironment(inherited, vars, platform = process.platform) {
  if (platform !== "win32") return { ...inherited, ...vars };
  const env = {};
  const spellings = new Map();
  for (const [name, value] of [...Object.entries(inherited), ...Object.entries(vars)]) {
    const upper = name.toUpperCase();
    if (spellings.has(upper)) delete env[spellings.get(upper)];
    spellings.set(upper, name);
    env[name] = value;
  }
  return env;
}

// Skills call `python` from PATH; the MCP/skills venv comes first. After the merge, Windows has at
// most one spelling of PATH; POSIX only ever has the exact PATH.
export function prependPythonPath(env, venvBin, platform = process.platform) {
  const key = platform === "win32"
    ? Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH"
    : "PATH";
  env[key] = `${venvBin}${delimiter}${env[key]}`;
}

// Everything that can fail on missing local setup fails here, before any staging or Maven; the
// Python venv is prepared here too.
export function startDevJava({ app, appDir, wrapper, profiles }, userArgs, inherited = process.env) {
  const lang = inherited.PROMPT_LANG ?? app.promptLang;
  if (!app.supportedPromptLangs.includes(lang))
    throw new Error(`PROMPT_LANG must be one of ${app.supportedPromptLangs.join(", ")}`);
  const envFile = join(appDir, ".env");
  if (!existsSync(envFile)) throw new Error(`Missing ${envFile}: create it with this app's Java settings first`);
  const python = ensurePythonEnv(appDir, join(app.requirements.root, app.requirements.path), inherited);
  const vars = readDotEnv(readFileSync(envFile, "utf8"));

  // The staging directory is rebuilt every time; .dev is only synced into, never cleared.
  const staging = join(app.repoRoot, ".build", "dev", "data-engine");
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  stageResources(app, staging, lang);
  // The staged layout is the app image's payload (conf-defaults and skills), synced as in the container.
  const sync = spawnSync(
    python,
    [SYNC, join(staging, "payload/conf-defaults"), join(staging, "payload/skills"), join(appDir, ".dev")],
    { stdio: "inherit" },
  );
  if (sync.status !== 0) throw new Error(`Resource sync into ${join(appDir, ".dev")} failed`);

  const env = mergeEnvironment(inherited, vars);
  prependPythonPath(env, dirname(python));
  // Certain VPNs (such as aTrustAgent) set up system SOCKS/HTTP proxies; when the JVM reads them, it hijacks local localhost connections,
  // leading to failure connecting to local PostgreSQL. Explicitly disable the JVM proxy here (placed last to ensure it overrides system-detected proxies).
  const disableProxy = "-DsocksProxyHost= -Dhttp.proxyHost= -Dhttps.proxyHost=";
  env.JAVA_TOOL_OPTIONS = env.JAVA_TOOL_OPTIONS ? `${env.JAVA_TOOL_OPTIONS} ${disableProxy}` : disableProxy;
  const args = ["-B", "-ntp", "-DskipTests", "-pl", relative(app.repoRoot, appDir), "-am",
    ...profiles.map((profile) => `-P${profile}`), "spring-boot:run", ...userArgs];
  const invocation = mavenInvocation(wrapper, args);
  return spawn(invocation.command, invocation.args, {
    cwd: app.repoRoot,
    env,
    stdio: "inherit",
    windowsVerbatimArguments: invocation.verbatim,
  });
}

// Foreground CLI: extra Maven arguments and the wrapper's exit result pass through unchanged.
// Foreground signal handling shares the platform rule with the other development commands.
export function runDevJava(options) {
  let child;
  try {
    child = startDevJava(options, process.argv.slice(2));
  } catch (error) {
    console.error(`[dev-java] ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const release = holdForeground(child);
  child.once("error", (error) => {
    console.error(`[dev-java] ${error.message}`);
    process.exitCode = 1;
  });
  child.once("close", (code, signal) => {
    release();
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
  });
}
