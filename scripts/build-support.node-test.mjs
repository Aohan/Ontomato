import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildStamp,
  imageLabels,
  parseOptions,
  sourceIdentity,
  stagingDirectory,
} from "./build-support.mjs";

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

test("architecture is mandatory and flags remain literal argv", () => {
  const spec = {
    "--arch": "value",
    "--prompt-lang": "value",
    "--verbose": "boolean",
    "--image": "list",
  };
  assert.deepEqual(
    parseOptions(["--arch", "amd64", "--prompt-lang", "en", "--verbose"], spec),
    {
      "--arch": "amd64",
      "--prompt-lang": "en",
      "--verbose": true,
    },
  );
  assert.deepEqual(
    parseOptions(["--arch", "arm64", "--image", "a", "--image", "b"], spec),
    { "--arch": "arm64", "--image": ["a", "b"] },
  );
  for (const args of [[], ["--arch"], ["--arch", "windows"], ["--bogus"]])
    assert.throws(() => parseOptions(args, spec));
});
test("source identity reads the given repo and reports all untracked source changes", () =>
  temporary((dir) => {
    git(dir, ["init"]);
    writeFileSync(join(dir, "keep.txt"), "a");
    git(dir, ["add", "keep.txt"]);
    git(dir, ["commit", "-m", "init"]);
    const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const clean = sourceIdentity(dir);
    assert.equal(clean.dirty, false);
    assert.equal(clean.revision, head);
    for (const service of ["data-engine", "workbench"]) {
      mkdirSync(join(dir, "apps", service), { recursive: true });
      writeFileSync(join(dir, "apps", service, "source.json"), "{}\n");
    }
    assert.equal(sourceIdentity(dir).dirty, true);
    writeFileSync(join(dir, "other.txt"), "wip");
    assert.equal(sourceIdentity(dir).dirty, true);
  }));
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
test("final image labels identify component and version", () => {
  assert.deepEqual(imageLabels("ontomato", "4.0.1"), [
    "--label", "org.opencontainers.image.version=4.0.1",
    "--label", "io.ontomato.component=ontomato",
  ]);
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
