import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { test } from "node:test";
import {
  classifyWindows,
  identifyWindows,
  javaMainClass,
  parseWindowsCommandLine,
  windowsListeningPids,
  windowsPathEquals,
  windowsPathKey,
  windowsProcesses,
  windowsStop,
} from "./dev-platform-windows.mjs";

const NODE = "C:\\nodejs\\node.exe";
const JAVA = "C:\\Java\\bin\\java.exe";
const BASE_PYTHON = "C:\\Python313\\python.exe";
const CTX = {
  root: "C:\\My Repo\\ontomato",
  devRoot: "C:\\My Repo\\ontomato\\apps\\data-engine\\.dev",
  venvPython: "C:\\My Repo\\ontomato\\apps\\data-engine\\.venv\\Scripts\\python.exe",
  mcpScript: "C:\\My Repo\\ontomato\\packages\\data-engine-core\\mcp\\mcpserver.py",
  javaEntry: "C:\\My Repo\\ontomato\\apps\\data-engine\\dev.mjs",
  devCommand: "C:\\My Repo\\ontomato\\scripts\\dev-command.mjs",
};
const row = (command, exe = NODE, extra = {}) => ({ pid: 1, ppid: 1, created: "133000000000000000", exe, command, ...extra });
const role = (command, exe) => classifyWindows(row(command, exe), CTX);

test("parseWindowsCommandLine follows the documented quote and backslash rules", () => {
  assert.deepEqual(parseWindowsCommandLine('"C:\\Program Files\\nodejs\\node.exe" "C:\\a b\\dev.mjs" dev'),
    ["C:\\Program Files\\nodejs\\node.exe", "C:\\a b\\dev.mjs", "dev"]);
  // 2n 个反斜杠 + 引号：n 个反斜杠并切换引用段；转义方必须把结尾反斜杠写成两个。
  assert.deepEqual(parseWindowsCommandLine('"C:\\dir\\\\" x'), ["C:\\dir\\", "x"]);
  // 2n+1 个反斜杠 + 引号：n 个反斜杠 + 字面引号，引用段继续。
  assert.deepEqual(parseWindowsCommandLine('a\\"b'), ['a"b']);
  // 引用段内连续两个引号是字面引号；引用段外的两个引号只是进出引用段。
  assert.deepEqual(parseWindowsCommandLine('"a""b" x'), ['a"b', "x"]);
  assert.deepEqual(parseWindowsCommandLine('a""b'), ["ab"]);
  assert.deepEqual(parseWindowsCommandLine("a\tb  c"), ["a", "b", "c"]);
  assert.deepEqual(parseWindowsCommandLine("   "), []);
});

test("windowsPathKey folds case and separators but keeps spaces and path boundaries", () => {
  assert.equal(windowsPathEquals("C:\\My Repo\\apps\\data-engine\\dev.mjs", "c:/my repo/apps/data-engine/dev.mjs"), true);
  assert.equal(windowsPathEquals("C:\\repo\\\\dev.mjs", "C:/repo/dev.mjs"), true);
  assert.equal(windowsPathEquals("C:\\repo-2\\dev.mjs", "C:\\repo\\dev.mjs"), false);
  assert.equal(windowsPathEquals(undefined, "C:\\repo"), false);
  assert.equal(windowsPathKey("C:\\A\\B"), "c:\\a\\b");
});

test("frontend root, java helper and self bind to this checkout's absolute entry", () => {
  assert.equal(role(`"${NODE}" "${CTX.devCommand}" dev`), "frontend-root");
  assert.equal(role(`"${NODE}" "${CTX.devCommand}" web`), "frontend-root");
  assert.equal(role(`"${NODE}" "${CTX.devCommand}" manager`), "frontend-root");
  assert.equal(role(`"${NODE}" "${CTX.devCommand}" unknown`), undefined);
  assert.equal(role(`"${NODE}" "C:\\other\\scripts\\dev-command.mjs" dev`), undefined);
  assert.equal(role(`"${NODE}" "${CTX.javaEntry}"`), "java-helper");
  assert.equal(role(`"${NODE}" "${CTX.devCommand.replace("dev-command", "dev-stack")}" . up`), "self");
  assert.equal(role(`"${NODE}" -e "x=${CTX.devCommand}"`), undefined);
});

test("MCP binds the real venv ExecutablePath and the shared script, never argv[0] as the exe", () => {
  const python = `"${CTX.venvPython}" "${CTX.mcpScript}" --host 127.0.0.1 --port 18500`;
  assert.equal(role(python, CTX.venvPython), "mcp");
  // ExecutablePath 读不到时不能用 argv[0] 当真实 exe 的替代身份。
  assert.equal(role(python, null), undefined);
  // 命令行保留 venv argv[0]、真实 exe 已是 base Python：单独不认领，只靠 launcher 父子边补认。
  assert.equal(role(python, BASE_PYTHON), undefined);
  assert.equal(role(`"C:\\other\\python.exe" "${CTX.mcpScript}" --port 18500`, "C:\\other\\python.exe"), undefined);
  assert.equal(role(`"${CTX.venvPython}" "C:\\other\\mcpserver.py" --port 18500`, CTX.venvPython), undefined);
  // 把路径当文本携带的诊断/复盘命令不是本产品进程。
  assert.equal(role(`"${NODE}" -e "print('${python}')"`), undefined);
});

test("the venv launcher's base-Python child is claimed only through the confirmed parent edge", () => {
  const launcher = row(`"${CTX.venvPython}" "${CTX.mcpScript}" --port 18500`, CTX.venvPython, { pid: 10, ppid: 1, created: "100" });
  const child = (command, extra = {}) => row(command, BASE_PYTHON, { pid: 11, ppid: 10, created: "200", ...extra });
  const roles = (rows) => identifyWindows(rows, CTX, -1).group.map((entry) => [entry.pid, entry.role]);
  // 官方 venvlauncher 用 CreateProcess 启动 base Python 并等它退出，监听者是那个子进程；argv[0] 可能仍是 venv 路径。
  assert.deepEqual(roles([launcher, child(`"${CTX.venvPython}" "${CTX.mcpScript}" --port 18500`)]), [[10, "mcp"], [11, "mcp"]]);
  assert.deepEqual(roles([launcher, child(`"${BASE_PYTHON}" "${CTX.mcpScript}" --port 18500`)]), [[10, "mcp"], [11, "mcp"]]);
  // 公共/企业共用同一 mcp 脚本：没有本组 launcher 父边的其它产品 Python 不认领。
  assert.deepEqual(roles([child(`"${BASE_PYTHON}" "${CTX.mcpScript}" --port 18500`, { pid: 20, ppid: 1 })]), []);
  // 子进程跑别的脚本、CreationDate 早于父（父 PID 被复用）都不并组。
  assert.deepEqual(roles([launcher, child(`"${BASE_PYTHON}" "C:\\other\\script.py"`)]), [[10, "mcp"]]);
  assert.deepEqual(roles([launcher, child(`"${BASE_PYTHON}" -c "print('diagnostic')" "${CTX.mcpScript}"`)]), [[10, "mcp"]]);
  assert.deepEqual(roles([launcher, { ...child(`"${NODE}" "${CTX.mcpScript}"`), exe: NODE }]), [[10, "mcp"]]);
  assert.deepEqual(roles([{ ...launcher, created: "300" }, child(`"${BASE_PYTHON}" "${CTX.mcpScript}"`)]), [[10, "mcp"]]);
  // 子进程取不到 CreationDate 时上报，不静默丢弃。
  assert.deepEqual(identifyWindows([launcher, child(`"${BASE_PYTHON}" "${CTX.mcpScript}"`, { created: null })], CTX, -1)
    .unattributable.map((entry) => entry.pid), [11]);
});

test("Java roles use the launcher's main-class position, not any argv mention", () => {
  const classpath = `${CTX.devRoot}\\conf;C:\\deps\\x.jar`;
  const maven = `"${JAVA}" -Dmaven.multiModuleProjectDirectory="${CTX.root}" -cp "C:\\m2\\boot.jar" org.codehaus.plexus.classworlds.launcher.Launcher spring-boot:run`;
  assert.equal(role(maven, JAVA), "maven");
  assert.equal(role(`"${JAVA}" -Dmaven.multiModuleProjectDirectory="${CTX.root}" org.codehaus.plexus.classworlds.launcher.Launcher spring-boot:run`, JAVA), "maven");
  assert.equal(role(`"${JAVA}" -Dmaven.multiModuleProjectDirectory=C:\\other org.codehaus.plexus.classworlds.launcher.Launcher spring-boot:run`, JAVA), undefined);
  assert.equal(role(`"${JAVA}" -Dmaven.multiModuleProjectDirectory="${CTX.root}" spring-boot:run`, JAVA), undefined);
  // 业务参数里出现 Launcher/RAGMain 不算主类。
  assert.equal(role(`"${JAVA}" -Dmaven.multiModuleProjectDirectory="${CTX.root}" -cp x OtherMain org.codehaus.plexus.classworlds.launcher.Launcher spring-boot:run`, JAVA), undefined);
  const rag = `"${JAVA}" -cp "${classpath}" io.ontomato.dataengine.RAGMain`;
  assert.equal(role(rag, JAVA), "ragmain");
  assert.equal(role(`"${JAVA}" -cp "${classpath}" OtherMain io.ontomato.dataengine.RAGMain`, JAVA), undefined);
  assert.equal(role(`"${JAVA}" -classpath "C:\\other\\conf;C:\\deps\\x.jar" io.ontomato.dataengine.RAGMain`, JAVA), undefined);
  assert.equal(role(`"${JAVA}" -cp "${CTX.devRoot}-other\\conf;x.jar" io.ontomato.dataengine.RAGMain`, JAVA), undefined);
  assert.equal(role(`"${JAVA}" -cp "${CTX.devRoot}\\conf;x.jar" io.ontomato.dataengine.OtherMain`, JAVA), undefined);
  // -jar 形式没有主类参数，未知形式不认领。
  assert.equal(role(`"${JAVA}" -jar "${CTX.devRoot}\\conf\\app.jar" io.ontomato.dataengine.RAGMain`, JAVA), undefined);
});

test("javaMainClass reads the position, skipping option values", () => {
  assert.equal(javaMainClass(["java", "-cp", "a;b", "io.ontomato.dataengine.RAGMain"]), "io.ontomato.dataengine.RAGMain");
  assert.equal(javaMainClass(["java", "-Dk=v", "-Xmx1g", "org.codehaus.plexus.classworlds.launcher.Launcher", "spring-boot:run"]), "org.codehaus.plexus.classworlds.launcher.Launcher");
  assert.equal(javaMainClass(["java", "-classpath", "a", "OtherMain", "io.ontomato.dataengine.RAGMain"]), "OtherMain");
  assert.equal(javaMainClass(["java", "-jar", "app.jar", "io.ontomato.dataengine.RAGMain"]), undefined);
  assert.equal(javaMainClass(["java"]), undefined);
});

test("concurrently, tsx and the two vite entries bind their absolute paths only", () => {
  const workbench = `${CTX.root}\\apps\\workbench`;
  assert.equal(role(`"${NODE}" "${CTX.root}\\node_modules\\concurrently\\dist\\bin\\concurrently.js" pnpm:dev:server pnpm:dev:web pnpm:dev:ontology-manager`), "frontend-root");
  assert.equal(role(`"${NODE}" "${CTX.root}\\node_modules\\concurrently\\dist\\bin\\concurrently.js" pnpm:dev:server`), undefined);
  assert.equal(role(`"${NODE}" "C:\\other\\node_modules\\concurrently\\dist\\bin\\concurrently.js" pnpm:dev:server pnpm:dev:web pnpm:dev:ontology-manager`), undefined);
  assert.equal(role(`"${NODE}" "${workbench}\\node_modules\\tsx\\dist\\cli.mjs" watch "${workbench}\\src\\index.ts"`), "frontend-root");
  assert.equal(role(`"${NODE}" "${workbench}\\node_modules\\tsx\\dist\\cli.mjs" watch "C:\\other\\src\\index.ts"`), undefined);
  // watcher 退出后可能遗留的实际工作进程（tsx run 的 --require/--import 形式）。
  const worker = `"${NODE}" --require "${workbench}\\node_modules\\tsx\\dist\\preflight.cjs" --import "file:///${workbench}/node_modules/tsx/dist/loader.mjs"`;
  assert.equal(role(`${worker} "${workbench}\\src\\index.ts"`), "frontend-root");
  assert.equal(role(`${worker} "C:\\other\\src\\index.ts"`), undefined);
  assert.equal(role(`"${NODE}" -e "x=${workbench}\\src\\index.ts"`), undefined);
  assert.equal(role(`"${NODE}" "${CTX.root}\\node_modules\\vite\\bin\\vite.js" --config "${workbench}\\web\\vite.config.ts"`), "frontend-root");
  assert.equal(role(`"${NODE}" "${CTX.root}\\node_modules\\vite\\bin\\vite.js" --config "C:\\other\\web\\vite.config.ts"`), undefined);
  assert.equal(role(`"${NODE}" "${CTX.root}\\node_modules\\vite\\bin\\vite.js" "${CTX.root}\\apps\\ontology-manager" --port 5174`), "frontend-root");
  assert.equal(role(`"${NODE}" "${CTX.root}\\node_modules\\vite\\bin\\vite.js" "C:\\other\\apps\\ontology-manager" --port 5174`), undefined);
  assert.equal(role(`"${NODE}" "${CTX.root}\\node_modules\\vite\\bin\\vite.js" "${CTX.root}\\apps\\ontology-manager" --port 5175`), undefined);
  assert.equal(role(`"${NODE}" "${CTX.root}\\node_modules\\vitest\\vitest.mjs" run`), undefined);
});

test("identifyWindows groups the root's descendants but rejects reused parent PIDs and unread fields", () => {
  const rows = [
    row(`"${NODE}" "${CTX.devCommand}" dev`, NODE, { pid: 10, ppid: 1, created: "100" }),
    row("cmd.exe /d /s /c \"pnpm run dev:server\"", "C:\\Windows\\System32\\cmd.exe", { pid: 11, ppid: 10, created: "200" }),
    // ppid 指向本组根，但 CreationDate 早于父进程：旧 PID 被复用，不得并进本组。
    row("cmd.exe /d /s /c \"unrelated\"", "C:\\Windows\\System32\\cmd.exe", { pid: 12, ppid: 10, created: "50" }),
    row(`"${CTX.venvPython}" "${CTX.mcpScript}" --port 18500`, CTX.venvPython, { pid: 20, ppid: 1, created: "150" }),
    row(`"${NODE}" "${CTX.devCommand}" server`, NODE, { pid: 30, ppid: 1, created: null }),
    row(`"C:\\other\\node.exe" "C:\\other\\scripts\\dev-command.mjs" dev`, "C:\\other\\node.exe", { pid: 40, ppid: 1, created: "150" }),
  ];
  const snapshot = identifyWindows(rows, CTX, -1);
  assert.deepEqual(snapshot.group.map((entry) => [entry.pid, entry.role]).sort((a, b) => a[0] - b[0]),
    [[10, "frontend-root"], [11, "frontend-child"], [20, "mcp"]]);
  assert.equal(snapshot.group.find((entry) => entry.pid === 11).lstart, "200");
  // 取不到 CreationDate 的本检出候选单独报出，交由调用方拒绝复用/停止。
  assert.deepEqual(snapshot.unattributable.map((entry) => entry.pid), [30]);
});

test("identifyWindows never claims the inspecting process itself", () => {
  const rows = [row(`"${NODE}" "${CTX.root}\\scripts\\dev-stack.mjs" . up`, NODE, { pid: 99, ppid: 1 })];
  assert.deepEqual(identifyWindows(rows, CTX, 99).group, []);
  assert.deepEqual(identifyWindows(rows, CTX, 99).unattributable, []);
});

// 以下 Windows-only 黑盒在 macOS 上明确 skip，不能替代实机。实机还需验证：两个产品根的
// pnpm dev:up/dev:down/dev:status/dev:logs 全链路；带空格与中文路径的检出；Ctrl-C 后
// PG/MCP/Java 保留并能被下一次 up 复用；不同 worktree 互不误停；PG 卷保留；以及
// windowsStop 捕获 Process 句柄后确实清掉 cmd.exe/concurrently/tsx/vite 子树。
// 黑盒只操作本测试自己 spawn 的短命无业务 Node 子进程，绝不把测试 PID 之外的进程交给真实 kill。
const WINDOWS_ONLY = process.platform === "win32" ? false : "需要 Windows 实机";

function spawnIdle(args = []) {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", ...args], { stdio: ["ignore", "ignore", "ignore"] });
}
function snapshotRow(pid) {
  return windowsProcesses().find((entry) => entry.pid === pid);
}
async function waitForRow(pid, present) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (Boolean(snapshotRow(pid)) === present) return;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`pid ${pid} 存活状态未变为 ${present}`);
}
function end(child) {
  return new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) return done();
    child.once("close", done);
    child.kill();
  });
}
function freePort() {
  return new Promise((done) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

test("Windows-only: CIM snapshot keeps non-ASCII text and listener ownership", { skip: WINDOWS_ONLY }, async () => {
  const rows = windowsProcesses();
  const self = rows.find((entry) => entry.pid === process.pid);
  assert.ok(self, "Win32_Process 应包含当前 Node 进程");
  assert.match(self.command, /dev-platform-windows\.node-test\.mjs/);
  assert.equal(identifyWindows(rows, CTX).group.some((entry) => entry.pid === process.pid), false);

  // 含中文的参数要原样从 PowerShell 输出回到 Node（OutputEncoding 生效）。
  const unicode = spawnIdle(["标签-中文-路径"]);
  try {
    await once(unicode, "spawn");
    for (let attempt = 0; attempt < 40 && !(snapshotRow(unicode.pid)?.command ?? "").includes("标签-中文-路径"); attempt++)
      await new Promise((done) => setTimeout(done, 250));
    assert.match(snapshotRow(unicode.pid).command, /标签-中文-路径/);
  } finally {
    await end(unicode);
  }

  // 真实临时 loopback 监听：有监听必须落到该 PID。
  const listener = spawn(
    process.execPath,
    ["-e", "const net=require('node:net');const s=net.createServer(()=>{});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));"],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  try {
    const [chunk] = await once(listener.stdout, "data");
    const port = Number(chunk.toString().trim());
    assert.ok(Number.isInteger(port) && port > 0);
    assert.ok(windowsListeningPids(port).includes(listener.pid));
  } finally {
    await end(listener);
  }
  // 无监听是空数组，而不是查询失败；取一个刚释放的临时端口，不假定固定端口空闲。
  let empty = [1];
  for (let attempt = 0; attempt < 3 && empty.length; attempt++) empty = windowsListeningPids(await freePort());
  assert.deepEqual(empty, []);
});

test("Windows-only: windowsStop stops the confirmed instance only and preserves bystanders", { skip: WINDOWS_ONLY }, async () => {
  const target = spawnIdle(), stale = spawnIdle(), bystander = spawnIdle();
  try {
    await Promise.all([once(target, "spawn"), once(stale, "spawn"), once(bystander, "spawn")]);
    const targetRow = snapshotRow(target.pid), staleRow = snapshotRow(stale.pid), bystanderRow = snapshotRow(bystander.pid);
    assert.ok(targetRow && staleRow && bystanderRow);
    const result = windowsStop([
      { pid: target.pid, lstart: targetRow.created, command: targetRow.command },          // 正确身份 -> 停
      { pid: stale.pid, lstart: "1", command: staleRow.command },                          // 旧身份 -> 不杀
      { pid: bystander.pid, lstart: bystanderRow.created, command: "不匹配的命令行" },      // 同实例信息变化 -> 报失败
    ]);
    assert.ok(result.stopped.includes(target.pid), JSON.stringify(result));
    assert.ok(result.reused.includes(stale.pid), JSON.stringify(result));
    assert.ok(result.failed.includes(bystander.pid), JSON.stringify(result));
    await waitForRow(target.pid, false);
    assert.ok(snapshotRow(stale.pid), "旧身份的 PID 不应被停止");
    assert.ok(snapshotRow(bystander.pid), "命令行不匹配的旁观者不应被停止");
  } finally {
    await Promise.all([end(target), end(stale), end(bystander)]);
  }
});
