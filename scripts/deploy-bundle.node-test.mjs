import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertImagePlatform,
  bundleName,
  bundleVersion,
  imageFileName,
  renderEnvExample,
  stageInstallEntry,
  TEMPLATE_ENTRIES,
} from "./deploy-bundle.mjs";

test("the pack carries the deploy template and no onsite state", () => {
  assert.deepEqual(TEMPLATE_ENTRIES, [
    "docker-compose.yml",
    "initdb.sql",
    "README.md",
    "assemble",
  ]);
});

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

test("the whole entry directory stages at the pack root and its shell entries stay executable", () => {
  const installDir = mkdtempSync(join(tmpdir(), "install-entry-"));
  const staging = mkdtempSync(join(tmpdir(), "install-staging-"));
  mkdirSync(join(installDir, "scripts"), { recursive: true });
  writeFileSync(join(installDir, "install.sh"), "#!/usr/bin/env bash\n");
  writeFileSync(join(installDir, "scripts", "image-artifacts.py"), "# helper\n");
  writeFileSync(join(installDir, "scripts", "check-services.py"), "# checker\n");
  mkdirSync(join(installDir, "maintenance-scripts"));
  writeFileSync(join(installDir, "rebuild-vectors.sh"), "#!/usr/bin/env bash\n");
  writeFileSync(join(installDir, "maintenance-scripts", "rebuild_worker.py"), "# worker\n");
  stageInstallEntry(installDir, staging);
  assert.equal(readFileSync(join(staging, "maintenance-scripts", "rebuild_worker.py"), "utf8"), "# worker\n");
  assert.equal(statSync(join(staging, "rebuild-vectors.sh")).mode & 0o777, 0o755);
  assert.equal(readFileSync(join(staging, "install.sh"), "utf8"), "#!/usr/bin/env bash\n");
  assert.equal(readFileSync(join(staging, "scripts", "image-artifacts.py"), "utf8"), "# helper\n");
  assert.equal(readFileSync(join(staging, "scripts", "check-services.py"), "utf8"), "# checker\n");
  assert.equal(statSync(join(staging, "install.sh")).mode & 0o777, 0o755);
});

test("a missing assembled install file fails loudly", () => {
  const installDir = mkdtempSync(join(tmpdir(), "install-entry-"));
  const staging = mkdtempSync(join(tmpdir(), "install-staging-"));
  assert.throws(() => stageInstallEntry(installDir, staging), /Install entry missing/);
});
