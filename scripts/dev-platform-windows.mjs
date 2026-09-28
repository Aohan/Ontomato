// Windows 侧的窄系统封装：用内置 PowerShell/CIM 取进程与监听、按已确认身份停止进程。
// 业务编排只有 scripts/dev-stack.mjs 一份；这里不复制编排，也不引入依赖、常驻服务或服务注册。
//
// Win32_Process 给出 ProcessId/ParentProcessId/CreationDate/ExecutablePath/CommandLine，没有可靠 cwd，
// 因此角色只按命令行里的本检出绝对入口判定，绝不伪造 cwd 复用 Unix 的 cwd 判断；命令行按 Windows
// 的引号/反斜杠规则解析（https://learn.microsoft.com/en-us/cpp/c-language/parsing-c-command-line-arguments）。
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// Windows 路径比较：大小写不敏感，/ 与 \ 等价，重复与末尾分隔符折叠；空格是路径内容而非分隔。
export function windowsPathKey(value) {
  return value.replaceAll("/", "\\").replace(/\\+/g, "\\").replace(/\\+$/, "").toLowerCase();
}
export function windowsPathEquals(a, b) {
  return a != null && b != null && windowsPathKey(a) === windowsPathKey(b);
}
function windowsPathWithin(path, root) {
  if (path == null || root == null) return false;
  const key = windowsPathKey(path);
  return key.startsWith(windowsPathKey(root) + "\\");
}
function windowsPathEndsWith(path, suffix) {
  return path != null && windowsPathKey(path).endsWith(windowsPathKey(suffix));
}
function windowsBaseName(value) {
  const normalized = value.replaceAll("/", "\\");
  return normalized.slice(normalized.lastIndexOf("\\") + 1).toLowerCase();
}

// 官方规则：反斜杠按 2n/2n+1 处理（偶数个+引号 = n 个反斜杠 + 引用段切换，奇数个+引号 = n 个
// 反斜杠 + 字面引号）；引用段内的连续两个引号是字面引号；引用段内的空白是参数内容。
export function parseWindowsCommandLine(line) {
  const argv = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
    if (i >= line.length) break;
    let arg = "";
    let quoted = false;
    while (i < line.length && (quoted || (line[i] !== " " && line[i] !== "\t"))) {
      if (line[i] === "\\") {
        let slashes = 0;
        while (i < line.length && line[i] === "\\") { i++; slashes++; }
        if (i < line.length && line[i] === '"') {
          arg += "\\".repeat(slashes >> 1);
          if (slashes & 1) arg += '"';
          else quoted = !quoted;
          i++;
        } else arg += "\\".repeat(slashes);
      } else if (line[i] === '"') {
        if (quoted && line[i + 1] === '"') { arg += '"'; i += 2; }
        else { quoted = !quoted; i++; }
      } else {
        arg += line[i];
        i++;
      }
    }
    argv.push(arg);
  }
  return argv;
}

// Java 启动参数里主类的位置规则：跳过 -cp/-classpath 的值和所有以 - 开头的选项，第一个裸 token
// 才是主类；-jar 形式没有主类参数，未知形式一律不认领。这样业务参数里出现 RAGMain 不会被当成主类。
export function javaMainClass(argv) {
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-cp" || arg === "-classpath" || arg === "--class-path") { i++; continue; }
    if (arg === "-jar") return undefined;
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return undefined;
}

// tsx 的实际工作进程是 `node --require <tsx>/preflight.cjs --import file://<tsx>/loader.mjs <script>`；
// watcher 退出后它会带着绝对入口遗留，所以要单独认领，同时排除 node -e/--eval 与普通诊断。
function isTsxWorker(argv, script) {
  if (!["--require", "--import", "--loader", "-r"].includes(argv[1])) return false;
  if (argv.includes("-e") || argv.includes("--eval")) return false;
  if (!windowsPathEquals(argv[argv.length - 1], script)) return false;
  return argv.some((arg) => windowsPathKey(arg).includes("\\tsx\\"));
}

const DEVELOP_MODES = ["dev", "server", "web", "manager"];
const CONCURRENT_MODES = ["pnpm:dev:server", "pnpm:dev:web", "pnpm:dev:ontology-manager"];

function flagValue(argv, flag) {
  const at = argv.indexOf(flag);
  return at < 0 ? undefined : argv[at + 1];
}
// 只有完整一段 classpath 里的本检出 .dev/conf 才算 RAGMain，避免 -cp 前缀碰撞和文本提及。
function classpathHasDir(argv, dir) {
  const value = flagValue(argv, "-cp") ?? flagValue(argv, "-classpath");
  return value !== undefined && value.split(";").some((entry) => windowsPathEquals(entry, dir));
}
function mavenProjectRoot(argv) {
  const flag = "-Dmaven.multiModuleProjectDirectory=";
  const found = argv.find((arg) => arg.startsWith(flag));
  return found === undefined ? undefined : found.slice(flag.length);
}

// 严格 argv 绑定：入口/Maven project 根/Java conf classpath/Python 可执行与脚本都必须落在本检出，
// 把路径当文本携带的诊断命令不会被认领。
export function classifyWindows(row, ctx) {
  const argv = parseWindowsCommandLine(row.command ?? "");
  if (argv.length === 0) return undefined;
  const exe = windowsBaseName(row.exe ?? argv[0]);
  const workbench = join(ctx.root, "apps/workbench");
  const manager = join(ctx.root, "apps/ontology-manager");
  if (exe === "node.exe") {
    if (windowsPathEquals(argv[1], ctx.devCommand) && DEVELOP_MODES.includes(argv[2])) return "frontend-root";
    if (windowsPathEquals(argv[1], ctx.javaEntry)) return "java-helper";
    if (windowsPathWithin(argv[1], ctx.root) && windowsPathEndsWith(argv[1], "/concurrently/dist/bin/concurrently.js") &&
        CONCURRENT_MODES.every((mode) => argv.includes(mode))) return "frontend-root";
    if (windowsPathEndsWith(argv[1], "/tsx/dist/cli.mjs") && argv[2] === "watch" &&
        windowsPathEquals(argv[3], join(workbench, "src/index.ts"))) return "frontend-root";
    if (isTsxWorker(argv, join(workbench, "src/index.ts"))) return "frontend-root";
    if (windowsPathEndsWith(argv[1], "/vite/bin/vite.js")) {
      if (windowsPathEquals(flagValue(argv, "--config"), join(workbench, "web/vite.config.ts"))) return "frontend-root";
      if (windowsPathEquals(argv[2], manager) && flagValue(argv, "--port") === "5174") return "frontend-root";
    }
    if (windowsPathEndsWith(argv[1], "/scripts/dev-stack.mjs")) return "self";
    return undefined;
  }
  if (exe === "java.exe") {
    if (javaMainClass(argv) === "io.ontomato.dataengine.RAGMain" && classpathHasDir(argv, join(ctx.devRoot, "conf"))) return "ragmain";
    if (javaMainClass(argv) === "org.codehaus.plexus.classworlds.launcher.Launcher" && argv.includes("spring-boot:run") &&
        windowsPathEquals(mavenProjectRoot(argv), ctx.root)) return "maven";
    return undefined;
  }
  // venv 的 Scripts/python.exe 由官方 launcher 启动，必须核对真实 ExecutablePath = 本检出 venv；
  // 不拿 argv[0] 当真实 exe 的替代身份。真正的 MCP 监听者可能是它启动的 base Python 子进程，
  // 那条边在 identifyWindows 里按父子启动身份补认。
  if (exe === "python.exe" && windowsPathEquals(row.exe, ctx.venvPython) &&
      windowsPathEquals(argv[1], ctx.mcpScript)) return "mcp";
  return undefined;
}

// 一行一次进程快照：角色来自 classifyWindows，前端后代只沿 CreationDate 不早于父进程的边扩展，
// 这样 ppid 指向被复用的旧 PID 时不会把无关进程并进本组。取不到 CreationDate/CommandLine 的
// 本检出候选（含已确认前端根的后代）进入 unattributable，由调用方拒绝复用或停止，绝不静默丢弃。
export function identifyWindows(rows, ctx, self = process.pid) {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const classified = new Map();
  const unattributable = [];
  const reported = new Set();
  const report = (row, role) => {
    if (reported.has(row.pid)) return;
    reported.add(row.pid);
    unattributable.push({ ...row, role });
  };
  for (const row of rows) {
    if (row.pid === self) continue;
    const role = classifyWindows(row, ctx);
    if (role === undefined || role === "self") continue;
    if (row.created == null || row.command == null) report(row, role);
    else classified.set(row.pid, { pid: row.pid, ppid: row.ppid, lstart: String(row.created), command: row.command, role });
  }
  // Windows 的 venv launcher 会 CreateProcess 启动 base Python 并等它退出（CPython PC/venvlauncher.c），
  // 监听端口的是那个子进程。公共/企业共用同一个 mcp 脚本，不能只按“任意 python + 共享脚本”认领；
  // 只把已确认 venv launcher 的直接子进程（CreationDate 不早于父，防复用）且 argv 含同一 mcp 脚本的
  // 归入 mcp；子进程的 argv[0] 即使仍是 venv 路径也不当作真实 exe 身份。
  for (const row of rows) {
    const parent = classified.get(row.ppid);
    if (!parent || parent.role !== "mcp" || classified.has(row.pid)) continue;
    if (!windowsPathEquals(byPid.get(row.ppid).exe, ctx.venvPython)) continue;
    if (row.created == null || row.command == null) { report(row, "mcp"); continue; }
    if (BigInt(row.created) < BigInt(parent.lstart)) continue;
    if (row.exe == null) { report(row, "mcp"); continue; }
    if (windowsBaseName(row.exe) !== "python.exe" ||
        !windowsPathEquals(parseWindowsCommandLine(row.command)[1], ctx.mcpScript)) continue;
    classified.set(row.pid, { pid: row.pid, ppid: row.ppid, lstart: String(row.created), command: row.command, role: "mcp" });
  }
  const members = new Set([...classified.values()].filter((entry) => entry.role === "frontend-root").map((entry) => entry.pid));
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) {
      if (members.has(row.pid) || !members.has(row.ppid)) continue;
      if (row.created == null || row.command == null) { report(row, "frontend-child"); continue; }
      const parent = byPid.get(row.ppid);
      if (!parent || parent.created == null || BigInt(row.created) < BigInt(parent.created)) continue;
      members.add(row.pid);
      grew = true;
    }
  }
  for (const pid of classified.keys()) members.add(pid);
  const group = [...members].map((pid) => classified.get(pid) ?? { ...byPid.get(pid), lstart: String(byPid.get(pid).created), role: "frontend-child" });
  return { group, unattributable, byPid };
}

// 脚本经 -EncodedCommand(UTF-16LE base64) 传入，参数只走环境变量的结构化/base64 数据，
// 不把 root/path/commandline 拼进可执行 PS 源码；no-profile/noninteractive，不放宽执行策略。
function runPowerShell(script, extraEnv = {}, timeout = 30000) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { encoding: "utf8", env: { ...process.env, ...extraEnv }, timeout, maxBuffer: 64 * 1024 * 1024 },
  );
}
function powershellJson(script, extraEnv = {}, timeout = 30000) {
  const result = runPowerShell(script, extraEnv, timeout);
  if (result.error || result.status !== 0)
    throw new Error(`PowerShell 调用失败: ${(result.stderr ?? "").trim() || result.error?.message || `rc=${result.status}`}`);
  try {
    return JSON.parse(result.stdout.replace(/^\uFEFF/, "").trim());
  } catch {
    throw new Error("PowerShell 返回了无法解析的 JSON");
  }
}
function jsonArray(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

// Windows PowerShell 5.1 的控制台输出编码不等于 spawnSync 的 encoding:utf8；不集中设置，
// 含中文的路径会按本地代码页写出而被误解析。用无 BOM 的 UTF8（Node 侧再去掉可能的 BOM）。
const PS_HEADER = [
  "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false",
  "$OutputEncoding = [Console]::OutputEncoding",
  "$ErrorActionPreference = 'Stop'",
].join("\n") + "\n";

const PROCESS_SNAPSHOT = PS_HEADER + `
$rows = Get-CimInstance Win32_Process | ForEach-Object {
  $created = $null
  if ($_.CreationDate) { $created = [string]$_.CreationDate.ToFileTimeUtc() }
  [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; created = $created; exe = $_.ExecutablePath; command = $_.CommandLine }
}
[Console]::Out.Write((ConvertTo-Json -Compress -Depth 3 -InputObject @($rows)))
`;
export function windowsProcesses() {
  return jsonArray(powershellJson(PROCESS_SNAPSHOT));
}

// -LocalPort 在无匹配时会报 NoMatchingMSFT_NetTCPConnectionObjectsFound，不能当成空监听；
// 这里先无过滤地查成功，再在内存里筛 Listen + 端口，只有筛空才是真正的无监听。
const LISTENERS = PS_HEADER + `
$port = [int]$env:DEV_STACK_WIN_PORT
$pids = @(Get-NetTCPConnection -ErrorAction Stop |
  Where-Object { $_.State -eq 'Listen' -and $_.LocalPort -eq $port } |
  Select-Object -ExpandProperty OwningProcess -Unique)
[Console]::Out.Write((ConvertTo-Json -Compress -InputObject @($pids)))
`;
export function windowsListeningPids(port) {
  return jsonArray(powershellJson(LISTENERS, { DEV_STACK_WIN_PORT: String(port) })).map(Number);
}

// 只停止调用方已确认的本组 PID：同一 PS 调用里先取 Process 句柄并保留，再用 CreationDate 判断
// 是否已被复用、用 CommandLine 判断同一实例信息是否一致，通过才对同一句柄 Kill；不 taskkill /IM，
// 不按名字/端口，也不递归杀未知后代。exited/reused 可安全跳过，failed 表示无法确认或停止失败。
const STOP = PS_HEADER + `
$targets = @([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:DEV_STACK_WIN_TARGETS)) | ConvertFrom-Json)
$stopped = @(); $exited = @(); $reused = @(); $failed = @()
foreach ($target in $targets) {
  $id = [int]$target.pid
  $process = $null
  try {
    try { $process = Get-Process -Id $id -ErrorAction Stop } catch {
      if ($_.FullyQualifiedErrorId -like 'NoProcessFoundForGivenId*') { $exited += $id }
      else { $failed += $id }
      continue
    }
    try { $null = $process.Handle } catch {
      $gone = $false
      try { $gone = $process.HasExited } catch { $gone = $false }
      if ($gone) { $exited += $id } else { $failed += $id }
      continue
    }
    $current = $null
    try { $current = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction Stop } catch { $failed += $id; continue }
    if (-not $current) { $exited += $id; continue }
    if (-not $current.CreationDate) { $failed += $id; continue }
    if ([string]$current.CreationDate.ToFileTimeUtc() -ne [string]$target.created) { $reused += $id; continue }
    if ($current.CommandLine -cne $target.command) { $failed += $id; continue }
    try {
      $process.Kill()
      if ($process.WaitForExit(5000)) { $stopped += $id } else { $failed += $id }
    } catch { $failed += $id }
  } finally {
    if ($process) { $process.Dispose() }
  }
}
[Console]::Out.Write((ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ stopped = @($stopped); exited = @($exited); reused = @($reused); failed = @($failed) })))
`;
export function windowsStop(entries) {
  const targets = entries.map((entry) => ({ pid: entry.pid, created: entry.lstart, command: entry.command }));
  const result = powershellJson(STOP, { DEV_STACK_WIN_TARGETS: Buffer.from(JSON.stringify(targets), "utf8").toString("base64") }, 60000);
  return { stopped: jsonArray(result.stopped), exited: jsonArray(result.exited), reused: jsonArray(result.reused), failed: jsonArray(result.failed) };
}
