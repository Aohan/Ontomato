import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildStamp,
  canonical,
  fingerprint,
  imageLabels,
  loadRuntimeLock,
  parseOptions,
  parsePythonRequirements,
  runtimeTag,
  saveRuntimeLock,
  sourceIdentity,
  stagingDirectory,
  validateContract,
} from "./build-support.mjs";

const FAMILY = "java-app";
const INTERFACE = 3;
const contract = (arch) => ({
  family: "java-app",
  interfaceVersion: INTERFACE,
  platform: `linux/${arch}`,
  java: { version: "21.0.8", classVersion: 65 },
  runtimeDependencies: { jars: "resolved-jar-bytes", native: `native-${arch}` },
  python: { version: "3.10.18", packages: { numpy: "2.2.6" } },
});
function temporary(fn) {
  // The temporary path keeps a space and non-ASCII characters; the escapes keep this
  // source file ASCII-only.
  const dir = mkdtempSync(join(tmpdir(), "backend \u6d4b\u8bd5 space-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function git(dir, args) {
  execFileSync("git", ["-C", dir, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
}

test("canonical contract is independent of JSON order, not actual runtime content", () => {
  const a = contract("amd64");
  assert.equal(
    fingerprint(a),
    fingerprint(JSON.parse(JSON.stringify(a).replace(/,/g, ",\n"))),
  );
  const b = structuredClone(a);
  b.runtimeDependencies.jars = "changed-bytes";
  assert.notEqual(fingerprint(a), fingerprint(b));
  b.runtimeDependencies.jars = a.runtimeDependencies.jars;
  b.runtimeDependencies.native = "changed-native-bytes";
  assert.notEqual(fingerprint(a), fingerprint(b));
  assert.equal(canonical({ b: 1, a: "\u4e2d\u6587" }), '{"a":"\u4e2d\u6587","b":1}');
});
test("short locks contain only platform fingerprints and preserve both architectures", () =>
  temporary((dir) => {
    const amd = saveRuntimeLock(dir, FAMILY, "amd64", contract("amd64"), INTERFACE);
    const arm = saveRuntimeLock(dir, FAMILY, "arm64", contract("arm64"), INTERFACE);
    assert.equal(loadRuntimeLock(dir, FAMILY, "amd64"), amd);
    assert.equal(loadRuntimeLock(dir, FAMILY, "arm64"), arm);
    assert.match(
      runtimeTag(FAMILY, amd, "amd64"),
      new RegExp(`^${FAMILY}-runtime:compat-[a-f0-9]{16}-amd64$`),
    );
    const file = join(dir, "runtime-lock.json");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
      schema: 3,
      family: FAMILY,
      runtimes: { "linux/amd64": amd, "linux/arm64": arm },
    });
    writeFileSync(file, readFileSync(file, "utf8").replace(/\n/g, "\r\n"));
    assert.equal(loadRuntimeLock(dir, FAMILY, "amd64"), amd);
  }));
test("successful runtime builds refresh locks; unchanged contracts do not rewrite", () =>
  temporary((dir) => {
    const original = saveRuntimeLock(dir, FAMILY, "amd64", contract("amd64"), INTERFACE);
    const arm = saveRuntimeLock(dir, FAMILY, "arm64", contract("arm64"), INTERFACE);
    const file = join(dir, "runtime-lock.json"),
      timestamp = new Date("2020-01-01T00:00:00Z");
    utimesSync(file, timestamp, timestamp);
    saveRuntimeLock(dir, FAMILY, "amd64", contract("amd64"), INTERFACE);
    assert.equal(statSync(file).mtimeMs, timestamp.getTime());
    const changed = {
      ...contract("amd64"),
      productionDependencies: "changed-runtime-dependency",
    };
    const refreshed = saveRuntimeLock(dir, FAMILY, "amd64", changed, INTERFACE);
    assert.notEqual(refreshed, original);
    assert.equal(loadRuntimeLock(dir, FAMILY, "amd64"), refreshed);
    assert.equal(loadRuntimeLock(dir, FAMILY, "arm64"), arm);
  }));
test("lock and contract boundaries reject old schema, bad fingerprints, family and platform mismatches", () =>
  temporary((dir) => {
    const file = join(dir, "runtime-lock.json");
    assert.throws(() => loadRuntimeLock(dir, FAMILY, "amd64"), /missing/);
    for (const invalid of [
      { schema: 2 },
      { schema: 3, family: FAMILY, runtimes: { "linux/amd64": {} } },
      { schema: 3, family: FAMILY, runtimes: { "linux/amd64": "oops" } },
    ]) {
      writeFileSync(file, JSON.stringify(invalid));
      assert.throws(
        () => loadRuntimeLock(dir, FAMILY, "amd64"),
        /Invalid runtime-lock/,
      );
      assert.throws(
        () => saveRuntimeLock(dir, FAMILY, "amd64", contract("amd64"), INTERFACE),
        /Invalid runtime-lock/,
      );
    }
    rmSync(file);
    const fp = saveRuntimeLock(dir, FAMILY, "amd64", contract("amd64"), INTERFACE);
    assert.throws(
      () => loadRuntimeLock(dir, "wrong-family", "amd64"),
      /Invalid/,
    );
    assert.throws(
      () => loadRuntimeLock(dir, FAMILY, "arm64"),
      /has no linux\/arm64/,
    );
    assert.deepEqual(
      validateContract(FAMILY, "linux/amd64", contract("amd64"), fp, INTERFACE),
      contract("amd64"),
    );
    assert.throws(
      () =>
        validateContract(FAMILY, "linux/amd64", contract("amd64"), fp, 2),
      /interface version 2/,
    );
    assert.throws(
      () =>
        validateContract("wrong-family", "linux/amd64", contract("amd64"), fp, INTERFACE),
      /does not match/,
    );
    assert.throws(
      () => validateContract(FAMILY, "linux/arm64", contract("amd64"), fp, INTERFACE),
      /does not match/,
    );
    assert.throws(
      () =>
        validateContract(
          FAMILY,
          "linux/amd64",
          { ...contract("amd64"), interfaceVersion: 999 },
          fp,
          INTERFACE,
        ),
      /interface version/,
    );
    assert.throws(
      () =>
        validateContract(
          FAMILY,
          "linux/amd64",
          { ...contract("amd64"), unexpected: "tampered" },
          fp,
          INTERFACE,
        ),
      /fingerprint mismatch/,
    );
  }));
test("architecture is mandatory and flags remain literal argv", () => {
  const spec = {
    "--arch": "value",
    "--prompt-lang": "value",
    "--pack-app": "boolean",
    "--pack": "list",
  };
  assert.deepEqual(
    parseOptions(["--arch", "amd64", "--prompt-lang", "en", "--pack-app"], spec),
    {
      "--arch": "amd64",
      "--prompt-lang": "en",
      "--pack-app": true,
    },
  );
  assert.deepEqual(
    parseOptions(["--arch", "arm64", "--pack", "a", "--pack", "b"], spec),
    { "--arch": "arm64", "--pack": ["a", "b"] },
  );
  for (const args of [[], ["--arch"], ["--arch", "windows"], ["--bogus"]])
    assert.throws(() => parseOptions(args, spec));
});
test("source identity reads the given repo and excludes only the service lock", () =>
  temporary((dir) => {
    git(dir, ["init"]);
    writeFileSync(join(dir, "keep.txt"), "a");
    git(dir, ["add", "keep.txt"]);
    git(dir, ["commit", "-m", "init"]);
    const lock = "apps/data-engine/runtime-lock.json";
    const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const clean = sourceIdentity(dir, lock);
    assert.equal(clean.dirty, false);
    assert.equal(clean.revision, head);
    mkdirSync(join(dir, "apps/data-engine"), { recursive: true });
    writeFileSync(join(dir, lock), "{}\n");
    assert.equal(sourceIdentity(dir, lock).dirty, false);
    writeFileSync(join(dir, "other.txt"), "wip");
    assert.equal(sourceIdentity(dir, lock).dirty, true);
  }));
test("without a runtime lock the whole source state counts", () =>
  temporary((dir) => {
    git(dir, ["init"]);
    writeFileSync(join(dir, "keep.txt"), "a");
    git(dir, ["add", "keep.txt"]);
    git(dir, ["commit", "-m", "init"]);
    assert.equal(sourceIdentity(dir).dirty, false);
    mkdirSync(join(dir, "apps/data-engine"), { recursive: true });
    writeFileSync(join(dir, "apps/data-engine/runtime-lock.json"), "{}\n");
    assert.equal(sourceIdentity(dir).dirty, true);
  }));
test("parsePythonRequirements parses pinned requirements correctly and rejects non-pinned", () => {
  const parsed = parsePythonRequirements(
    "# comment\nNumPy==2.2.6\npython_dateutil==2.9.0.post0 # note\n",
  );
  assert.deepEqual(parsed, {
    numpy: "2.2.6",
    "python-dateutil": "2.9.0.post0",
  });
  assert.throws(() => parsePythonRequirements("numpy>=1.0"), /exact.*pin/i);
});
test("the build stamp takes the app repo's revision and any dirty source dirties it", () => {
  const entries = [
    { id: "ontomato", root: "/repos/ontomato", revision: "a".repeat(40), dirty: false },
    { id: "enterprise", root: "/repos/enterprise", revision: "b".repeat(40), dirty: false },
  ];
  assert.match(
    buildStamp("4.0.0-dev", "/repos/enterprise", entries),
    /^4\.0\.0-dev-\d{8}-\d{6}-gbbbbbbbbbbbb$/,
  );
  // One dirty source dirties the whole stamp, even when the app repo is clean.
  assert.match(
    buildStamp("4.0.0-dev", "/repos/enterprise", [
      { ...entries[0], dirty: true },
      entries[1],
    ]),
    /^4\.0\.0-dev-\d{8}-\d{6}-gbbbbbbbbbbbb-dirty$/,
  );
  assert.throws(
    () => buildStamp("4.0.0-dev", "/repos/other", entries),
    /not a build source/,
  );
});
test("image labels carry only the version, component, kind and the pair fingerprint", () => {
  const labels = (args) =>
    Object.fromEntries(
      args
        .filter((_, index) => index % 2 === 1)
        .map((entry) => {
          const at = entry.indexOf("=");
          return [entry.slice(0, at), entry.slice(at + 1)];
        }),
    );
  assert.deepEqual(
    labels(imageLabels("ontomato", "app", "4.0.0-dev", "f".repeat(64), "node-app")),
    {
      "org.opencontainers.image.version": "4.0.0-dev",
      "io.runtime.component": "ontomato",
      "io.runtime.kind": "app",
      "io.runtime.compat-fingerprint": "f".repeat(64),
      "io.runtime.family": "node-app",
    },
  );
  // A builder without a runtime pair carries no fingerprint or family.
  assert.deepEqual(
    labels(imageLabels("ontomato-ontology-manager", "manager", "4.0.0-dev")),
    {
      "org.opencontainers.image.version": "4.0.0-dev",
      "io.runtime.component": "ontomato-ontology-manager",
      "io.runtime.kind": "manager",
    },
  );
});
test("the staging directory is fixed per builder and emptied before every build", () =>
  temporary((dir) => {
    const context = join(dir, ".build", "contexts", "workbench", "arm64", "runtime");
    mkdirSync(join(context, "stale"), { recursive: true });
    writeFileSync(join(context, "stale", "left.txt"), "old");
    assert.equal(stagingDirectory(dir, "workbench", "arm64", "runtime"), context);
    assert.equal(existsSync(join(context, "stale")), false);
    assert.equal(statSync(context).isDirectory(), true);
    writeFileSync(join(context, "again.txt"), "new");
    assert.equal(stagingDirectory(dir, "workbench", "arm64", "runtime"), context);
    assert.equal(existsSync(join(context, "again.txt")), false);
  }));
