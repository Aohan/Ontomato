import assert from "node:assert/strict";
import { test } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkPythonRequirements,
  importedRuntime,
  readRevision,
  selectPromptLanguage,
} from "./build-images.mjs";

function temporary(fn) {
  const dir = mkdtempSync(join(tmpdir(), "backend 测试 space-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("Python dependency requirements are semantic and exactly pinned", () => {
  checkPythonRequirements(
    "NumPy==2.2.6 # note\r\n# comment\r\npython_dateutil==2.9.0.post0",
    { numpy: "2.2.6", "python-dateutil": "2.9.0.post0" },
  );
  assert.throws(
    () => checkPythonRequirements("numpy==1.26.4", { numpy: "2.2.6" }),
    /mismatch/,
  );
  assert.throws(() => checkPythonRequirements("numpy>=1", {}), /exact/);
});
test("prompt language staging selects only the final .en suffix and overwrites the paired default", () => {
  for (const lang of ["zh", "en"])
    temporary((dir) => {
      mkdirSync(join(dir, "lang"));
      writeFileSync(join(dir, "prompt.md"), "中文");
      writeFileSync(join(dir, "prompt.en.md"), "English");
      writeFileSync(join(dir, "lang/en.json"), "{}");
      writeFileSync(join(dir, "tricky.en.middle.md"), "keep");
      selectPromptLanguage(dir, lang);
      assert.equal(
        readFileSync(join(dir, "prompt.md"), "utf8"),
        lang === "en" ? "English" : "中文",
      );
      assert.equal(existsSync(join(dir, "prompt.en.md")), false);
      assert.equal(existsSync(join(dir, "tricky.en.middle.md")), true);
      assert.equal(existsSync(join(dir, "lang/en.json")), true);
    });
});
test("revision is the single concrete public POM property", () => {
  assert.equal(
    readRevision(
      "<parent><version>3.5.0</version></parent><properties><revision>4.0.0-dev</revision></properties>",
    ),
    "4.0.0-dev",
  );
  assert.throws(() => readRevision("<revision>${revision}</revision>"));
  assert.throws(() =>
    readRevision("<revision>1</revision><revision>2</revision>"),
  );
  assert.throws(() => readRevision("<version>3.5.0</version>"));
  const live = readRevision(
    readFileSync(fileURLToPath(new URL("../../pom.xml", import.meta.url)), "utf8"),
  );
  assert.equal(live, "4.0.0-dev");
});
test("pack-app rejects a missing lock before it can inspect a runtime", () =>
  temporary((dir) => {
    assert.throws(
      () => importedRuntime({ lockRoot: dir, family: "java-app" }, "arm64"),
      /missing/,
    );
  }));
