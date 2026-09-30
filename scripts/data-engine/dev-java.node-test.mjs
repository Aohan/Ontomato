// The shared host Java dev tool against a synthetic product: prerequisites fail before Maven,
// argv/cwd/profile/env/PATH/exit code reach a fake wrapper, the real Python sync keeps site
// configuration and extras across runs, and signals are forwarded. The shell fixture (sh wrapper,
// sh venv python, SIGTERM) and the .cmd launcher case are each limited to the platform they can
// really run on, so a host without that platform reports skips instead of passes.
// No real Maven or product runs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import {
  mavenInvocation,
  mavenWrapper,
  mergeEnvironment,
  prependPythonPath,
  ensurePythonEnv,
  pythonExecutable,
  readDotEnv,
  startDevJava,
} from "./dev-java.mjs";

const DEV_JAVA = new URL("./dev-java.mjs", import.meta.url).href;
const SKILL = "payload/skills/aftercalculate/trend-forecaster/SKILL.md";
// The fake product spawns `#!/bin/sh` scripts, so it only exists where a POSIX shell does.
const posixOnly = { skip: process.platform === "win32" ? "POSIX shell fixture" : false };
const windowsOnly = { skip: process.platform === "win32" ? false : "Windows cmd.exe only" };
const put = (root, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
};
const read = (path) => readFileSync(path, "utf8");

function product(t, { env = "FOO=bar\n", venv = true } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dev-java-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appDir = join(root, "apps/data-engine");
  put(root, {
    "res/conf-defaults/prompt.md": "English v1\n",
    "res/conf-defaults/prompt.zh.md": "Chinese v1\n",
    "res/conf-defaults/application.yml": "app: template\n",
    "res/conf-defaults/mcp-clients.yml": "mcp: template\n",
    "res/skills/aftercalculate/trend-forecaster/SKILL.md": "skill v1\n",
    "requirements.txt": "numpy==2.2.6\n",
    // Records cwd, argv and the env keys under test; exits with FAKE_EXIT.
    "fake-mvnw": '#!/bin/sh\n{ echo "cwd=$(pwd)"; for a in "$@"; do echo "arg=$a"; done; echo "SPACED=$SPACED"; echo "SHARED=$SHARED"; echo "KEEP=$KEEP"; echo "BARE=$BARE"; echo "PATH0=${PATH%%:*}"; } > "$FAKE_RECORD"\nexit "$FAKE_EXIT"\n',
  });
  chmodSync(join(root, "fake-mvnw"), 0o755);
  mkdirSync(appDir, { recursive: true });
  if (env !== null) writeFileSync(join(appDir, ".env"), env);
  // The venv Python is the real interpreter, because dev-java runs the shared sync through it; its
  // recorded requirements hash matches, so no install runs.
  if (venv) {
    put(appDir, {
      ".venv/bin/python": '#!/bin/sh\nexec python3 "$@"\n',
      ".venv/requirements.sha256": createHash("sha256").update("numpy==2.2.6\n").digest("hex"),
    });
    chmodSync(join(appDir, ".venv/bin/python"), 0o755);
  }
  const app = {
    repoRoot: root, promptLang: "en", supportedPromptLangs: ["en", "zh"], requiredSkill: SKILL,
    requirements: { root, path: "requirements.txt" },
    resources: [[root, "res/conf-defaults", "payload/conf-defaults"], [root, "res/skills", "payload/skills"]],
  };
  const options = { app, appDir, wrapper: join(root, "fake-mvnw"), profiles: [] };
  const inherited = { PATH: process.env.PATH, FAKE_RECORD: join(root, "record"), FAKE_EXIT: "0" };
  return { root, appDir, options, inherited, record: join(root, "record") };
}
const finish = (child) => new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));

test(".env is read literally, split at the first =, blank keys and # lines skipped", () => {
  assert.deepEqual(readDotEnv("# note\n\nA=1\nB=a b=c\n=skip\nBARE\n#C=3\n"), { A: "1", B: "a b=c", BARE: "" });
});

test("CRLF only loses the line terminator: value spaces and further = survive", () => {
  assert.deepEqual(readDotEnv("# site\r\nA=1\r\nB=a b=c\r\nC= \r\nBARE\r\n"), { A: "1", B: "a b=c", C: " ", BARE: "" });
});

test("the venv Python and the Maven wrapper follow the platform layout", () => {
  const appDir = join("repo", "apps", "data-engine");
  assert.equal(pythonExecutable(appDir, "linux"), join(appDir, ".venv", "bin", "python"));
  assert.equal(pythonExecutable(appDir, "darwin"), join(appDir, ".venv", "bin", "python"));
  assert.equal(pythonExecutable(appDir, "win32"), join(appDir, ".venv", "Scripts", "python.exe"));
  assert.equal(mavenWrapper(appDir, "linux"), join(appDir, "mvnw"));
  assert.equal(mavenWrapper(appDir, "win32"), join(appDir, "mvnw.cmd"));
});

test("Windows merges case-insensitive names once, the file value winning, and keeps one PATH", () => {
  const merged = mergeEnvironment({ Path: "C:\\inherited", TEMP: "t" }, { PATH: "C:\\file", TEMP: "file" }, "win32");
  assert.deepEqual(merged, { PATH: "C:\\file", TEMP: "file" });
  prependPythonPath(merged, "C:\\venv\\Scripts", "win32");
  assert.deepEqual(merged, { PATH: ["C:\\venv\\Scripts", "C:\\file"].join(delimiter), TEMP: "file" });
});

test("POSIX keeps PATH case-sensitive and a custom Path does not touch it", () => {
  const merged = mergeEnvironment({ PATH: "/usr/bin", Path: "/custom" }, { Path: "/file" }, "linux");
  assert.deepEqual(merged, { PATH: "/usr/bin", Path: "/file" });
  prependPythonPath(merged, "/repo/.venv/bin", "linux");
  assert.deepEqual(merged, { PATH: ["/repo/.venv/bin", "/usr/bin"].join(delimiter), Path: "/file" });
});

test("a Windows .cmd wrapper receives arguments, cwd and exit code through cmd.exe", windowsOnly, async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dev-java cmd ")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const record = join(root, "record.json");
  const wrapper = join(root, "fake mvnw", "mvnw.cmd");
  put(root, {
    "fake mvnw/record.mjs": 'import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.FAKE_RECORD, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));\nprocess.exit(Number(process.env.FAKE_EXIT));\n',
    "fake mvnw/mvnw.cmd": `@echo off\r\n"${process.execPath}" "%~dp0record.mjs" %*\r\nexit /b %ERRORLEVEL%\r\n`,
  });
  const args = ["-B", "-ntp", "-Dname=a b", "-Ddir=C:\\out\\", '-Dq="x"'];
  const invocation = mavenInvocation(wrapper, args);
  const child = spawn(invocation.command, invocation.args, {
    cwd: root,
    env: { ...process.env, FAKE_RECORD: record, FAKE_EXIT: "7" },
    stdio: "ignore",
    windowsVerbatimArguments: invocation.verbatim,
  });
  assert.deepEqual(await finish(child), { code: 7, signal: null });
  assert.deepEqual(JSON.parse(read(record)), { cwd: root, args });
});

test("missing .env or a bad PROMPT_LANG stop before staging or Maven", posixOnly, (t) => {
  for (const [setup, inherited, message] of [
    [{ env: null }, {}, /Missing .*\.env/],
    [{}, { PROMPT_LANG: "fr" }, /PROMPT_LANG must be one of en, zh/],
  ]) {
    const fx = product(t, setup);
    assert.throws(() => startDevJava(fx.options, [], { ...fx.inherited, ...inherited }), message);
    assert.equal(existsSync(fx.record), false);
    assert.equal(existsSync(join(fx.root, ".build")), false);
  }
});

// A host python3 that records its argv and, for -m venv, creates a venv python recording its own.
function fakeHostPython(t) {
  const bin = realpathSync(mkdtempSync(join(tmpdir(), "dev-java-bin-")));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const log = join(bin, "calls");
  writeFileSync(log, "");
  const venvPython = `#!/bin/sh\necho "venv $*" >> "${log}"\n`;
  put(bin, {
    python3: `#!/bin/sh\necho "host $*" >> "${log}"\nmkdir -p "$3/bin"\nprintf '%s' '${venvPython}' > "$3/bin/python"\nchmod +x "$3/bin/python"\n`,
  });
  chmodSync(join(bin, "python3"), 0o755);
  return { env: { PATH: `${bin}${delimiter}/bin${delimiter}/usr/bin` }, calls: () => read(log).trim().split("\n").filter(Boolean) };
}

test("the venv is created with the host python3, installed once per requirements content and reused", posixOnly, (t) => {
  const fx = product(t, { venv: false });
  const host = fakeHostPython(t);
  const requirements = join(fx.root, "requirements.txt");
  const venv = join(fx.appDir, ".venv");
  assert.equal(ensurePythonEnv(fx.appDir, requirements, host.env), join(venv, "bin/python"));
  assert.deepEqual(host.calls(), [`host -m venv ${venv}`, `venv -m pip install -r ${requirements}`]);
  ensurePythonEnv(fx.appDir, requirements, host.env);
  assert.equal(host.calls().length, 2);
  writeFileSync(requirements, "numpy==2.3.0\n");
  ensurePythonEnv(fx.appDir, requirements, host.env);
  assert.deepEqual(host.calls().slice(2), [`venv -m pip install -r ${requirements}`]);
});

test("without a host python3 the venv setup stops with the Python requirement", posixOnly, (t) => {
  const fx = product(t, { venv: false });
  assert.throws(
    () => ensurePythonEnv(fx.appDir, join(fx.root, "requirements.txt"), { PATH: "/nonexistent" }),
    /Creating .* failed.*Python 3\.10\+ is required/,
  );
  assert.equal(existsSync(join(fx.appDir, ".venv/requirements.sha256")), false);
});

test("the wrapper gets the reactor argv, profile, user args, .env over inherited env, venv PATH and its exit code comes back", posixOnly, async (t) => {
  const fx = product(t, { env: "# site\nSPACED=a b=c\nSHARED=file\nBARE\n" });
  const child = startDevJava({ ...fx.options, profiles: ["dev-override"] }, ["-o", "-Dx=y"],
    { ...fx.inherited, SHARED: "inherited", KEEP: "k", FAKE_EXIT: "3" });
  assert.deepEqual(await finish(child), { code: 3, signal: null });
  assert.equal(read(fx.record), [
    `cwd=${fx.root}`,
    ...["-B", "-ntp", "-DskipTests", "-pl", "apps/data-engine", "-am", "-Pdev-override", "spring-boot:run", "-o", "-Dx=y"].map((a) => `arg=${a}`),
    "SPACED=a b=c", "SHARED=file", "KEEP=k", "BARE=", `PATH0=${join(fx.appDir, ".venv/bin")}`, "",
  ].join("\n"));
});

test("sync: templates only when missing, site config and extras kept, defaults and language refreshed", posixOnly, async (t) => {
  const fx = product(t);
  const dev = (path) => join(fx.appDir, ".dev", path);
  await finish(startDevJava(fx.options, [], fx.inherited));
  assert.equal(read(dev("conf/prompt.md")), "English v1\n");
  assert.equal(existsSync(dev("conf/prompt.zh.md")), false);
  assert.equal(read(dev("conf/application.yml")), "app: template\n");
  assert.equal(read(dev("skills/aftercalculate/trend-forecaster/SKILL.md")), "skill v1\n");
  assert.ok(existsSync(dev("logs")) && existsSync(dev("python")));
  put(join(fx.appDir, ".dev"), { "conf/application.yml": "app: site\n", "conf/mcp-clients.yml": "mcp: site\n", "conf/extra.md": "extra\n", "skills/extra.txt": "x\n" });
  put(fx.root, { "res/conf-defaults/prompt.zh.md": "Chinese v2\n", "res/skills/aftercalculate/trend-forecaster/SKILL.md": "skill v2\n" });
  await finish(startDevJava(fx.options, [], { ...fx.inherited, PROMPT_LANG: "zh" }));
  assert.equal(read(dev("conf/prompt.md")), "Chinese v2\n");
  assert.equal(read(dev("conf/application.yml")), "app: site\n");
  assert.equal(read(dev("conf/mcp-clients.yml")), "mcp: site\n");
  assert.equal(read(dev("conf/extra.md")), "extra\n");
  assert.equal(read(dev("skills/extra.txt")), "x\n");
  assert.equal(read(dev("skills/aftercalculate/trend-forecaster/SKILL.md")), "skill v2\n");
});

test("runDevJava forwards SIGTERM to the wrapper and exits with its code", posixOnly, async (t) => {
  const fx = product(t);
  put(fx.root, { "fake-mvnw": '#!/bin/sh\ntrap \'echo TERM >> "$FAKE_RECORD"; exit 143\' TERM\necho started > "$FAKE_RECORD"\nwhile :; do sleep 0.1; done\n' });
  const script = `import { runDevJava } from ${JSON.stringify(DEV_JAVA)}; runDevJava(${JSON.stringify(fx.options)});`;
  const node = spawn(process.execPath, ["--input-type=module", "-e", script], { env: fx.inherited, stdio: "ignore" });
  const deadline = Date.now() + 10000;
  while (!(existsSync(fx.record) && read(fx.record).startsWith("started")) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  node.kill("SIGTERM");
  assert.deepEqual(await finish(node), { code: 143, signal: null });
  assert.equal(read(fx.record), "started\nTERM\n");
});
