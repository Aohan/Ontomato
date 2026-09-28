import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertImagePlatform,
  bundleName,
  bundleVersion,
  imageFileName,
  renderEnvExample,
  templateEntries,
} from "./deploy-bundle.mjs";

function temporary(fn) {
  const dir = mkdtempSync(join(tmpdir(), "deploy-bundle-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the pack carries the deploy template and no onsite state", () =>
  temporary((dir) => {
    for (const entry of ["docker-compose.yml", "initdb.sql", "README.md"])
      writeFileSync(join(dir, entry), "");
    mkdirSync(join(dir, "assemble/data-engine"), { recursive: true });
    writeFileSync(join(dir, "assemble/data-engine/Dockerfile.assemble"), "");
    mkdirSync(join(dir, "backend_data"));
    mkdirSync(join(dir, "frontend_data"));
    writeFileSync(join(dir, ".env"), "");
    assert.deepEqual(templateEntries(dir), [
      "docker-compose.yml",
      "initdb.sql",
      "README.md",
      "assemble",
    ]);
    rmSync(join(dir, "initdb.sql"));
    assert.throws(() => templateEntries(dir), /missing a pack template entry/);
  }));

test("only the ARCH line changes in .env.example", () => {
  assert.equal(
    renderEnvExample("# c\nARCH=amd64\nPORT=3000\n", "arm64"),
    "# c\nARCH=arm64\nPORT=3000\n",
  );
  assert.throws(() => renderEnvExample("# c\n", "arm64"), /exactly one ARCH=/);
  assert.throws(
    () => renderEnvExample("ARCH=amd64\nARCH=amd64\n", "arm64"),
    /exactly one ARCH=/,
  );
});

test("a missing or wrong-architecture image names the pull command", () => {
  assert.throws(
    () => assertImagePlatform(null, "pgvector/pgvector:pg18", "arm64"),
    /docker pull --platform linux\/arm64 pgvector\/pgvector:pg18/,
  );
  assert.throws(
    () =>
      assertImagePlatform(
        { Os: "linux", Architecture: "amd64" },
        "node-app-runtime:deploy-arm64",
        "arm64",
      ),
    /Missing image or wrong architecture \(linux\/arm64\): node-app-runtime:deploy-arm64/,
  );
  assert.equal(
    assertImagePlatform(
      { Os: "linux", Architecture: "arm64" },
      "ontomato-app:deploy",
      "arm64",
    ).Architecture,
    "arm64",
  );
});

test("the pack version comes from the app images and must agree", () => {
  assert.equal(
    bundleVersion([
      { ref: "a", version: "4.0.0-dev" },
      { ref: "b", version: "4.0.0-dev" },
    ]),
    "4.0.0-dev",
  );
  assert.throws(() => bundleVersion([]), /No app image/);
  assert.throws(
    () =>
      bundleVersion([
        { ref: "a", version: "4.0.0-dev" },
        { ref: "b", version: "4.0.1" },
      ]),
    /a=4\.0\.0-dev, b=4\.0\.1/,
  );
});

test("the pack name carries product, version, local time and architecture", () => {
  assert.equal(
    bundleName("ontomato", "4.0.0-dev", "arm64", new Date("2026-09-28T07:22:24Z")),
    "ontomato-4.0.0-dev-20260928-152224-arm64",
  );
  assert.equal(imageFileName("pgvector/pgvector:pg18"), "pgvector-pgvector-pg18.tar.gz");
});
