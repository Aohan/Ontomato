import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SHARED = resolve(dirname(fileURLToPath(import.meta.url)), "product-targets.mk");
const MAKEFILE = resolve(dirname(fileURLToPath(import.meta.url)), "../Makefile");
// The public repository's own recipe body for one target, without its header.
const recipe = (makefile, name) =>
  makefile.match(new RegExp(`^${name}:\\n((?:\\t.*\\n)+)`, "m"))[1];

const FAKE = [
  "workbench-runtime",
  "workbench-app",
  "data-engine",
  "data-engine-app",
  "ontology-manager",
  "workbench-runtime-pack",
  "workbench-app-pack",
  "pack-data-engine",
  "pack-data-engine-app",
  "pack-ontology-manager",
];
const BUILD = ["workbench-runtime", "workbench-app", "data-engine", "ontology-manager"];
const BUILD_APP = ["workbench-app", "data-engine-app", "ontology-manager"];
const PACK = ["workbench-runtime-pack", "workbench-app-pack", "pack-data-engine", "pack-ontology-manager"];
const PACK_APP = ["workbench-app-pack", "pack-data-engine-app", "pack-ontology-manager"];
let counter = 0;

// A throwaway product root with the real shared rules plus fake service targets that
// only record their name and ARCH, so no build tool is ever started.
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "product-targets-"));
  writeFileSync(
    join(dir, "Makefile"),
    [
      "ARCH ?= test-arch",
      `FAKE := ${FAKE.join(" ")}`,
      ".PHONY: $(FAKE)",
      "$(FAKE):",
      "\t@printf '%s:%s\\n' \"$@\" \"$(ARCH)\" >> \"$(LOG)\"",
      "\t@test \"$@\" != \"$(FAIL_TARGET)\" || exit 1",
      `include ${SHARED}`,
      "",
    ].join("\n")
  );
  return dir;
}

function run(dir, args, env = {}) {
  const log = join(dir, `calls-${counter++}.log`);
  writeFileSync(log, "");
  const result = spawnSync("make", args, {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, LOG: log, ...env },
  });
  const calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
  return { status: result.status, calls, stderr: result.stderr };
}

function inWorkspace(fn) {
  const dir = workspace();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const line = (name, arch = "test-arch") => `${name}:${arch}`;

test("the shared rules only call service targets and never carry edition variables", () => {
  assert.doesNotMatch(readFileSync(SHARED, "utf8"), /LICENSE_MODE|PROMPT_LANG|enterprise/);
});

test("data-engine-app builds the app without packing; only its pack target packs", () => {
  const makefile = readFileSync(MAKEFILE, "utf8");
  const app = recipe(makefile, "data-engine-app");
  assert.match(
    app,
    /^\t\$\(NODE\) apps\/data-engine\/build\.mjs app --arch \$\(ARCH\) --prompt-lang \$\(PROMPT_LANG\)\n$/,
  );
  assert.doesNotMatch(app, /--pack-app/);
  assert.match(recipe(makefile, "pack-data-engine-app"), /--pack-app\n$/);
});

test("build is the default goal and runs Node, Java and Manager in order", () => {
  inWorkspace((dir) => {
    const implicit = run(dir, []);
    assert.equal(implicit.status, 0, implicit.stderr);
    assert.deepEqual(implicit.calls, BUILD.map((name) => line(name)));
    const explicit = run(dir, ["build"]);
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.deepEqual(explicit.calls, BUILD.map((name) => line(name)));
  });
});

test("build-app builds the apps in order and never rebuilds a runtime", () => {
  inWorkspace((dir) => {
    const result = run(dir, ["build-app"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, BUILD_APP.map((name) => line(name)));
    assert.equal(
      result.calls.some((call) => call.startsWith("workbench-runtime")),
      false,
    );
  });
});

test("pack builds runtimes before their apps and then the Manager", () => {
  inWorkspace((dir) => {
    const result = run(dir, ["pack"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, PACK.map((name) => line(name)));
  });
});

test("pack-app never rebuilds a runtime", () => {
  inWorkspace((dir) => {
    const result = run(dir, ["pack-app"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, PACK_APP.map((name) => line(name)));
    assert.equal(result.calls.some((call) => call.startsWith("workbench-runtime")), false);
  });
});

test("the architecture shortcuts keep their names and forward ARCH", () => {
  inWorkspace((dir) => {
    const pack = run(dir, ["pack-amd64"]);
    assert.equal(pack.status, 0, pack.stderr);
    assert.deepEqual(pack.calls, PACK.map((name) => line(name, "amd64")));
    const app = run(dir, ["pack-app-arm64"]);
    assert.equal(app.status, 0, app.stderr);
    assert.deepEqual(app.calls, PACK_APP.map((name) => line(name, "arm64")));
  });
});

test("a command-line ARCH reaches every aggregate step", () => {
  inWorkspace((dir) => {
    const result = run(dir, ["ARCH=arm64", "build"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, BUILD.map((name) => line(name, "arm64")));
  });
});

test("one aggregate target stays sequential under -j", () => {
  inWorkspace((dir) => {
    const result = run(dir, ["-j4", "build"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, BUILD.map((name) => line(name)));
  });
});

test("a failing step stops the aggregate before the later services", () => {
  inWorkspace((dir) => {
    const result = run(dir, ["build"], { FAIL_TARGET: "data-engine" });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, [line("workbench-runtime"), line("workbench-app"), line("data-engine")]);
  });
});
