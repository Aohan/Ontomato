// Narrow Windows system encapsulation: use built-in PowerShell/CIM to query processes and listeners,
// and stop processes by confirmed identity.
// Business orchestration lives solely in scripts/dev-stack.mjs; do not duplicate orchestration here,
// nor introduce dependencies, background daemons, or service registries.
//
// Win32_Process provides ProcessId/ParentProcessId/CreationDate/ExecutablePath/CommandLine, but no reliable cwd.
// Roles are determined only by the absolute entry paths of this checkout in the command line, never faking cwd
// to reuse Unix cwd logic; command lines are parsed per Windows quoting/escaping rules
// (https://learn.microsoft.com/en-us/cpp/c-language/parsing-c-command-line-arguments).
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// Windows path comparison: case-insensitive, / and \ equivalent, duplicate and trailing separators collapsed; spaces are path content, not delimiters.
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

// Official rules: backslashes follow 2n/2n+1 rules (even backslashes + quote = n backslashes + toggle quoting, odd backslashes + quote = n backslashes + literal quote); consecutive double quotes inside quoted segments are literal quotes; whitespace inside quotes is argument content.
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

// Java main class position rules: skip -cp/-classpath value and all options starting with -, first bare token is the main class; -jar forms have no main class argument, unknown forms are not claimed. This prevents RAGMain in business arguments from being mistaken for the main class.
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

// tsx worker process is `node --require <tsx>/preflight.cjs --import file://<tsx>/loader.mjs <script>`;
// after watcher exits it leaves behind absolute entry point, so claim it separately, while excluding node -e/--eval and general diagnostics.
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
// Only an exact classpath entry matching this checkout's .dev/conf counts as RAGMain, preventing -cp prefix collisions or textual mentions.
function classpathHasDir(argv, dir) {
  const value = flagValue(argv, "-cp") ?? flagValue(argv, "-classpath");
  return value !== undefined && value.split(";").some((entry) => windowsPathEquals(entry, dir));
}
function mavenProjectRoot(argv) {
  const flag = "-Dmaven.multiModuleProjectDirectory=";
  const found = argv.find((arg) => arg.startsWith(flag));
  return found === undefined ? undefined : found.slice(flag.length);
}

// Strict argv binding: entry point / Maven project root / Java conf classpath / Python executable and script must fall within this checkout;
// diagnostic commands carrying paths as text will not be claimed.
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
  // The venv Scripts/python.exe is started by official launcher, so verify true ExecutablePath = this checkout's venv;
  // do not treat argv[0] as a substitute for true exe identity. The actual MCP listener might be a base Python child process,
  // which will be claimed in identifyWindows based on parent-child launch identity.
  if (exe === "python.exe" && windowsPathEquals(row.exe, ctx.venvPython) &&
      windowsPathEquals(argv[1], ctx.mcpScript)) return "mcp";
  return undefined;
}

// Single-pass process snapshot: roles come from classifyWindows; frontend descendants only expand along edges where CreationDate is not earlier than parent,
// so that when ppid points to a reused old PID, unrelated processes won't be merged into this group.
// Candidates in this checkout (including descendants of confirmed frontend roots) that fail to yield CreationDate/CommandLine go to unattributable,
// and callers reject reuse or stop without silently dropping them.
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
  // Windows venv launcher calls CreateProcess to start base Python and waits for it to exit (CPython PC/venvlauncher.c);
  // the listening port belongs to that child process. Public and enterprise share the same mcp script, so we cannot claim by "any python + shared script";
  // only direct children of a confirmed venv launcher (CreationDate not earlier than parent, preventing reuse) whose argv contains the same mcp script
  // are classified as mcp; even if the child's argv[0] is still the venv path, it is not used as the true exe identity.
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

// Script is passed via -EncodedCommand (UTF-16LE base64); parameters only use structured/base64 data in environment variables,
// avoiding concatenation of root/path/commandline into executable PS source; no-profile/noninteractive, without relaxing execution policies.
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
    throw new Error(`PowerShell invocation failed: ${(result.stderr ?? "").trim() || result.error?.message || `rc=${result.status}`}`);
  try {
    return JSON.parse(result.stdout.replace(/^\uFEFF/, "").trim());
  } catch {
    throw new Error("PowerShell returned unparseable JSON");
  }
}
function jsonArray(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

// Windows PowerShell 5.1 console output encoding does not equal spawnSync encoding:utf8; without explicit setup,
// paths containing non-ASCII characters may be written using local code pages and misparsed. Use UTF8 without BOM (Node side strips any BOM).
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

// -LocalPort returns NoMatchingMSFT_NetTCPConnectionObjectsFound when there is no match, which cannot be treated as empty listening;
// query without filter first, then filter Listen + port in memory; only an empty filter result is truly no listening.
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

// Only stop confirmed PIDs in this group: within the same PS invocation, acquire and hold Process handle, then verify with CreationDate
// that it has not been reused and CommandLine matches identical instance information before calling Kill on that handle;
// no taskkill /IM, no kill by name/port, and no recursive killing of unknown descendants.
// exited/reused can be safely skipped; failed indicates unconfirmed identity or stop failure.
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
