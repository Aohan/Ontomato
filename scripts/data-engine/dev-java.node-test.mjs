// The shared host Java dev tool against a synthetic product: prerequisites fail before Maven,
// argv/cwd/profile/env/PATH/exit code reach a fake wrapper, the real sync script keeps site
// configuration and extras across runs, and signals are forwarded. No real Maven or product runs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { readDotEnv, startDevJava } from "./dev-java.mjs";

const DEV_JAVA = new URL("./dev-java.mjs", import.meta.url).href;
const SKILL = "payload/skills/aftercalculate/trend-forecaster/SKILL.md";
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
    "res/conf-defaults/prompt.md": "中文 v1\n",
    "res/conf-defaults/prompt.en.md": "English v1\n",
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
  if (venv) {
    put(appDir, { ".venv/bin/python": "#!/bin/sh\n" });
    chmodSync(join(appDir, ".venv/bin/python"), 0o755);
  }
  const app = {
    repoRoot: root, promptLang: "en", requiredSkill: SKILL,
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

test("missing .env, missing venv python or a bad PROMPT_LANG stop before staging or Maven", (t) => {
  for (const [setup, inherited, message] of [
    [{ env: null }, {}, /Missing .*\.env/],
    [{ venv: false }, {}, /Missing .*\.venv\/bin\/python: prepare it once/],
    [{}, { PROMPT_LANG: "fr" }, /PROMPT_LANG must be en or zh/],
  ]) {
    const fx = product(t, setup);
    assert.throws(() => startDevJava(fx.options, [], { ...fx.inherited, ...inherited }), message);
    assert.equal(existsSync(fx.record), false);
    assert.equal(existsSync(join(fx.root, ".build")), false);
  }
});

test("the wrapper gets the reactor argv, profile, user args, .env over inherited env, venv PATH and its exit code comes back", async (t) => {
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

test("sync: templates only when missing, site config and extras kept, defaults and language refreshed", async (t) => {
  const fx = product(t);
  const dev = (path) => join(fx.appDir, ".dev", path);
  await finish(startDevJava(fx.options, [], fx.inherited));
  assert.equal(read(dev("conf/prompt.md")), "English v1\n");
  assert.equal(existsSync(dev("conf/prompt.en.md")), false);
  assert.equal(read(dev("conf/application.yml")), "app: template\n");
  assert.equal(read(dev("skills/aftercalculate/trend-forecaster/SKILL.md")), "skill v1\n");
  assert.ok(existsSync(dev("logs")) && existsSync(dev("python")));
  put(join(fx.appDir, ".dev"), { "conf/application.yml": "app: site\n", "conf/mcp-clients.yml": "mcp: site\n", "conf/extra.md": "extra\n", "skills/extra.txt": "x\n" });
  put(fx.root, { "res/conf-defaults/prompt.md": "中文 v2\n", "res/skills/aftercalculate/trend-forecaster/SKILL.md": "skill v2\n" });
  await finish(startDevJava(fx.options, [], { ...fx.inherited, PROMPT_LANG: "zh" }));
  assert.equal(read(dev("conf/prompt.md")), "中文 v2\n");
  assert.equal(read(dev("conf/application.yml")), "app: site\n");
  assert.equal(read(dev("conf/mcp-clients.yml")), "mcp: site\n");
  assert.equal(read(dev("conf/extra.md")), "extra\n");
  assert.equal(read(dev("skills/extra.txt")), "x\n");
  assert.equal(read(dev("skills/aftercalculate/trend-forecaster/SKILL.md")), "skill v2\n");
});

test("runDevJava forwards SIGTERM to the wrapper and exits with its code", async (t) => {
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
