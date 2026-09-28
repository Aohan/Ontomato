// 产品根整栈开发入口：PG → 本机 Python MCP → Java 就绪 → 前台 Node 三进程。
// 只依赖 Node 20 内建、docker，以及各平台的进程/监听查询（Unix 用 ps/lsof/kill，Windows 用
// 内置 PowerShell/CIM）；产品差异全部来自各产品自己的 dev/postgres.compose.yml、
// apps/data-engine/.env 与 .dev/conf，本工具不认识 edition。
// yaml 由调用方产品根自我声明并按该根解析，工具没有固定依赖位置。
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

// 共享工具只锚定自己所在仓的公共 core，不按产品身份探测候选路径。
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
  if (!/^[0-9]+$/.test(text)) throw new Error(`${label} 必须是可确定的整数端口`);
  const port = Number(text);
  if (port < 1 || port > 65535) throw new Error(`${label} 超出端口范围`);
  return port;
}
// 精确 argv 边界：路径可含空格，但必须是完整一段，避免根前缀碰撞（/x/a 与 /x/a-2）。
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
    // venv Python 的位置只有 dev-java.mjs 一份拥有者：Windows 在 Scripts/python.exe。
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
// 配置解析是系统边界：yaml 由调用方产品根自我声明；缺失时报出该根，不退回别的 node_modules。
export function yamlFor(root) {
  try {
    return createRequire(join(root, "package.json"))("yaml");
  } catch {
    throw new Error(`${join(root, "package.json")} 未声明可解析的 yaml 依赖`);
  }
}
export function applicationServerPort(text, root) {
  const port = yamlFor(root).parse(text)?.server?.port;
  if (typeof port === "number" && Number.isInteger(port)) return port;
  if (typeof port === "string" && /^[0-9]+$/.test(port.trim())) return Number(port.trim());
  return undefined;
}
// 现场 .env 字面值覆盖继承环境；再退现场 application.yml；最后退公共模板，不静默回退端口。
export function resolveJavaPort(ctx, inherited = process.env) {
  const fileVars = existsSync(ctx.javaEnvFile) ? readDotEnv(readFileSync(ctx.javaEnvFile, "utf8")) : {};
  const vars = { ...inherited, ...fileVars };
  if (vars.SERVER_PORT !== undefined) return integerLiteral(vars.SERVER_PORT, "SERVER_PORT");
  const field = join(ctx.devRoot, "conf", "application.yml");
  const file = existsSync(field) ? field : ctx.applicationTemplate;
  if (!existsSync(file)) throw new Error(`无法确定 Java 端口：缺少 application.yml，请在 apps/data-engine/.env 显式设置 SERVER_PORT`);
  const port = applicationServerPort(readFileSync(file, "utf8"), ctx.root);
  if (port === undefined)
    throw new Error(`application.yml 的 server.port 不是可确定整数（${file}）；请在 apps/data-engine/.env 显式设置 SERVER_PORT`);
  return integerLiteral(port, "server.port");
}
// 只为本机计算服务挑唯一一条 http://127.0.0.1:<显式端口>/sse；远程条目允许存在。错误只报字段位置。
export function localMcpPort(text, root) {
  const clients = yamlFor(root).parse(text)?.ontomato?.datarag?.["mcp-clients"];
  if (!Array.isArray(clients)) throw new Error("mcp-clients.yml: 缺少 ontomato.datarag.mcp-clients 列表");
  const locals = [];
  clients.forEach((client, index) => {
    if (client?.["sse-server"] === undefined) return;
    let url;
    try {
      url = new URL(String(client["sse-server"]));
    } catch {
      throw new Error(`mcp-clients.yml: ontomato.datarag.mcp-clients[${index}].sse-server 不是有效 URL`);
    }
    if (url.hostname !== "127.0.0.1") return;
    if (url.protocol !== "http:") throw new Error(`mcp-clients.yml: ontomato.datarag.mcp-clients[${index}].sse-server 必须是 http`);
    if (url.port === "") throw new Error(`mcp-clients.yml: ontomato.datarag.mcp-clients[${index}].sse-server 缺少显式端口`);
    if (url.pathname !== "/sse") throw new Error(`mcp-clients.yml: ontomato.datarag.mcp-clients[${index}].sse-server 路径必须是 /sse`);
    locals.push(integerLiteral(url.port, "MCP 端口"));
  });
  if (locals.length === 0) throw new Error("mcp-clients.yml: 没有本机 127.0.0.1 的 MCP 条目");
  if (locals.length > 1) throw new Error(`mcp-clients.yml: 有 ${locals.length} 个本机 MCP 条目，要求唯一`);
  return locals[0];
}
export function resolveMcpPort(ctx) {
  const field = join(ctx.devRoot, "conf", "mcp-clients.yml");
  const file = existsSync(field) ? field : ctx.mcpTemplate;
  if (!existsSync(file)) throw new Error(`找不到 MCP 配置（${field} 或公共模板）`);
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
  // 现行 dev-command manager 传本检出绝对 root；也保留旧 apps/ontology-manager 脚本的相对形式。
  if (cwd === manager && vite !== undefined &&
      (afterScript(vite, "--port 5174") !== undefined || afterScript(vite, `${manager} --port 5174`) !== undefined)) return "frontend-root";
  return undefined;
}
function psSnapshot() {
  const result = run("ps", ["-axo", "pid=,ppid=,lstart=,command="], { env: { ...process.env, LC_ALL: "C" } });
  if (result.status !== 0) throw new Error(`ps 读取进程表失败: ${result.stderr.trim() || `rc=${result.status}`}`);
  return parseProcessTable(result.stdout);
}
function lsofCwds(pids) {
  const cwds = new Map();
  if (!pids.length) return cwds;
  const result = run("lsof", ["-a", "-d", "cwd", "-Fpn", "-p", pids.join(",")]);
  if (result.error || ![0, 1].includes(result.status) || result.stderr.trim()) throw new Error("lsof 无法可靠读取 cwd");
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
  throw new Error("ps 无法确认进程是否退出");
}
// 一次 ps 快照（含 lstart）+ 对候选批量取 cwd；返回本检出自有的全部角色与前端后代。
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
// 平台只影响进程/监听查询：Unix 用 ps+lsof，Windows 用 CIM 并按绝对 argv 绑定。编排共用一份。
export function identify(ctx) {
  return WINDOWS ? identifyWindows(windowsProcesses(), ctx) : identifyUnix(ctx);
}
function listeningPids(port) {
  if (WINDOWS) return windowsListeningPids(port);
  const result = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  if (result.error || ![0, 1].includes(result.status) || result.stderr.trim()) throw new Error("lsof 无法可靠读取端口");
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
  if (foreignListeners(port, snapshot.group).length) throw new Error(`${label} 端口 ${port} 已被其它进程占用（本工具不停止他人进程）`);
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
    throw new Error("Docker 不可用：请先启动 Docker Desktop 或 dockerd 后重试（本工具不自动打开 GUI）");
}
// 同 project 的容器与卷：查询失败要报错，空 label 也要保留为“不符”。
function assertNoForeignProject(ctx) {
  for (const kind of ["container", "volume"]) {
    const args =
      kind === "container"
        ? ["ps", "-a", "--filter", `label=com.docker.compose.project=${ctx.project}`, "--format", '{{.Label "dev.stack.root"}}']
        : ["volume", "ls", "--filter", `label=com.docker.compose.project=${ctx.project}`, "--format", '{{.Label "dev.stack.root"}}'];
    const result = run("docker", args);
    if (result.status !== 0) throw new Error(`docker ${kind} 查询失败: ${result.stderr.trim() || `rc=${result.status}`}`);
    // 无资源时 docker 输出空串；有资源但缺 label 时输出空行——两种都不能被丢掉。
    const labels = result.stdout.split("\n");
    if (labels[labels.length - 1] === "") labels.pop();
    for (const label of labels)
      if (label !== ctx.root)
        throw new Error(`项目 ${ctx.project} 已有${kind === "container" ? "容器" : "卷"}归属 ${label || "(无 dev.stack.root 标签)"}，与本检出不符`);
  }
}
function postgresState(ctx, dbPort) {
  const result = compose(ctx, dbPort, ["ps", "--format", "json", "postgres"]);
  if (result.status !== 0) throw new Error(`docker compose ps 失败: ${result.stderr.trim() || `rc=${result.status}`}`);
  let listed;
  try {
    listed = JSON.parse(result.stdout.trim() || "[]");
  } catch {
    throw new Error("docker compose ps 返回了无法解析的 JSON");
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
// 只读本轮新增字节，避免重启时把历史里的失败当成这次失败。
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
// 就绪必须同时是“本组 RAGMain 在监听”，避免残留 helper 把旧响应算成自己的。
async function waitForJava(ctx, port, startedAt) {
  const deadline = Date.now() + JAVA_WAIT_MS;
  while (Date.now() < deadline) {
    const ready = await javaReady(port);
    const snapshot = identify(ctx);
    const rag = snapshot.group.filter((entry) => entry.role === "ragmain");
    if (ready && ownsPort(port, rag)) return;
    const helper = snapshot.group.filter((entry) => ["java-helper", "maven"].includes(entry.role));
    if (snapshot.unattributable.length) throw new Error("无法确认候选进程归属");
    if (!helper.length && !rag.length) throw new Error(`Java 入口已退出，未就绪；请查看 ${ctx.backendLog}`);
    if (startedAt !== undefined && existsSync(ctx.backendLog) && statSync(ctx.backendLog).size > startedAt) {
      if (/Application run failed/.test(readFrom(ctx.backendLog, startedAt)))
        throw new Error(`Java 启动失败（Application run failed）；请查看 ${ctx.backendLog}`);
    }
    await sleep(1000);
  }
  throw new Error(`Java 在 ${JAVA_WAIT_MS / 1000} 秒内未就绪；请查看 ${ctx.backendLog}`);
}
function requireAll(entries) {
  for (const [path, label] of entries) if (!existsSync(path)) throw new Error(`缺少 ${path}（${label}）`);
}
async function up(ctx) {
  const dbPort = integerLiteral(process.env.DB_PORT ?? "5432", "DB_PORT");
  const javaPort = resolveJavaPort(ctx);
  const mcpPort = resolveMcpPort(ctx);
  requireAll([[ctx.composeFile, "dev compose"], [ctx.javaEntry, "Java 入口"], [ctx.javaEnvFile, "Java .env"], [ctx.mcpScript, "MCP 脚本"]]);
  ensurePythonEnv(ctx.appDir, ctx.requirements);
  requireDocker();
  const pre = identify(ctx);
  if (pre.unattributable.length)
    throw new Error(`无法确认 ${pre.unattributable.length} 个本检出候选进程的归属（仍存活），拒绝继续: ${pre.unattributable.map((row) => row.pid).join(", ")}`);
  assertNoForeignProject(ctx);
  const frontend = pre.group.filter((entry) => FRONTEND_ROLES.includes(entry.role));
  if (frontend.length) throw new Error(`本检出的前端已在运行: ${frontend.map((entry) => entry.pid).join(", ")}`);

  const pg = postgresState(ctx, dbPort);
  const ownMcp = pre.group.filter((entry) => entry.role === "mcp");
  const ownJava = pre.group.filter((entry) => entry.role === "ragmain");
  assertNoForeign(mcpPort, { group: ownMcp }, "MCP");
  assertNoForeign(javaPort, { group: ownJava }, "Java");
  if (ownMcp.length && !ownsPort(mcpPort, ownMcp)) throw new Error("本检出 MCP 未监听配置端口");
  for (const [port, label] of [[3000, "Node"], [5173, "主网页"], [5174, "Manager"]]) assertNoForeign(port, { group: [] }, label);
  if (!pg || !pg.running || !pg.healthy || !pg.published) {
    if (pg && pg.running && pg.published) throw new Error(`PG 容器未 healthy（state=${pg.state}, health=${pg.health}），停止`);
    assertNoForeign(dbPort, pre, "PG");
    const started = compose(ctx, dbPort, ["up", "-d", "--wait", "--wait-timeout", "60"]);
    if (started.status !== 0) throw new Error(`PG 启动失败: ${started.stderr.trim() || started.stdout.trim()}`);
  } else process.stdout.write(`[dev] PG 已就绪（项目 ${ctx.project}）\n`);

  let snapshot = identify(ctx);
  const mcp = snapshot.group.filter((entry) => entry.role === "mcp");
  if (mcp.length && ownsPort(mcpPort, mcp)) process.stdout.write(`[dev] MCP 已运行\n`);
  else {
    if (mcp.length) throw new Error(`本检出 MCP 进程未监听 ${mcpPort}，拒绝复用与新起`);
    assertNoForeign(mcpPort, snapshot, "MCP");
    const child = await spawnDetached(ctx.venvPython, [ctx.mcpScript, "--host", "127.0.0.1", "--port", String(mcpPort)], ctx.devRoot, process.env, ctx.mcpLog);
    process.stdout.write(`[dev] 启动 MCP pid ${child.pid}（端口 ${mcpPort}，日志 ${ctx.mcpLog}）\n`);
    const ready = await waitForTcp(mcpPort, Date.now() + MCP_WAIT_MS);
    if (!ready || !ownsPort(mcpPort, identify(ctx).group.filter((entry) => entry.role === "mcp")))
      throw new Error(`MCP 未在 ${MCP_WAIT_MS / 1000} 秒内就绪或监听者不属于本组；请查看 ${ctx.mcpLog}`);
  }

  snapshot = identify(ctx);
  const java = snapshot.group.filter((entry) => ["java-helper", "maven", "ragmain"].includes(entry.role));
  if (java.length) await waitForJava(ctx, javaPort, undefined);
  else {
    assertNoForeign(javaPort, snapshot, "Java");
    mkdirSync(dirname(ctx.backendLog), { recursive: true });
    const startedAt = existsSync(ctx.backendLog) ? statSync(ctx.backendLog).size : 0;
    const child = await spawnDetached(process.execPath, [ctx.javaEntry], ctx.root, process.env, ctx.backendLog);
    process.stdout.write(`[dev] 启动 Java pid ${child.pid}（端口 ${javaPort}，日志 ${ctx.backendLog}）\n`);
    await waitForJava(ctx, javaPort, startedAt);
  }

  snapshot = identify(ctx);
  if (snapshot.unattributable.length) throw new Error("无法确认候选进程归属");
  if (snapshot.group.some((entry) => FRONTEND_ROLES.includes(entry.role))) throw new Error("本检出的前端已在运行");
  for (const [port, label] of [[3000, "Node"], [5173, "主网页"], [5174, "Manager"]]) assertNoForeign(port, { group: [] }, label);
  process.stdout.write(`[dev] 启动 Node 三进程（前台；Ctrl-C 只停本组，down 停整栈）\n`);
  // 直接以本检出 scripts/dev-command.mjs 为前台入口：不经过 pnpm.cmd，Windows 也没有 shell 解析问题。
  const child = spawn(process.execPath, [ctx.devCommand, "dev"], { cwd: ctx.root, env: { ...process.env, PORT: "3000" }, stdio: "inherit", shell: false });
  const release = holdForeground(child);
  child.once("error", (error) => {
    process.stderr.write(`[dev] 前端启动失败: ${error.message}\n`);
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
// Windows 没有可转发的优雅信号：同一 PowerShell 调用里对每个已确认 PID 先取并保留 Process 句柄，
// 再按 CreationDate 区分“已退出/已被复用”（可安全跳过）与“同一实例身份不可确认/停止失败”（必须报失败），
// 通过才 Kill 同一句柄。停止后重查本组，仍有本组进程在运行就失败，不因等待超时或漏快照而宣称成功。
async function stopGroupWindows(ctx, roles, label, notes, failures) {
  const before = identify(ctx);
  if (before.unattributable.length) failures.push(`无法确认候选进程归属: ${before.unattributable.map((row) => row.pid).join(", ")}`);
  const owned = before.group.filter((entry) => roles.includes(entry.role));
  if (!owned.length) {
    notes.push(`${label} 未在运行`);
    return;
  }
  let result;
  try {
    result = windowsStop(owned);
  } catch (error) {
    failures.push(`${label} 停止失败: ${error.message}`);
    return;
  }
  for (const pid of result.stopped) notes.push(`${label} pid ${pid} 已停止`);
  for (const pid of result.exited) notes.push(`${label} pid ${pid} 已先退出，未处理替代进程`);
  for (const pid of result.reused) notes.push(`${label} pid ${pid} 已被复用，未处理替代进程`);
  for (const pid of result.failed) failures.push(`${label} pid ${pid} 身份无法确认或停止失败`);
  const after = identify(ctx);
  if (after.unattributable.length) failures.push(`停止后仍有无法确认归属的本组候选: ${after.unattributable.map((row) => row.pid).join(", ")}`);
  const residual = after.group.filter((entry) => roles.includes(entry.role));
  if (residual.length) failures.push(`${label} 停止后仍有本组进程在运行: ${residual.map((entry) => entry.pid).join(", ")}`);
}
// 先 TERM；10 秒后仅对身份未变的存活者 KILL，并核实真的退出。
async function stopGroup(ctx, roles, label, notes, failures) {
  if (WINDOWS) return stopGroupWindows(ctx, roles, label, notes, failures);
  const initial = identify(ctx);
  if (initial.unattributable.length) failures.push(`无法确认候选进程归属: ${initial.unattributable.map((row) => row.pid).join(", ")}`);
  const owned = initial.group.filter((entry) => roles.includes(entry.role) && entry.cwd !== undefined);
  if (!owned.length) {
    notes.push(`${label} 未在运行`);
    return;
  }
  // TERM 前再取一次同一身份字段，避免把已退出或被复用的 PID 当本组。
  const current = identify(ctx);
  const taken = current.group;
  const stale = owned.filter((entry) => !taken.some((now) => now.pid === entry.pid && now.command === entry.command && now.cwd === entry.cwd && now.lstart === entry.lstart));
  for (const entry of stale) {
    const now = current.byPid.get(entry.pid);
    if (now && now.lstart === entry.lstart) failures.push(`${label} pid ${entry.pid} 归属变化，未发送信号`);
    else notes.push(`${label} 原 pid ${entry.pid} 已退出，未处理替代进程`);
  }
  const confirmed = owned.filter((entry) => !stale.includes(entry));
  if (!confirmed.length) return;
  if (run("kill", ["-TERM", ...confirmed.map((entry) => String(entry.pid))]).status !== 0) failures.push(`${label} TERM 命令失败`);
  const deadline = Date.now() + TERM_WAIT_MS;
  let survivors = confirmed;
  while (Date.now() < deadline) {
    survivors = confirmed.filter((entry) => isAlive(entry.pid));
    if (!survivors.length) {
      notes.push(`${label} 已停止`);
      return;
    }
    await sleep(500);
  }
  for (const entry of survivors) {
    const row = psSnapshot().find((candidate) => candidate.pid === entry.pid);
    if (!row) continue;
    if (row.lstart !== entry.lstart || row.command !== entry.command || lsofCwds([entry.pid]).get(entry.pid) !== entry.cwd) {
      if (row.lstart === entry.lstart) failures.push(`${label} pid ${entry.pid} 身份已变化，未补杀`);
      else notes.push(`${label} 原 pid ${entry.pid} 已退出，未处理替代进程`);
      continue;
    }
    if (run("kill", ["-KILL", String(entry.pid)]).status !== 0) { failures.push(`${label} pid ${entry.pid} 补杀失败`); continue; }
    const end = Date.now() + 2000;
    while (isAlive(entry.pid) && Date.now() < end) await sleep(100);
    if (isAlive(entry.pid)) failures.push(`${label} pid ${entry.pid} 仍未退出`);
    else notes.push(`${label} pid ${entry.pid} 超时未退出，已确认身份后补杀`);
  }
}
async function down(ctx) {
  const dbPort = integerLiteral(process.env.DB_PORT ?? "5432", "DB_PORT");
  const notes = [];
  const failures = [];
  for (const [label, roles] of [["前端", FRONTEND_ROLES], ["Java 入口", ["java-helper"]], ["Java 残留", ["maven", "ragmain"]], ["MCP", ["mcp"]]]) {
    try { await stopGroup(ctx, roles, label, notes, failures); }
    catch (error) { failures.push(`${label} 步骤未完成: ${error.message}`); }
  }
  try {
    requireDocker();
    assertNoForeignProject(ctx);
    const result = compose(ctx, dbPort, ["down"]);
    if (result.status !== 0) failures.push(`PG 停止失败: ${result.stderr.trim() || `rc=${result.status}`}`);
    else notes.push(`PG 已停止（项目 ${ctx.project}，卷保留）`);
  } catch (error) {
    failures.push(`PG 步骤未完成: ${error.message}`);
  }
  for (const note of notes) process.stdout.write(`[dev] ${note}\n`);
  if (failures.length) throw new Error(failures.join("；"));
}
function status(ctx) {
  const dbPort = integerLiteral(process.env.DB_PORT ?? "5432", "DB_PORT");
  const javaPort = resolveJavaPort(ctx);
  const mcpPort = resolveMcpPort(ctx);
  process.stdout.write(`[dev] 项目 ${ctx.project}\n[dev] 根 ${ctx.root}\n`);
  let pgOwned = false;
  try {
    requireDocker();
    assertNoForeignProject(ctx);
    const pg = postgresState(ctx, dbPort);
    pgOwned = Boolean(pg?.running && pg.published);
    process.stdout.write(`[dev] PG: ${pgOwned ? `${pg.state}/${pg.health} 端口${pg.published ? "已发布" : "未按本机端口发布"}` : "未运行"}\n`);
  } catch (error) {
    process.stdout.write(`[dev] PG 状态未知: ${error.message}\n`);
  }
  const snapshot = identify(ctx);
  if (snapshot.unattributable.length) throw new Error("有候选进程无法确认归属，状态不完整");
  for (const [role, label] of [["mcp", "MCP"], ["java-helper", "Java 入口"], ["maven", "Maven"], ["ragmain", "RAGMain"], ["frontend-root", "前端根"], ["frontend-child", "前端后代"]]) {
    const pids = snapshot.group.filter((entry) => entry.role === role).map((entry) => entry.pid);
    process.stdout.write(`[dev] ${label}: ${pids.join(", ") || "未运行"}\n`);
  }
  const ports = pgOwned ? [[mcpPort, "MCP"], [javaPort, "Java"], [3000, "Node"], [5173, "主网页"], [5174, "Manager"]] : [[dbPort, "PG"], [mcpPort, "MCP"], [javaPort, "Java"], [3000, "Node"], [5173, "主网页"], [5174, "Manager"]];
  for (const [port, label] of ports)
    if (foreignListeners(port, snapshot.group).length) process.stdout.write(`[dev] ${label} 端口 ${port} 被外部进程占用\n`);
}
const LOG_TAIL_LINES = 10;
const LOG_READ_BYTES = 64 * 1024;
// 文件身份带创建时间：同路径被重建且 inode 恰好复用时仍能判成新文件，避免 size>=offset 时漏开头。
const fileIdentity = (stats) => `${stats.dev}:${stats.ino}:${stats.birthtimeMs}`;
// 单次最多读 LOG_READ_BYTES，短读只输出 bytesRead 字节，不带 NUL。
function readAt(handle, offset, size) {
  const buffer = Buffer.alloc(Math.min(LOG_READ_BYTES, size - offset));
  const bytesRead = readSync(handle, buffer, 0, buffer.length, offset);
  return buffer.subarray(0, bytesRead);
}
// 用 Node 文件 API 替代 tail(1)：先输出最后 10 行，再按增长追加；按文件身份识别轮转/替换，
// 原地截断从 0 重读；单次缓冲有界；ENOENT 视为轮转中并等新文件，其它错误明确失败并清定时器/监听。
function logs(ctx) {
  const path = ctx.backendLog;
  if (!existsSync(path)) throw new Error(`日志不存在: ${path}`);
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
    process.stderr.write(`[dev] 日志跟随失败: ${error.message}\n`);
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
      if (error.code === "ENOENT") return; // 轮转中：等新文件出现
      fail(error);
      return;
    }
    try {
      if (handle === undefined || fileIdentity(current) !== identity) {
        if (handle !== undefined) closeSync(handle);
        handle = undefined; // 先作废旧 fd，openSync 失败时 stop 不会重复 close
        handle = openSync(path, "r");
        identity = fileIdentity(fstatSync(handle));
        offset = 0; // 路径上是新文件：从新内容开头读，不按旧 offset 跳过
      }
      if (fstatSync(handle).size < offset) offset = 0; // 原地截断
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
  if (!rootInput || !PRODUCT_COMMANDS.includes(command)) throw new Error("用法: scripts/dev-stack.mjs <产品根> [up|down|status|logs]");
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
