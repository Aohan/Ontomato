import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { applicationServerPort, classify, composeArgs, composeProject, hasArg, identify, localMcpPort, parseProcessTable,
  productContext, resolveJavaPort, yamlFor } from "./dev-stack.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(REPO, "packages", "data-engine-core");
const REAL_MCP = readFileSync(join(CORE, "conf-defaults", "mcp-clients.yml"), "utf8");
const REAL_APP = readFileSync(join(CORE, "conf-defaults", "application.yml"), "utf8");
const LSTART = "Sat Sep 27 15:19:06 2026";
// Sandbox uses executable symlinks to put fake ps/lsof/docker/kill into PATH, and fakes are scripts with shebangs;
// both only hold on POSIX (Windows requires privileges for symlinks, and CreateProcess ignores shebangs),
// so sandbox-dependent tests are explicitly skipped on Windows, with Windows-only tests covering the same boundaries.
const POSIX_ONLY = process.platform === "win32" ? "fake ps/lsof/docker/kill and executable symlinks are POSIX-only" : false;
const posixTest = (name, fn) => test(name, { skip: POSIX_ONLY }, fn);

// Fake external tools: dispatch on the invoked name, state from FAKE_SCENARIO, record argv.
const FAKE = `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
const name = basename(process.argv[1]), args = process.argv.slice(2);
const scenario = JSON.parse(process.env.FAKE_SCENARIO ?? "{}");
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, name + " " + args.join(" ") + "\\n");
const out = (text, rc = 0) => { process.stdout.write(text); process.exit(rc); };
if (name === "ps") {
  const rows = scenario.ps ?? [];
  if (args[0] === "-axo") out(rows.map((r) => r.pid + " " + r.ppid + " " + r.lstart + " " + r.command).join("\\n") + (rows.length ? "\\n" : ""));
  const row = rows.find((r) => r.pid === Number(args[args.indexOf("-p") + 1]));
  if (args.includes("lstart=")) out(row ? row.lstart + "\\n" : "", row ? 0 : 1);
  out(row ? Number(args[args.indexOf("-p") + 1]) + "\\n" : "", row ? 0 : 1);
}
if (name === "lsof") {
  if (args.some((a) => a.startsWith("-iTCP:")))
    out((scenario.listeners?.[Number(args.find((a) => a.startsWith("-iTCP:")).slice(6))] ?? []).map((p) => p + "\\n").join(""));
  const list = String(args[args.indexOf("-p") + 1] ?? "");
  out(list.split(",").filter((p) => scenario.cwd?.[p]).map((p) => "p" + p + "\\nn" + scenario.cwd[p] + "\\n").join(""));
}
if (name === "kill") out("", scenario.killRc ?? 0);
if (name === "docker") {
  const joined = args.join(" ");
  if (args[0] === "info") out("", scenario.dockerInfo ?? 0);
  if (args[0] === "ps") out(scenario.labelContainers ?? "", scenario.labelRc ?? 0);
  if (args[0] === "volume") out(scenario.labelVolumes ?? "", scenario.labelRc ?? 0);
  if (args[0] === "compose" && joined.includes(" ps ")) out(scenario.composePs ?? "[]");
  if (args[0] === "compose" && joined.includes(" up ")) { if (scenario.upMarker) writeFileSync(scenario.upMarker, "up"); out("", scenario.composeUp ?? 0); }
  if (args[0] === "compose" && joined.includes(" down")) out("", scenario.composeDown ?? 0);
  out("", 0);
}
out("", 0);
`;

function sandbox(makeScenario, files) {
  const dir = mkdtempSync(join(tmpdir(), "dev-stack-"));
  const root = join(dir, "product");
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(root, "node_modules"), { recursive: true });
  symlinkSync(join(REPO, "node_modules", "yaml"), join(root, "node_modules", "yaml"));
  const fake = join(bin, "fake.mjs");
  writeFileSync(fake, FAKE);
  chmodSync(fake, 0o755);
  for (const name of ["ps", "lsof", "docker", "kill"]) symlinkSync(fake, join(bin, name));
  const realRoot = realpathSync(root);
  const scenario = makeScenario(realRoot);
  for (const [rel, content] of Object.entries(files)) {
    const target = join(root, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  if (existsSync(join(root, "apps/data-engine/.venv/bin/python"))) chmodSync(join(root, "apps/data-engine/.venv/bin/python"), 0o755);
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  return { dir, root: realRoot, log, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_SCENARIO: JSON.stringify(scenario), FAKE_LOG: log } };
}
function productFiles(port) {
  return { "package.json": "{}\n", "dev/postgres.compose.yml": "services: {}\n", "apps/data-engine/dev.mjs": "process.exit(0)\n", "apps/data-engine/.env": `SERVER_PORT=${port}\n`, "apps/data-engine/.venv/bin/python": "#!/bin/sh\nexit 0\n" };
}
function cli(sb, command) {
  const result = spawnSync(process.execPath, [join(REPO, "scripts", "dev-stack.mjs"), sb.root, command], {
    cwd: sb.root,
    env: sb.env,
    encoding: "utf8",
    timeout: 30000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls: readFileSync(sb.log, "utf8").trim().split("\n").filter(Boolean) };
}
function withFake(sb, fn) {
  const saved = { PATH: process.env.PATH, FAKE_SCENARIO: process.env.FAKE_SCENARIO, FAKE_LOG: process.env.FAKE_LOG };
  Object.assign(process.env, { PATH: sb.env.PATH, FAKE_SCENARIO: sb.env.FAKE_SCENARIO, FAKE_LOG: sb.env.FAKE_LOG });
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
function cleanup(sb) {
  rmSync(sb.dir, { recursive: true, force: true });
}
test("composeProject is stable per realpath and separates same-basename worktrees", () => {
  const a = composeProject("/w/topic/ontomato");
  assert.equal(a, composeProject("/w/topic/ontomato"));
  assert.notEqual(a, composeProject("/w/other/ontomato"));
  assert.match(a, /^ontomato-dev-[0-9a-f]{8}$/);
  assert.match(composeProject("/w/Foo.Bar"), /^foo-bar-dev-[0-9a-f]{8}$/);
});
test("hasArg keeps exact argv boundaries for root prefixes and paths with spaces", () => {
  assert.equal(hasArg("node /w/a/dev.mjs -o", "/w/a/dev.mjs"), true);
  assert.equal(hasArg("node /w/a-2/dev.mjs", "/w/a/dev.mjs"), false);
  assert.equal(hasArg("node /w/a b/dev.mjs -o", "/w/a b/dev.mjs"), true);
  assert.equal(hasArg("node /w/a b/dev.mjs -o", "/w/a/dev.mjs"), false);
});
test("the real templates parse with the documented keys", () => {
  assert.equal(localMcpPort(REAL_MCP, REPO), 18500);
  assert.equal(applicationServerPort(REAL_APP, REPO), 18087);
});
test("MCP selection accepts only one local explicit http /sse entry", () => {
  const doc = (clients) => `ontomato:\n  data-engine:\n    mcp-clients:\n${clients}`;
  assert.throws(() => localMcpPort(doc("      - sse-server: http://10.0.0.1:18500/sse\n"), REPO), /no local 127\.0\.0\.1 MCP entry/);
  assert.throws(() => localMcpPort(doc("      - sse-server: http://localhost:18500/sse\n"), REPO), /no local 127\.0\.0\.1 MCP entry/);
  assert.throws(() => localMcpPort(doc("      - sse-server: https://127.0.0.1:18500/sse\n"), REPO), /must be http/);
  assert.throws(() => localMcpPort(doc("      - sse-server: http://127.0.0.1/sse\n"), REPO), /missing explicit port/);
  assert.throws(() => localMcpPort(doc("      - sse-server: http://127.0.0.1:18500/sse\n      - sse-server: http://127.0.0.1:18501/sse\n"), REPO), /exactly one required/);
  assert.equal(localMcpPort(doc("      - sse-server: http://10.0.0.1:9999/sse\n      - sse-server: http://127.0.0.1:18500/sse\n"), REPO), 18500);
  try {
    localMcpPort(doc("      - sse-server: http://127.0.0.1:abc/sse\n"), REPO);
    assert.fail("expected invalid URL error");
  } catch (error) {
    assert.match(error.message, /mcp-clients\.yml/);
    assert.doesNotMatch(error.message, /http:\/\/127\.0\.0\.1/);
  }
});
test("yaml resolves from the calling product root, not the shared tool location", () => {
  const dir = mkdtempSync(join(tmpdir(), "yaml-root-"));
  try {
    mkdirSync(join(dir, "node_modules", "yaml"), { recursive: true });
    writeFileSync(join(dir, "package.json"), "{}\n");
    writeFileSync(join(dir, "node_modules", "yaml", "package.json"), JSON.stringify({ name: "yaml", version: "9.9.9", main: "index.cjs" }));
    writeFileSync(join(dir, "node_modules", "yaml", "index.cjs"), 'module.exports = { parse: () => ({ marker: "from-root" }) };\n');
    assert.equal(yamlFor(dir).parse("x").marker, "from-root");
    assert.equal(typeof yamlFor(REPO).parse, "function");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
posixTest("Java port prefers the field .env over the inherited environment", () => {
  const sb = sandbox(() => ({}), productFiles(18087));
  try {
    const ctx = productContext(sb.root);
    assert.equal(resolveJavaPort(ctx, { SERVER_PORT: "9999" }), 18087);
    writeFileSync(join(sb.root, "apps/data-engine/.env"), "");
    assert.equal(resolveJavaPort(ctx, { SERVER_PORT: "9999" }), 9999);
    writeFileSync(join(sb.root, "apps/data-engine/.env"), "SERVER_PORT=not-a-port\n");
    assert.throws(() => resolveJavaPort(ctx, {}), /SERVER_PORT/);
  } finally {
    cleanup(sb);
  }
});
posixTest("Java port falls back to the field application.yml literal and rejects expressions", () => {
  const sb = sandbox(() => ({}), productFiles(18087));
  try {
    const ctx = productContext(sb.root);
    writeFileSync(join(sb.root, "apps/data-engine/.env"), "");
    mkdirSync(join(sb.root, "apps/data-engine/.dev/conf"), { recursive: true });
    writeFileSync(join(sb.root, "apps/data-engine/.dev/conf/application.yml"), "server:\n  port: 28087\n");
    assert.equal(resolveJavaPort(ctx, {}), 28087);
    writeFileSync(join(sb.root, "apps/data-engine/.dev/conf/application.yml"), "server:\n  port: ${SERVER_PORT:18087}\n");
    assert.throws(() => resolveJavaPort(ctx, {}), /SERVER_PORT/);
  } finally {
    cleanup(sb);
  }
});
test("classify keeps Maven, RAGMain, MCP and helper inside exact path and cwd boundaries", () => {
  const ctx = productContext(REPO);
  assert.equal(classify(`java -Dmaven.multiModuleProjectDirectory=${ctx.root} package`, ctx.root, ctx), undefined);
  assert.equal(classify(`java -Dmaven.multiModuleProjectDirectory=${ctx.root} org.codehaus.plexus.classworlds.launcher.Launcher spring-boot:run`, ctx.root, ctx), "maven");
  assert.equal(classify(`java -Dmaven.multiModuleProjectDirectory=${ctx.root}-2 spring-boot:run`, ctx.root, ctx), undefined);
  assert.equal(classify(`java -Dmaven.multiModuleProjectDirectory=${ctx.root} org.codehaus.plexus.classworlds.launcher.Launcher spring-boot:run`, ctx.root + "/apps", ctx), undefined);
  assert.equal(classify(`node ${ctx.javaEntry} -o`, ctx.root, ctx), "java-helper");
  assert.equal(classify(`node ${ctx.javaEntry}`, ctx.devRoot, ctx), undefined);
  assert.equal(classify(`${ctx.venvPython} ${ctx.mcpScript} --port 18500`, ctx.devRoot, ctx), "mcp");
  assert.equal(classify(`${ctx.venvPython} ${ctx.mcpScript}`, ctx.root, ctx), undefined);
  assert.equal(classify(`python -c "x=${ctx.mcpScript}"`, ctx.devRoot, ctx), undefined);
  assert.equal(classify(`java -cp ${join(ctx.devRoot, "conf")}:x io.ontomato.dataengine.RAGMain`, ctx.devRoot, ctx), "ragmain");
  assert.equal(classify("java -cp x io.ontomato.dataengine.RAGMain", ctx.devRoot, ctx), undefined);
  assert.equal(classify(`${ctx.javaEntry} script.ts`, ctx.devRoot, ctx), undefined);
});
test("Unix Java recognition keeps flattened paths containing spaces intact", () => {
  const root = "/workspace/My Product/ontomato";
  const ctx = { root, devRoot: `${root}/apps/data-engine/.dev` };
  assert.equal(classify(`java -cp ${ctx.devRoot}/conf:/deps/My Library/x.jar io.ontomato.dataengine.RAGMain`, ctx.devRoot, ctx), "ragmain");
  assert.equal(classify(`java -Dmaven.multiModuleProjectDirectory=${root} -classpath /deps/My Library/boot.jar org.codehaus.plexus.classworlds.launcher.Launcher spring-boot:run`, root, ctx), "maven");
});
test("classify only accepts the real N10 dev commands as frontend roots", () => {
  const ctx = productContext(REPO);
  assert.equal(classify("node scripts/dev-command.mjs dev", ctx.root, ctx), "frontend-root");
  assert.equal(classify("node /w/corepack/pnpm.js dev", ctx.root, ctx), "frontend-root");
  assert.equal(classify("node .../concurrently/dist/bin/concurrently.js pnpm:dev:server pnpm:dev:web pnpm:dev:ontology-manager", ctx.root, ctx), "frontend-root");
  assert.equal(classify("node .../tsx/dist/cli.mjs watch src/index.ts", join(ctx.root, "apps/workbench"), ctx), "frontend-root");
  // Actual worker process started by tsx watch (--require/--import form, script uses absolute entry).
  assert.equal(classify(`node --require /x/node_modules/tsx/dist/preflight.cjs --import file:///x/node_modules/tsx/dist/loader.mjs ${join(ctx.root, "apps/workbench/src/index.ts")}`, join(ctx.root, "apps/workbench"), ctx), "frontend-root");
  assert.equal(classify("node .../vite/bin/vite.js --port 5174", join(ctx.root, "apps/ontology-manager"), ctx), "frontend-root");
  assert.equal(classify("node scripts/dev-command.mjs manager", ctx.root, ctx), "frontend-root");
  assert.equal(classify("node scripts/dev-command.mjs web", ctx.root, ctx), "frontend-root");
  assert.equal(classify("node .../vitest/vitest.mjs run", ctx.root, ctx), undefined);
  assert.equal(classify("node .../vite-node/dist/cli.mjs x.ts", ctx.root, ctx), undefined);
  assert.equal(classify("node .../tsx/dist/cli.mjs script.ts", ctx.root, ctx), undefined);
  assert.equal(classify("node .../vite/bin/vite.js build", ctx.root, ctx), undefined);
  assert.equal(classify("node .../vite/bin/vite.js --port 5174", tmpdir(), ctx), undefined);
  assert.equal(classify("node .../scripts/dev-stack.mjs /w up", ctx.root, ctx), "self");
});
test("classify accepts the absolute manager root that dev-command now passes", () => {
  const ctx = productContext(REPO), manager = join(ctx.root, "apps/ontology-manager");
  assert.equal(classify(`node .../vite/bin/vite.js ${manager} --port 5174`, manager, ctx), "frontend-root");
  assert.equal(classify(`node .../vite/bin/vite.js ${manager} --port 5175`, manager, ctx), undefined);
  assert.equal(classify(`node .../vite/bin/vite.js ${tmpdir()}/apps/ontology-manager --port 5174`, manager, ctx), undefined);
  assert.equal(classify(`node .../vite/bin/vite.js --port 5174`, manager, ctx), "frontend-root");
  assert.equal(classify(`node .../vite/bin/vite.js ${manager}`, manager, ctx), undefined);
});
test("parseProcessTable reads pid, ppid and lstart from one row", () => {
  const rows = parseProcessTable(`  123     1 ${LSTART} node /w/dev.mjs -o\n`);
  assert.deepEqual(rows, [{ pid: 123, ppid: 1, lstart: LSTART, command: "node /w/dev.mjs -o" }]);
});
posixTest("identify finds an orphaned frontend root and all of its descendants", () => {
  const sb = sandbox((root) => ({
    ps: [
      { pid: 501, ppid: 1, lstart: LSTART, command: `node ${root}/node_modules/.pnpm/concurrently@9.2.1/node_modules/concurrently/dist/bin/concurrently.js pnpm:dev:server pnpm:dev:web pnpm:dev:ontology-manager` },
      { pid: 502, ppid: 501, lstart: LSTART, command: "pnpm run dev:web" },
      { pid: 503, ppid: 502, lstart: LSTART, command: `node ${root}/apps/workbench/node_modules/.bin/vite --config web/vite.config.ts` },
    ],
    cwd: { 501: root, 502: root, 503: join(root, "apps/workbench") },
  }), productFiles(18087));
  try {
    const { group } = withFake(sb, () => identify(productContext(sb.root)));
    assert.deepEqual(group.map((entry) => entry.pid).sort(), [501, 502, 503]);
    assert.equal(group.find((entry) => entry.pid === 501).role, "frontend-root");
    assert.equal(group.find((entry) => entry.pid === 503).role, "frontend-child");
  } finally {
    cleanup(sb);
  }
});
posixTest("identify reports live candidates whose cwd cannot be read instead of dropping them", () => {
  const sb = sandbox((root) => ({
    ps: [{ pid: 601, ppid: 1, lstart: LSTART, command: `${root}/apps/data-engine/.venv/bin/python ${CORE}/mcp/mcpserver.py --port 18500` }],
    cwd: {},
  }), productFiles(18087));
  try {
    const { group, unattributable } = withFake(sb, () => identify(productContext(sb.root)));
    assert.deepEqual(group, []);
    assert.deepEqual(unattributable.map((row) => row.pid), [601]);
  } finally {
    cleanup(sb);
  }
});
posixTest("identify never attributes vitest, arbitrary tsx or foreign-root processes", () => {
  const sb = sandbox((root) => ({
    ps: [
      { pid: 701, ppid: 1, lstart: LSTART, command: `node ${root}/node_modules/.pnpm/vitest@1.6.0/node_modules/vitest/vitest.mjs run` },
      { pid: 702, ppid: 1, lstart: LSTART, command: `node ${root}/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs script.ts` },
      { pid: 703, ppid: 1, lstart: LSTART, command: `node ${root}/scripts/dev-command.mjs dev` },
    ],
    cwd: { 701: root, 702: root, 703: join(tmpdir(), "somewhere-else") },
  }), productFiles(18087));
  try {
    const { group } = withFake(sb, () => identify(productContext(sb.root)));
    assert.deepEqual(group, []);
  } finally {
    cleanup(sb);
  }
});
posixTest("up fails fast when Docker is unavailable and never calls compose", () => {
  const sb = sandbox(() => ({ dockerInfo: 1 }), productFiles(18087));
  try {
    const result = cli(sb, "up");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Docker is unavailable/);
    assert.equal(result.calls.some((call) => call.startsWith("docker compose")), false);
  } finally {
    cleanup(sb);
  }
});
posixTest("up checks required local files before touching Docker", () => {
  const files = productFiles(18087);
  delete files["apps/data-engine/.env"];
  const sb = sandbox(() => ({}), files);
  try {
    const result = cli(sb, "up");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Java \.env/);
    assert.equal(result.calls.some((call) => call.startsWith("docker")), false);
  } finally {
    cleanup(sb);
  }
});
posixTest("up rejects an existing same-project resource owned by another root", () => {
  const sb = sandbox(() => ({ dockerInfo: 0, labelContainers: "/some/other/checkout\n" }), productFiles(18087));
  try {
    const result = cli(sb, "up");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not match this checkout/);
    assert.equal(result.calls.some((call) => call.includes(" up ")), false);
  } finally {
    cleanup(sb);
  }
});
posixTest("a failing PG step stops up before MCP is started", () => {
  const sb = sandbox(() => ({ dockerInfo: 0, composePs: "[]", composeUp: 1 }), productFiles(18087));
  try {
    const result = cli(sb, "up");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PG startup failed/);
  } finally {
    cleanup(sb);
  }
});
posixTest("down stops compose without -v and never removes volumes", () => {
  const sb = sandbox(() => ({ dockerInfo: 0, composeDown: 0 }), productFiles(18087));
  try {
    const result = cli(sb, "down");
    assert.equal(result.status, 0, result.stderr);
    const down = result.calls.find((call) => call.includes(" down"));
    assert.ok(down && down.includes("-p ") && down.includes("-f "));
    assert.equal(down.includes("-v"), false);
    assert.equal(result.calls.some((call) => call.startsWith("docker volume rm")), false);
  } finally {
    cleanup(sb);
  }
});
test("compose ignores the ambient env file through the platform null device", () => {
  const args = composeArgs(productContext(REPO), ["down"]);
  assert.equal(args[args.indexOf("--env-file") + 1], devNull);
});
posixTest("down skips the PG step on a foreign label and reports it", () => {
  const sb = sandbox(() => ({ dockerInfo: 0, labelVolumes: "/some/other/checkout\n" }), productFiles(18087));
  try {
    const result = cli(sb, "down");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PG step incomplete/);
    assert.equal(result.calls.some((call) => call.includes(" down")), false);
  } finally {
    cleanup(sb);
  }
});
posixTest("status reports a foreign Java port but claims no owned role", () => {
  const sb = sandbox(() => ({ dockerInfo: 0, composePs: "[]", listeners: { 18087: [4242] } }), productFiles(18087));
  try {
    const result = cli(sb, "status");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Java port 18087 occupied by external process/);
    assert.match(result.stdout, /Java entry: not running/);
  } finally {
    cleanup(sb);
  }
});
posixTest("up rejects a project resource with no root label and reports docker query errors", () => {
  const bare = sandbox(() => ({ dockerInfo: 0, labelVolumes: "\n" }), productFiles(18087));
  const broken = sandbox(() => ({ dockerInfo: 0, labelRc: 1 }), productFiles(18087));
  try {
    assert.match(cli(bare, "up").stderr, /no dev\.stack\.root label/);
    const failed = cli(broken, "up");
    assert.match(failed.stderr, /docker container query failed/);
    assert.equal(failed.calls.some((call) => call.includes(" up ")), false);
  } finally {
    rmSync(bare.dir, { recursive: true, force: true }); rmSync(broken.dir, { recursive: true, force: true });
  }
});
posixTest("down re-verifies identity and reports a failed KILL as non-zero", () => {
  const sb = sandbox((root) => ({ dockerInfo: 0, killRc: 1, cwd: { 900: root }, ps: [{ pid: 900, ppid: 1, lstart: LSTART, command: `node ${root}/node_modules/.pnpm/concurrently@9.2.1/node_modules/concurrently/dist/bin/concurrently.js pnpm:dev:server pnpm:dev:web pnpm:dev:ontology-manager` }] }), productFiles(18087));
  try {
    const result = cli(sb, "down");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /failed to kill|TERM command failed/);
  } finally {
    cleanup(sb);
  }
});


test("inspection strings and other dev tools in this checkout are never owned", () => {
  const ctx = productContext(REPO), web = join(ctx.root, "apps/workbench");
  assert.equal(classify(`python -c pass ${ctx.venvPython} ${ctx.mcpScript}`, ctx.devRoot, ctx), undefined);
  assert.equal(classify(`node -e check ${ctx.javaEntry}`, ctx.root, ctx), undefined);
  assert.equal(classify(`java -cp ${ctx.devRoot}/conf-other:x io.ontomato.dataengine.RAGMain`, ctx.devRoot, ctx), undefined);
  assert.equal(classify("node /tools/tsx/dist/cli.mjs watch other.ts", web, ctx), undefined);
  assert.equal(classify("node /tools/vite/bin/vite.js --config other.ts", web, ctx), undefined);
  assert.equal(classify("node /tools/vite/bin/vite.js", ctx.root, ctx), undefined);
});
posixTest("foreign frontend or Java listeners abort before starting PG", () => {
  for (const port of [3000, 18087]) {
    const sb = sandbox((root) => ({ listeners: { [port]: [4242] },
      ps: [{pid: 901, ppid: 1, lstart: LSTART, command: `node ${root}/apps/data-engine/dev.mjs`}],
      cwd: {901: root} }), productFiles(18087));
    try {
      const r = cli(sb, "up");
      assert.notEqual(r.status, 0); assert.match(r.stderr, /occupied by another process/);
      assert.equal(r.calls.some((c) => c.includes(" up ")), false);
    } finally { cleanup(sb); }
  }
});
posixTest("down reports an unresolved live candidate and still stops its own PG", () => {
  const sb = sandbox((root) => ({ ps: [{pid: 902, ppid: 1, lstart: LSTART,
    command: `node ${root}/apps/data-engine/dev.mjs`}], cwd: {} }), productFiles(18087));
  try {
    const r = cli(sb, "down"); assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Unable to confirm candidate/); assert.ok(r.calls.some((c) => c.includes(" down")));
    assert.equal(r.calls.some((c) => c.startsWith("kill ")), false);
  } finally { cleanup(sb); }
});
function waitFor(predicate, timeout = 5000) {
  return new Promise((done, reject) => {
    const deadline = Date.now() + timeout;
    const timer = setInterval(() => {
      if (predicate()) { clearInterval(timer); done(); }
      else if (Date.now() > deadline) { clearInterval(timer); reject(new Error("Timeout waiting")); }
    }, 50);
  });
}
// Pure file-based test; does not depend on sandbox fake PATH / executable symlinks, so it can run on Windows as well.
test("logs prints the last lines and follows appends, truncation and replacement", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-stack-logs-"));
  const root = join(dir, "product");
  const log = join(root, "apps/data-engine/.dev/logs/dev-backend.log");
  mkdirSync(dirname(log), { recursive: true });
  const numbered = (prefix, count) =>
    Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(2, "0")}`).join("\n") + "\n";
  writeFileSync(log, numbered("first", 15));
  const child = spawn(process.execPath, [join(REPO, "scripts", "dev-stack.mjs"), root, "logs"], {
    cwd: root, env: process.env, stdio: ["ignore", "pipe", "ignore"],
  });
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  const seen = () => Buffer.concat(chunks).toString();
  try {
    await waitFor(() => seen().includes("first-15"));
    assert.doesNotMatch(seen(), /first-05/); // Only keep last 10 lines
    assert.match(seen(), /first-06/);

    appendFileSync(log, "appended-01\n");
    await waitFor(() => seen().includes("appended-01"));

    writeFileSync(log, "in-place-truncate\n"); // Truncated in place, size < offset
    await waitFor(() => seen().includes("in-place-truncate"));

    // Same-size path replacement: new file is same size, must identify by file identity instead of size to avoid missing beginning.
    const sameSize = join(dir, "same-size.log");
    writeFileSync(sameSize, "same-size-replace\n");
    assert.equal(Buffer.byteLength("same-size-replace\n"), Buffer.byteLength("in-place-truncate\n"));
    renameSync(sameSize, log);
    await waitFor(() => seen().includes("same-size-replace"));

    // Path replacement with larger file must also read from beginning of new content.
    const larger = join(dir, "larger.log");
    writeFileSync(larger, "larger-replacement-01\nsecond-line\n");
    renameSync(larger, log);
    await waitFor(() => seen().includes("larger-replacement-01"));

    // Wait for new file during ENOENT: delete and wait at least one poll cycle before recreating.
    rmSync(log);
    await new Promise((done) => setTimeout(done, 1200));
    writeFileSync(log, "recreated-01\n");
    await waitFor(() => seen().includes("recreated-01"));
  } finally {
    child.kill();
    await once(child, "close");
    rmSync(dir, { recursive: true, force: true });
  }
});
