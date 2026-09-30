import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { configuration, holdForeground, start } from "./dev-command.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = fileURLToPath(import.meta.url).replace(/\.node-test\.mjs$/, ".mjs");

test("dev keeps the old three-process pnpm arguments and the open-source defaults", () => {
  const settings = configuration("dev", { root: ROOT }, {});
  assert.equal(settings.tool, "concurrently");
  assert.deepEqual(settings.args, ["pnpm:dev:server", "pnpm:dev:web", "pnpm:dev:ontology-manager"]);
  assert.equal(settings.cwd, ROOT);
  assert.equal(settings.env.NODE_ENV, "development");
  assert.equal(settings.env.ONTOLOGY_MANAGER_URL, "http://localhost:5174");
  assert.equal(settings.env.DATARAG_ORIGIN, undefined);
});

test("a product default fills DATARAG_ORIGIN and never overrides an explicit value", () => {
  const product = { root: ROOT, dataragOrigin: "http://localhost:18087" };
  assert.equal(configuration("dev", product, {}).env.DATARAG_ORIGIN, "http://localhost:18087");
  assert.equal(configuration("manager", product, {}).env.DATARAG_ORIGIN, "http://localhost:18087");
  assert.equal(
    configuration("manager", product, { DATARAG_ORIGIN: "http://custom:18087" }).env.DATARAG_ORIGIN,
    "http://custom:18087"
  );
  const inherited = {};
  configuration("dev", product, inherited);
  assert.deepEqual(inherited, {});
});

test("server, web and manager keep their own cwd and pass this checkout's absolute entry", () => {
  const server = configuration("server", { root: ROOT, dataragOrigin: "http://localhost:18087" }, {});
  assert.equal(server.tool, "tsx");
  assert.deepEqual(server.args, ["watch", join(ROOT, "apps/workbench/src/index.ts")]);
  assert.equal(server.cwd, join(ROOT, "apps/workbench"));
  assert.equal(server.env.NODE_ENV, "development");
  assert.equal(server.env.DATARAG_ORIGIN, undefined);

  const web = configuration("web", { root: ROOT, dataragOrigin: "http://localhost:18087" }, {});
  assert.equal(web.tool, "vite");
  assert.deepEqual(web.args, ["--config", join(ROOT, "apps/workbench/web/vite.config.ts")]);
  assert.equal(web.cwd, join(ROOT, "apps/workbench"));
  // A standalone dev:web sets no NODE_ENV, as the old entry point did; the combined dev
  // still has the parent set it for all of them.
  assert.equal(web.env.NODE_ENV, undefined);
  assert.equal(web.env.DATARAG_ORIGIN, undefined);

  const manager = configuration("manager", { root: ROOT }, {});
  assert.equal(manager.tool, "vite");
  assert.deepEqual(manager.args, [join(ROOT, "apps/ontology-manager"), "--port", "5174"]);
  assert.equal(manager.cwd, join(ROOT, "apps/ontology-manager"));
  assert.equal(manager.env.DATARAG_ORIGIN, undefined);
});

test("an unknown mode is rejected", () => {
  assert.throws(
    () => configuration("unknown", { root: ROOT }, {}),
    /Unknown development command: unknown/
  );
});

test("holdForeground forwards on Unix and only holds on Windows, then releases its listeners", () => {
  const child = new EventEmitter();
  const signals = [];
  child.kill = (signal) => signals.push(signal);
  const before = process.listeners("SIGINT");
  const release = holdForeground(child);
  const added = process.listeners("SIGINT").filter((listener) => !before.includes(listener));
  assert.equal(added.length, 1);
  added[0](); // Call the registered listener directly so no signal is really sent to the foreground or test process.
  assert.deepEqual(signals, process.platform === "win32" ? [] : ["SIGINT"]);
  release();
  assert.deepEqual(process.listeners("SIGINT"), before);
});

test("the real entry exits non-zero on an unknown mode", () => {
  const result = spawnSync(process.execPath, [ENTRY, "unknown"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown development command: unknown/);
});

test("start resolves the CLI from the mode cwd, forwards arguments and the exit code", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-command-"));
  try {
    const toolDir = join(dir, "apps/workbench/node_modules/tsx");
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(join(dir, "package.json"), "{}\n");
    writeFileSync(join(dir, "apps/workbench/package.json"), "{}\n");
    writeFileSync(
      join(toolDir, "package.json"),
      JSON.stringify({ name: "tsx", bin: { tsx: "cli.js" } })
    );
    writeFileSync(
      join(toolDir, "cli.js"),
      'require("node:fs").writeFileSync(process.env.DEV_COMMAND_RECORD, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), nodeEnv: process.env.NODE_ENV }));\nprocess.exit(7);\n'
    );
    const record = join(dir, "record.json");
    process.env.DEV_COMMAND_RECORD = record;
    const argv = process.argv;
    process.argv = [process.execPath, ENTRY, "server", "--probe"];
    try {
      const child = start({ root: dir });
      await once(child, "close");
    } finally {
      process.argv = argv;
      delete process.env.DEV_COMMAND_RECORD;
    }
    const written = JSON.parse(readFileSync(record, "utf8"));
    assert.deepEqual(written.argv, ["watch", join(dir, "apps/workbench/src/index.ts"), "--probe"]);
    assert.equal(realpathSync(written.cwd), realpathSync(join(dir, "apps/workbench")));
    assert.equal(written.nodeEnv, "development");
    assert.equal(process.exitCode, 7);
    process.exitCode = 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
