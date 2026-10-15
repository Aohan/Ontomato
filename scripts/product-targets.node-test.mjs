import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SHARED = resolve(dirname(fileURLToPath(import.meta.url)), "product-targets.mk");
const BUILD = ["workbench", "data-engine", "ontology-manager"];
const FAKE = BUILD;
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
  // Only the rules count: the header comment may name the edition it stays out of.
  const rules = readFileSync(SHARED, "utf8").split("\n").filter((line) => !line.startsWith("#")).join("\n");
  assert.doesNotMatch(rules, /LICENSE_MODE|PROMPT_LANG|enterprise/);
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
    assert.deepEqual(result.calls, [line("workbench"), line("data-engine")]);
  });
});
