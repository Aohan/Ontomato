// Product root full-stack development entry point: PG -> local Python MCP -> Java ready -> frontend Node trio.
// Only relies on Node 24 built-ins, docker, and platform process/port queries (Unix uses ps/lsof/kill;
// Windows uses built-in PowerShell/CIM); product differences come entirely from each product's own dev/postgres.compose.yml,
// apps/data-engine/.env and .dev/conf; this tool does not know about edition.
// yaml is self-declared by the caller product root and parsed using that root; the tool has no fixed dependency location.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { get } from "node:http";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { devNull } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { holdForeground } from "./dev-command.mjs";
import { identifyWindows, windowsListeningPids, windowsProcesses, windowsStop } from "./dev-platform-windows.mjs";
import { ensurePythonEnv, pythonExecutable, readDotEnv } from "./data-engine/dev-java.mjs";

// Shared tools only anchor to the public core of their containing repo, without probing candidate paths based on product identity.
const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "packages", "data-engine-core");
const WINDOWS = process.platform === "win32";
const PRODUCT_COMMANDS = ["up", "down", "status", "logs"];
const TERM_WAIT_MS = 10_000;
const MCP_WAIT_MS = 30_000;
const JAVA_WAIT_MS = 120_000;
const FRONTEND_ROLES = ["frontend-root", "frontend-child"];
const MARKERS = ["mcpserver.py", "dev.mjs", "spring-boot:run", "RAGMain", "dev-command.mjs", "concurrently.js", "tsx/dist/", "vite/bin/vite.js", "pnpm"];

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}
function integerLiteral(value, label) {
  const text = String(value).trim();
  if (!/^[0-9]+$/.test(text)) throw new Error(`${label} must be a determinable integer port`);
  const port = Number(text);
  if (port < 1 || port > 65535) throw new Error(`${label} out of port range`);
  return port;
}
// Exact argv boundary: path may contain spaces, but must be a complete segment to avoid root prefix collisions (/x/a vs /x/a-2).
export function hasArg(command, token) {
  let from = 0;
  while (from <= command.length) {
    const at = command.indexOf(token, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : command[at - 1];
    const after = command[at + token.length] ?? "";
    if ((before === "" || /\s/.test(before)) && (after === "" || /\s/.test(after))) return true;
    from = at + 1;
  }
  return false;
}
export function composeProject(root) {
  const safe = basename(root).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z0-9]+/, "");
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 8);
  return `${safe || "product"}-dev-${hash}`;
}
export function productContext(rootInput) {
  const root = realpathSync(resolve(rootInput));
  const appDir = join(root, "apps", "data-engine");
  const devRoot = join(appDir, ".dev");
  return {
    root,
    product: basename(root),
    appDir,
    devRoot,
    coreRoot: CORE_ROOT,
    // Location of venv Python has only dev-java.mjs as owner: on Windows it is Scripts/python.exe.
    venvPython: pythonExecutable(appDir),
    mcpScript: join(CORE_ROOT, "mcp", "mcpserver.py"),
    requirements: join(CORE_ROOT, "requirements-py310.txt"),
    mcpTemplate: join(CORE_ROOT, "conf-defaults", "mcp-clients.yml"),
    applicationTemplate: join(CORE_ROOT, "conf-defaults", "application.yml"),
    javaEntry: join(appDir, "dev.mjs"),
    devCommand: join(root, "scripts", "dev-command.mjs"),
    javaEnvFile: join(appDir, ".env"),
    composeFile: join(root, "dev", "postgres.compose.yml"),
    backendLog: join(devRoot, "logs", "dev-backend.log"),
    mcpLog: join(devRoot, "logs", "dev-mcp.log"),
    project: composeProject(root),
  };
}
// Config parsing is a system boundary: yaml is self-declared by the caller product root;
// when missing, report that root instead of falling back to other node_modules.
export function yamlFor(root) {
  try {
    return createRequire(join(root, "package.json"))("yaml");
  } catch {
    throw new Error(`${join(root, "package.json")} does not declare a parsable yaml dependency`);
  }
}
export function applicationServerPort(text, root) {
  const port = yamlFor(root).parse(text)?.server?.port;
  if (typeof port === "number" && Number.isInteger(port)) return port;
  if (typeof port === "string" && /^[0-9]+$/.test(port.trim())) return Number(port.trim());
  return undefined;
}
// Local .env literal overrides inherited environment; then falls back to local application.yml;
// finally falls back to public template; never silently falls back on port.
export function resolveJavaPort(ctx, inherited = process.env) {
  const fileVars = existsSync(ctx.javaEnvFile) ? readDotEnv(readFileSync(ctx.javaEnvFile, "utf8")) : {};
  const vars = { ...inherited, ...fileVars };
  if (vars.SERVER_PORT !== undefined) return integerLiteral(vars.SERVER_PORT, "SERVER_PORT");
  const field = join(ctx.devRoot, "conf", "application.yml");
  const file = existsSync(field) ? field : ctx.applicationTemplate;
  if (!existsSync(file)) throw new Error(`Unable to determine Java port: missing application.yml; set SERVER_PORT explicitly in apps/data-engine/.env`);
  const port = applicationServerPort(readFileSync(file, "utf8"), ctx.root);
  if (port === undefined)
    throw new Error(`application.yml server.port is not a valid integer (${file}); set SERVER_PORT explicitly in apps/data-engine/.env`);
  return integerLiteral(port, "server.port");
}
// Pick the single http://127.0.0.1:<explicit-port>/sse entry for local compute service; remote entries are permitted. Errors report field locations.
export function localMcpPort(text, root) {
  const clients = yamlFor(root).parse(text)?.ontomato?.["data-engine"]?.["mcp-clients"];
  if (!Array.isArray(clients)) throw new Error("mcp-clients.yml: missing ontomato.data-engine.mcp-clients list");
  const locals = [];
  clients.forEach((client, index) => {
    if (client?.["sse-server"] === undefined) return;
    let url;
    try {
      url = new URL(String(client["sse-server"]));
    } catch {
      throw new Error(`mcp-clients.yml: ontomato.data-engine.mcp-clients[${index}].sse-server is not a valid URL`);
    }
    if (url.hostname !== "127.0.0.1") return;
    if (url.protocol !== "http:") throw new Error(`mcp-clients.yml: ontomato.data-engine.mcp-clients[${index}].sse-server must be http`);
    if (url.port === "") throw new Error(`mcp-clients.yml: ontomato.data-engine.mcp-clients[${index}].sse-server missing explicit port`);
    if (url.pathname !== "/sse") throw new Error(`mcp-clients.yml: ontomato.data-engine.mcp-clients[${index}].sse-server path must be /sse`);
    locals.push(integerLiteral(url.port, "MCP port"));
  });
  if (locals.length === 0) throw new Error("mcp-clients.yml: no local 127.0.0.1 MCP entry");
  if (locals.length > 1) throw new Error(`mcp-clients.yml: found ${locals.length} local MCP entries, exactly one required`);
  return locals[0];
}
export function resolveMcpPort(ctx) {
  const field = join(ctx.devRoot, "conf", "mcp-clients.yml");
  const file = existsSync(field) ? field : ctx.mcpTemplate;
  if (!existsSync(file)) throw new Error(`Cannot find MCP configuration (${field} or public template)`);
  return localMcpPort(readFileSync(file, "utf8"), ctx.root);
}
export function parseProcessTable(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.*)$/.exec(line);
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), lstart: match[3], command: match[4] });
  }
  return rows;
}
// ps renders argv as text. Match the executable and main script before reading
// arguments; a diagnostic carrying those paths as data is not a product process.
function executableArgs(command, name) {
  const end = command.indexOf(" ");
  if (end < 0 || basename(command.slice(0, end)) !== name) return undefined;
  return command.slice(end + 1);
}
function afterScript(args, script) {
  return args === script ? "" : args.startsWith(script + " ") ? args.slice(script.length + 1) : undefined;
}
function moduleArgs(args, suffix) {
  if (!args || args.startsWith("-")) return undefined;
  const at = args.indexOf(suffix);
  if (at < 0) return undefined;
  return afterScript(args, args.slice(0, at + suffix.length));
}
export function classify(command, cwd, ctx) {
  const node = executableArgs(command, "node");
  const java = executableArgs(command, "java");
  // Unix ps flattens argv without quoting. Keep the existing cwd/full-path checks;
  // splitting on spaces would break Java classpaths in checkouts with spaces.
  if (node !== undefined && moduleArgs(node, "/scripts/dev-stack.mjs") !== undefined) return "self";
  if (cwd === ctx.devRoot) {
    const python = afterScript(command, ctx.venvPython);
    if (python !== undefined && afterScript(python, ctx.mcpScript) !== undefined) return "mcp";
    // macOS framework Python (e.g. Homebrew) re-execs into the framework binary, so ps reports the
    // resolved interpreter path instead of the venv symlink. Fall back to the MCP script path so the
    // stack can still be owned on such installs.
    if (hasArg(command, ctx.mcpScript)) return "mcp";
    if (java !== undefined && hasArg(java, "io.ontomato.dataengine.RAGMain") &&
        (java.includes(`-cp ${ctx.devRoot}/conf:`) || java.includes(`-classpath ${ctx.devRoot}/conf:`))) return "ragmain";
  }
  if (cwd === ctx.root) {
    if (node !== undefined && [ctx.javaEntry, "apps/data-engine/dev.mjs"].some((p) => afterScript(node, p) !== undefined)) return "java-helper";
    if (java !== undefined && hasArg(java, "org.codehaus.plexus.classworlds.launcher.Launcher") &&
        hasArg(java, "spring-boot:run") && hasArg(java, `-Dmaven.multiModuleProjectDirectory=${ctx.root}`)) return "maven";
    if (node !== undefined) {
      for (const script of ["scripts/dev-command.mjs", join(ctx.root, "scripts/dev-command.mjs")]) {
        const args = afterScript(node, script);
        if (args !== undefined && /^(dev|server|web|manager)(?:\s|$)/.test(args)) return "frontend-root";
      }
      const concurrent = moduleArgs(node, "/concurrently/dist/bin/concurrently.js");
      if (concurrent !== undefined && ["server", "web", "ontology-manager"].every((mode) => hasArg(concurrent, `pnpm:dev:${mode}`))) return "frontend-root";
    }
    const pnpm = executableArgs(command, "pnpm") ?? (node !== undefined ? moduleArgs(node, "/pnpm.cjs") ?? moduleArgs(node, "/pnpm.js") : undefined);
    if (pnpm !== undefined && /^(?:run\s+)?dev(?:\s|$)/.test(pnpm)) return "frontend-root";
  }
  if (node === undefined) return undefined;
  const workbench = join(ctx.root, "apps/workbench");
  const manager = join(ctx.root, "apps/ontology-manager");
  if (cwd === workbench) {
    const tsx = moduleArgs(node, "/tsx/dist/cli.mjs");
    if (tsx !== undefined && ["src/index.ts", join(workbench, "src/index.ts")].some((script) => afterScript(tsx, `watch ${script}`) !== undefined)) return "frontend-root";
    if (!hasArg(node, "-e") && !hasArg(node, "--eval") && /^(--require|--import|-r)\s/.test(node) && node.includes("/tsx/") &&
        ["src/index.ts", join(workbench, "src/index.ts")].some((script) => node.endsWith(" " + script))) return "frontend-root";
    const vite = moduleArgs(node, "/vite/bin/vite.js");
    if (vite !== undefined && ["web/vite.config.ts", join(workbench, "web/vite.config.ts")].some((config) => afterScript(vite, `--config ${config}`) !== undefined)) return "frontend-root";
  }
  const vite = moduleArgs(node, "/vite/bin/vite.js");
  // Current dev-command manager passes checkout absolute root; also preserve relative form of legacy apps/ontology-manager scripts.
  if (cwd === manager && vite !== undefined &&
      (afterScript(vite, "--port 5174") !== undefined || afterScript(vite, `${manager} --port 5174`) !== undefined)) return "frontend-root";
  return undefined;
}
function psSnapshot() {
  const result = run("ps", ["-axo", "pid=,ppid=,lstart=,command="], { env: { ...process.env, LC_ALL: "C" } });
  if (result.status !== 0) throw new Error(`ps failed to read process table: ${result.stderr.trim() || `rc=${result.status}`}`);
  return parseProcessTable(result.stdout);
}
function lsofCwds(pids) {
  const cwds = new Map();
  if (!pids.length) return cwds;
  const result = run("lsof", ["-a", "-d", "cwd", "-Fpn", "-p", pids.join(",")]);
  if (result.error || ![0, 1].includes(result.status) || result.stderr.trim()) throw new Error("lsof unable to reliably read cwd");
  let pid;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid) cwds.set(pid, line.slice(1));
  }
  return cwds;
}
function isAlive(pid) {
  const result = run("ps", ["-p", String(pid), "-o", "pid="]);
  if (result.status === 0) return true;
  if (result.status === 1 && !result.stderr.trim()) return false;
  throw new Error("ps unable to confirm process exit status");
}
// Single ps snapshot (including lstart) + batch cwd queries for candidates; returns all checkout-owned roles and frontend descendants.
function identifyUnix(ctx) {
  const rows = psSnapshot();
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const cwdsToCheck = [ctx.root, ctx.devRoot, join(ctx.root, "apps/workbench"), join(ctx.root, "apps/ontology-manager")];
  const candidates = rows.filter((row) => MARKERS.some((marker) => row.command.includes(marker)) &&
    cwdsToCheck.some((cwd) => { const role = classify(row.command, cwd, ctx); return role && role !== "self"; }));
  const cwds = lsofCwds(candidates.map((row) => row.pid));
  const classified = new Map();
  const unattributable = [];
  for (const row of candidates) {
    const cwd = cwds.get(row.pid);
    if (cwd === undefined) {
      if (isAlive(row.pid)) unattributable.push(row);
      continue;
    }
    const role = classify(row.command, cwd, ctx);
    if (role && role !== "self") classified.set(row.pid, { ...row, cwd, role });
  }
  const members = new Set([...classified.values()].filter((entry) => entry.role === "frontend-root").map((entry) => entry.pid));
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows)
      if (!members.has(row.pid) && members.has(row.ppid)) {
        members.add(row.pid);
        grew = true;
      }
  }
  for (const pid of classified.keys()) members.add(pid);
  const extraCwds = lsofCwds([...members].filter((pid) => !classified.has(pid)));
  const group = [...members]
    .map((pid) => classified.get(pid) ?? (byPid.has(pid) ? { ...byPid.get(pid), cwd: extraCwds.get(pid), role: "frontend-child" } : undefined))
    .filter(Boolean);
  for (const entry of group) if (entry.cwd === undefined && isAlive(entry.pid)) unattributable.push(entry);
  return { group, unattributable, byPid };
}
// Platform only affects process/port queries: Unix uses ps+lsof, Windows uses CIM with absolute argv binding. Orchestration is shared.
export function identify(ctx) {
  return WINDOWS ? identifyWindows(windowsProcesses(), ctx) : identifyUnix(ctx);
}
function listeningPids(port) {
  if (WINDOWS) return windowsListeningPids(port);
  const result = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  if (result.error || ![0, 1].includes(result.status) || result.stderr.trim()) throw new Error("lsof unable to reliably read port");
  return result.stdout.trim().split("\n").filter(Boolean).map(Number);
}
export function foreignListeners(port, group) {
  return listeningPids(port).filter((pid) => !group.some((entry) => entry.pid === pid));
}
function ownsPort(port, entries) {
  const listeners = listeningPids(port);
  return listeners.length > 0 && listeners.every((pid) => entries.some((entry) => entry.pid === pid));
}
function assertNoForeign(port, snapshot, label) {
  if (foreignListeners(port, snapshot.group).length) throw new Error(`${label} port ${port} is already occupied by another process (this tool does not stop foreign processes)`);
}
function composeEnv(ctx, dbPort) {
  const env = { ...process.env, DB_PORT: String(dbPort), DEV_STACK_ROOT: ctx.root, DEV_STACK_PRODUCT: ctx.product };
  for (const key of ["COMPOSE_FILE", "COMPOSE_PROJECT_NAME", "COMPOSE_PROFILES", "COMPOSE_ENV_FILES"]) delete env[key];
  return env;
}
export function composeArgs(ctx, rest) {
  return ["compose", "--project-directory", dirname(ctx.composeFile), "--env-file", devNull, "-p", ctx.project, "-f", ctx.composeFile, ...rest];
}
function compose(ctx, dbPort, rest) {
  return run("docker", composeArgs(ctx, rest), { env: composeEnv(ctx, dbPort) });
}
function requireDocker() {
  if (run("docker", ["info"]).status !== 0)
    throw new Error("Docker is unavailable: please start Docker Desktop or dockerd and retry (this tool will not automatically open a GUI)");
}
// Containers and volumes in the same project: query failure must raise an error; empty labels must be kept as non-matching.
function assertNoForeignProject(ctx) {
  for (const kind of ["container", "volume"]) {
    const args =
      kind === "container"
        ? ["ps", "-a", "--filter", `label=com.docker.compose.project=${ctx.project}`, "--format", '{{.Label "dev.stack.root"}}']
        : ["volume", "ls", "--filter", `label=com.docker.compose.project=${ctx.project}`, "--format", '{{.Label "dev.stack.root"}}'];
    const result = run("docker", args);
    if (result.status !== 0) throw new Error(`docker ${kind} query failed: ${result.stderr.trim() || `rc=${result.status}`}`);
    // Docker outputs empty string when no resources exist; outputs empty line when resources exist but lack label - neither may be dropped.
    const labels = result.stdout.split("\n");
    if (labels[labels.length - 1] === "") labels.pop();
    for (const label of labels)
      if (label !== ctx.root)
        throw new Error(`Project ${ctx.project} has existing ${kind === "container" ? "container" : "volume"} belonging to ${label || "(no dev.stack.root label)"}, which does not match this checkout`);
  }
}
function postgresState(ctx, dbPort) {
  const result = compose(ctx, dbPort, ["ps", "--format", "json", "postgres"]);
  if (result.status !== 0) throw new Error(`docker compose ps failed: ${result.stderr.trim() || `rc=${result.status}`}`);
  let listed;
  try {
    listed = JSON.parse(result.stdout.trim() || "[]");
  } catch {
    throw new Error("docker compose ps returned unparseable JSON");
  }
  const entry = (Array.isArray(listed) ? listed : [listed]).find((item) => item?.Service === "postgres");
  if (!entry) return undefined;
  const published = (entry.Publishers ?? []).some((publisher) => publisher?.PublishedPort === dbPort && publisher.TargetPort === 5432 && publisher.Protocol === "tcp" && publisher.URL === "127.0.0.1");
  return { running: entry.State === "running", healthy: entry.Health === "healthy", published, state: entry.State, health: entry.Health };
}
async function spawnDetached(command, args, cwd, env, log) {
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, "a");
  try {
    const child = spawn(command, args, { cwd, env, detached: true, windowsHide: true, stdio: ["ignore", fd, fd] });
    await new Promise((done, reject) => { child.once("spawn", done); child.once("error", reject); });
    child.unref(); // detached isolates terminal signals; unref lets the foreground CLI exit.
    return child;
  } finally { closeSync(fd); }
}
function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}
async function waitForTcp(port, deadline) {
  while (Date.now() < deadline) {
    const ok = await new Promise((done) => {
      const socket = connect({ host: "127.0.0.1", port });
      const timer = setTimeout(() => { socket.destroy(); done(false); }, 2000);
      socket.once("connect", () => { clearTimeout(timer); socket.destroy(); done(true); });
      socket.once("error", () => { clearTimeout(timer); socket.destroy(); done(false); });
    });
    if (ok) return true;
    await sleep(500);
  }
  return false;
}
function javaReady(port) {
  return new Promise((done) => {
    const request = get(
      { host: "127.0.0.1", port, path: "/getABCTaskCountInQueue", headers: { "Accept-Language": "en" }, timeout: 3000 },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => {
          if (response.statusCode !== 200) return done(false);
          try {
            const parsed = JSON.parse(body);
            done(parsed?.success === true && Number.isInteger(parsed?.data) && parsed.data >= 0);
          } catch {
            done(false);
          }
        });
      },
    );
    request.on("timeout", () => { request.destroy(); done(false); });
    request.on("error", () => done(false));
  });
}
// Only read bytes added in this round to prevent historical failures from being treated as current failure on restart.
function readFrom(path, offset) {
  const fd = openSync(path, "r");
  try {
    const size = statSync(path).size;
    if (size <= offset) return "";
    const buffer = Buffer.alloc(size - offset);
    readSync(fd, buffer, 0, buffer.length, offset);
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
}
// Readiness requires this group's RAGMain to be listening, preventing residual helpers from attributing old responses to themselves.
async function waitForJava(ctx, port, startedAt) {
  const deadline = Date.now() + JAVA_WAIT_MS;
  while (Date.now() < deadline) {
    const ready = await javaReady(port);
    const snapshot = identify(ctx);
    const rag = snapshot.group.filter((entry) => entry.role === "ragmain");
    if (ready && ownsPort(port, rag)) return;
    const helper = snapshot.group.filter((entry) => ["java-helper", "maven"].includes(entry.role));
    if (snapshot.unattributable.length) throw new Error("Unable to confirm candidate process ownership");
    if (!helper.length && !rag.length) throw new Error(`Java entry point exited before becoming ready; see ${ctx.backendLog}`);
    if (startedAt !== undefined && existsSync(ctx.backendLog) && statSync(ctx.backendLog).size > startedAt) {
      if (/Application run failed/.test(readFrom(ctx.backendLog, startedAt)))
        throw new Error(`Java startup failed (Application run failed); see ${ctx.backendLog}`);
    }
    await sleep(1000);
  }
  throw new Error(`Java not ready within ${JAVA_WAIT_MS / 1000}s; see ${ctx.backendLog}`);
}
function requireAll(entries) {
  for (const [path, label] of entries) if (!existsSync(path)) throw new Error(`Missing ${path} (${label})`);
}
async function up(ctx) {
  const dbPort = integerLiteral(process.env.DB_PORT ?? "5432", "DB_PORT");
  const javaPort = resolveJavaPort(ctx);
  const mcpPort = resolveMcpPort(ctx);
  requireAll([[ctx.composeFile, "dev compose"], [ctx.javaEntry, "Java entry"], [ctx.javaEnvFile, "Java .env"], [ctx.mcpScript, "MCP script"]]);
  ensurePythonEnv(ctx.appDir, ctx.requirements);
  requireDocker();
  const pre = identify(ctx);
  if (pre.unattributable.length)
    throw new Error(`Unable to confirm ownership of ${pre.unattributable.length} candidate processes in this checkout (still alive), refusing to continue: ${pre.unattributable.map((row) => row.pid).join(", ")}`);
  assertNoForeignProject(ctx);
  const frontend = pre.group.filter((entry) => FRONTEND_ROLES.includes(entry.role));
  if (frontend.length) throw new Error(`Frontend in this checkout is already running: ${frontend.map((entry) => entry.pid).join(", ")}`);

  const pg = postgresState(ctx, dbPort);
  const ownMcp = pre.group.filter((entry) => entry.role === "mcp");
  const ownJava = pre.group.filter((entry) => entry.role === "ragmain");
  assertNoForeign(mcpPort, { group: ownMcp }, "MCP");
  assertNoForeign(javaPort, { group: ownJava }, "Java");
  if (ownMcp.length && !ownsPort(mcpPort, ownMcp)) throw new Error("Checkout MCP is not listening on configured port");
  for (const [port, label] of [[3000, "Node"], [5173, "Workbench Web"], [5174, "Manager"]]) assertNoForeign(port, { group: [] }, label);
  if (!pg || !pg.running || !pg.healthy || !pg.published) {
    if (pg && pg.running && pg.published) throw new Error(`PG container not healthy (state=${pg.state}, health=${pg.health}), stopping`);
    assertNoForeign(dbPort, pre, "PG");
    const started = compose(ctx, dbPort, ["up", "-d", "--wait", "--wait-timeout", "60"]);
    if (started.status !== 0) throw new Error(`PG startup failed: ${started.stderr.trim() || started.stdout.trim()}`);
  } else process.stdout.write(`[dev] PG is ready (project ${ctx.project})\n`);

  let snapshot = identify(ctx);
  const mcp = snapshot.group.filter((entry) => entry.role === "mcp");
  if (mcp.length && ownsPort(mcpPort, mcp)) process.stdout.write(`[dev] MCP is running\n`);
  else {
    if (mcp.length) throw new Error(`Checkout MCP process is not listening on ${mcpPort}, refusing reuse and new start`);
    assertNoForeign(mcpPort, snapshot, "MCP");
    const child = await spawnDetached(ctx.venvPython, [ctx.mcpScript, "--host", "127.0.0.1", "--port", String(mcpPort)], ctx.devRoot, process.env, ctx.mcpLog);
    process.stdout.write(`[dev] Started MCP pid ${child.pid} (port ${mcpPort}, log ${ctx.mcpLog})\n`);
    const ready = await waitForTcp(mcpPort, Date.now() + MCP_WAIT_MS);
    if (!ready || !ownsPort(mcpPort, identify(ctx).group.filter((entry) => entry.role === "mcp")))
      throw new Error(`MCP not ready within ${MCP_WAIT_MS / 1000}s or listener does not belong to this group; see ${ctx.mcpLog}`);
  }

  snapshot = identify(ctx);
  const java = snapshot.group.filter((entry) => ["java-helper", "maven", "ragmain"].includes(entry.role));
  if (java.length) await waitForJava(ctx, javaPort, undefined);
  else {
    assertNoForeign(javaPort, snapshot, "Java");
    mkdirSync(dirname(ctx.backendLog), { recursive: true });
    const startedAt = existsSync(ctx.backendLog) ? statSync(ctx.backendLog).size : 0;
    const child = await spawnDetached(process.execPath, [ctx.javaEntry], ctx.root, process.env, ctx.backendLog);
    process.stdout.write(`[dev] Started Java pid ${child.pid} (port ${javaPort}, log ${ctx.backendLog})\n`);
    await waitForJava(ctx, javaPort, startedAt);
  }

  snapshot = identify(ctx);
  if (snapshot.unattributable.length) throw new Error("Unable to confirm candidate process ownership");
  if (snapshot.group.some((entry) => FRONTEND_ROLES.includes(entry.role))) throw new Error("Frontend in this checkout is already running");
  for (const [port, label] of [[3000, "Node"], [5173, "Workbench Web"], [5174, "Manager"]]) assertNoForeign(port, { group: [] }, label);
  process.stdout.write(`[dev] Starting Node trio (foreground; Ctrl-C stops this group only, down stops full stack)\n`);
  // Direct foreground entry using checkout scripts/dev-command.mjs: bypasses pnpm.cmd, avoiding Windows shell parsing issues.
  const child = spawn(process.execPath, [ctx.devCommand, "dev"], { cwd: ctx.root, env: { ...process.env, PORT: "3000" }, stdio: "inherit", shell: false });
  const release = holdForeground(child);
  child.once("error", (error) => {
    process.stderr.write(`[dev] Frontend startup failed: ${error.message}\n`);
    process.exitCode = 1;
  });
  await new Promise((done) =>
    child.once("close", (code, signal) => {
      release();
      process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
      done();
    }),
  );
}
// Windows lacks forwardable graceful signals: within the same PowerShell invocation, acquire and hold Process handle for each confirmed PID,
// verify via CreationDate "already exited / reused" (safely skip) vs "identity unconfirmable / stop failed" (must report failure),
// and Kill on confirmed handle. Re-check group after stop; any remaining group processes cause failure, never claiming success on timeout or missed snapshot.
async function stopGroupWindows(ctx, roles, label, notes, failures) {
  const before = identify(ctx);
  if (before.unattributable.length) failures.push(`Unable to confirm candidate process ownership: ${before.unattributable.map((row) => row.pid).join(", ")}`);
  const owned = before.group.filter((entry) => roles.includes(entry.role));
  if (!owned.length) {
    notes.push(`${label} is not running`);
    return;
  }
  let result;
  try {
    result = windowsStop(owned);
  } catch (error) {
    failures.push(`${label} stop failed: ${error.message}`);
    return;
  }
  for (const pid of result.stopped) notes.push(`${label} pid ${pid} stopped`);
  for (const pid of result.exited) notes.push(`${label} pid ${pid} already exited, substitute process unhandled`);
  for (const pid of result.reused) notes.push(`${label} pid ${pid} already reused, substitute process unhandled`);
  for (const pid of result.failed) failures.push(`${label} pid ${pid} identity unconfirmed or stop failed`);
  const after = identify(ctx);
  if (after.unattributable.length) failures.push(`Unconfirmable candidate processes remain in group after stop: ${after.unattributable.map((row) => row.pid).join(", ")}`);
  const residual = after.group.filter((entry) => roles.includes(entry.role));
  if (residual.length) failures.push(`${label} group processes still running after stop: ${residual.map((entry) => entry.pid).join(", ")}`);
}
// TERM first; after 10s KILL only survivors whose identity is unchanged, and verify actual exit.
async function stopGroup(ctx, roles, label, notes, failures) {
  if (WINDOWS) return stopGroupWindows(ctx, roles, label, notes, failures);
  const initial = identify(ctx);
  if (initial.unattributable.length) failures.push(`Unable to confirm candidate process ownership: ${initial.unattributable.map((row) => row.pid).join(", ")}`);
  const owned = initial.group.filter((entry) => roles.includes(entry.role) && entry.cwd !== undefined);
  if (!owned.length) {
    notes.push(`${label} is not running`);
    return;
  }
  // Re-acquire identity fields before TERM to avoid targeting exited or reused PIDs.
  const current = identify(ctx);
  const taken = current.group;
  const stale = owned.filter((entry) => !taken.some((now) => now.pid === entry.pid && now.command === entry.command && now.cwd === entry.cwd && now.lstart === entry.lstart));
  for (const entry of stale) {
    const now = current.byPid.get(entry.pid);
    if (now && now.lstart === entry.lstart) failures.push(`${label} pid ${entry.pid} ownership changed, signal not sent`);
    else notes.push(`${label} original pid ${entry.pid} already exited, substitute process unhandled`);
  }
  const confirmed = owned.filter((entry) => !stale.includes(entry));
  if (!confirmed.length) return;
  if (run("kill", ["-TERM", ...confirmed.map((entry) => String(entry.pid))]).status !== 0) failures.push(`${label} TERM command failed`);
  const deadline = Date.now() + TERM_WAIT_MS;
  let survivors = confirmed;
  while (Date.now() < deadline) {
    survivors = confirmed.filter((entry) => isAlive(entry.pid));
    if (!survivors.length) {
      notes.push(`${label} stopped`);
      return;
    }
    await sleep(500);
  }
  for (const entry of survivors) {
    const row = psSnapshot().find((candidate) => candidate.pid === entry.pid);
    if (!row) continue;
    if (row.lstart !== entry.lstart || row.command !== entry.command || lsofCwds([entry.pid]).get(entry.pid) !== entry.cwd) {
      if (row.lstart === entry.lstart) failures.push(`${label} pid ${entry.pid} identity changed, skipped kill`);
      else notes.push(`${label} original pid ${entry.pid} already exited, substitute process unhandled`);
      continue;
    }
    if (run("kill", ["-KILL", String(entry.pid)]).status !== 0) { failures.push(`${label} pid ${entry.pid} failed to kill`); continue; }
    const end = Date.now() + 2000;
    while (isAlive(entry.pid) && Date.now() < end) await sleep(100);
    if (isAlive(entry.pid)) failures.push(`${label} pid ${entry.pid} still did not exit`);
    else notes.push(`${label} pid ${entry.pid} timed out, killed after identity confirmation`);
  }
}
async function down(ctx) {
  const dbPort = integerLiteral(process.env.DB_PORT ?? "5432", "DB_PORT");
  const notes = [];
  const failures = [];
  for (const [label, roles] of [["Frontend", FRONTEND_ROLES], ["Java entry", ["java-helper"]], ["Java residual", ["maven", "ragmain"]], ["MCP", ["mcp"]]]) {
    try { await stopGroup(ctx, roles, label, notes, failures); }
    catch (error) { failures.push(`${label} step incomplete: ${error.message}`); }
  }
  try {
    requireDocker();
    assertNoForeignProject(ctx);
    const result = compose(ctx, dbPort, ["down"]);
    if (result.status !== 0) failures.push(`PG stop failed: ${result.stderr.trim() || `rc=${result.status}`}`);
    else notes.push(`PG stopped (project ${ctx.project}, volume preserved)`);
  } catch (error) {
    failures.push(`PG step incomplete: ${error.message}`);
  }
  for (const note of notes) process.stdout.write(`[dev] ${note}\n`);
  if (failures.length) throw new Error(failures.join("; "));
}
function status(ctx) {
  const dbPort = integerLiteral(process.env.DB_PORT ?? "5432", "DB_PORT");
  const javaPort = resolveJavaPort(ctx);
  const mcpPort = resolveMcpPort(ctx);
  process.stdout.write(`[dev] Project ${ctx.project}\n[dev] Root ${ctx.root}\n`);
  let pgOwned = false;
  try {
    requireDocker();
    assertNoForeignProject(ctx);
    const pg = postgresState(ctx, dbPort);
    pgOwned = Boolean(pg?.running && pg.published);
    process.stdout.write(`[dev] PG: ${pgOwned ? `${pg.state}/${pg.health} port ${pg.published ? "published" : "not published on local port"}` : "not running"}\n`);
  } catch (error) {
    process.stdout.write(`[dev] PG status unknown: ${error.message}\n`);
  }
  const snapshot = identify(ctx);
  if (snapshot.unattributable.length) throw new Error("Candidate processes cannot be confirmed, status incomplete");
  for (const [role, label] of [["mcp", "MCP"], ["java-helper", "Java entry"], ["maven", "Maven"], ["ragmain", "RAGMain"], ["frontend-root", "Frontend root"], ["frontend-child", "Frontend child"]]) {
    const pids = snapshot.group.filter((entry) => entry.role === role).map((entry) => entry.pid);
    process.stdout.write(`[dev] ${label}: ${pids.join(", ") || "not running"}\n`);
  }
  const ports = pgOwned ? [[mcpPort, "MCP"], [javaPort, "Java"], [3000, "Node"], [5173, "Workbench Web"], [5174, "Manager"]] : [[dbPort, "PG"], [mcpPort, "MCP"], [javaPort, "Java"], [3000, "Node"], [5173, "Workbench Web"], [5174, "Manager"]];
  for (const [port, label] of ports)
    if (foreignListeners(port, snapshot.group).length) process.stdout.write(`[dev] ${label} port ${port} occupied by external process\n`);
}
const LOG_TAIL_LINES = 10;
const LOG_READ_BYTES = 64 * 1024;
// File identity with creation time: when same path is recreated and inode happens to be reused, still recognized as new file to avoid missing beginning when size>=offset.
const fileIdentity = (stats) => `${stats.dev}:${stats.ino}:${stats.birthtimeMs}`;
// Read at most LOG_READ_BYTES at once; short read only outputs bytesRead bytes without NUL.
function readAt(handle, offset, size) {
  const buffer = Buffer.alloc(Math.min(LOG_READ_BYTES, size - offset));
  const bytesRead = readSync(handle, buffer, 0, buffer.length, offset);
  return buffer.subarray(0, bytesRead);
}
// Use Node file API instead of tail(1): output last 10 lines first, then tail on append;
// recognize rotation/replacement by file identity, reset offset to 0 on truncate; bounded buffer;
// ENOENT treated as rotation in progress and awaits new file; other errors fail explicitly and clean up timer/listeners.
function logs(ctx) {
  const path = ctx.backendLog;
  if (!existsSync(path)) throw new Error(`Log does not exist: ${path}`);
  const initial = statSync(path);
  let handle = openSync(path, "r");
  let identity = fileIdentity(initial);
  let offset = initial.size;
  const start = Math.max(0, initial.size - LOG_READ_BYTES);
  const lines = readAt(handle, start, initial.size).toString("utf8").split("\n");
  if (start > 0) lines.shift();
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines.length) process.stdout.write(lines.slice(-LOG_TAIL_LINES).join("\n") + "\n");

  let timer;
  const stop = () => {
    clearInterval(timer);
    if (handle !== undefined) { closeSync(handle); handle = undefined; }
    process.removeListener("SIGINT", stop).removeListener("SIGTERM", stop);
  };
  const fail = (error) => {
    stop();
    process.stderr.write(`[dev] Log tail failed: ${error.message}\n`);
    process.exitCode = 1;
  };
  const drain = (from) => {
    let at = from;
    const size = fstatSync(handle).size;
    for (;;) {
      if (at >= size) return at;
      const chunk = readAt(handle, at, size);
      if (chunk.length === 0) return at;
      process.stdout.write(chunk);
      at += chunk.length;
    }
  };
  timer = setInterval(() => {
    let current;
    try {
      current = statSync(path);
    } catch (error) {
      if (error.code === "ENOENT") return; // Rotating: wait for new file to appear
      fail(error);
      return;
    }
    try {
      if (handle === undefined || fileIdentity(current) !== identity) {
        if (handle !== undefined) closeSync(handle);
        handle = undefined; // Invalidate old fd first; if openSync fails, stop won't double-close
        handle = openSync(path, "r");
        identity = fileIdentity(fstatSync(handle));
        offset = 0; // New file at path: read from beginning of new content, don't skip by old offset
      }
      if (fstatSync(handle).size < offset) offset = 0; // Truncated in place
      offset = drain(offset);
    } catch (error) {
      if (error.code === "ENOENT") return; // Replacement vanished between stat and open; retry next poll.
      fail(error);
    }
  }, 500);
  process.once("SIGINT", stop).once("SIGTERM", stop);
}
export async function main(argv = process.argv.slice(2)) {
  const [rootInput, command = "up"] = argv;
  if (!rootInput || !PRODUCT_COMMANDS.includes(command)) throw new Error("Usage: scripts/dev-stack.mjs <product-root> [up|down|status|logs]");
  const ctx = productContext(rootInput);
  if (command === "up") await up(ctx);
  else if (command === "down") await down(ctx);
  else if (command === "status") status(ctx);
  else logs(ctx);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[dev-stack] ${error.message}`);
    process.exitCode = 1;
  });
}
