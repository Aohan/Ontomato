import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { configureOssI18n } from "../i18n";
// Type positions use type-only imports: erased before evaluation so the schema module never loads at import time; production exports untouched.
import type { InvalidSkillPackageError } from "@ontomato/workbench-server/core/skills/manifest";

// Regression for the OSS manifest's fixed copy: pure schema/parsing/migration functions, no routes involved.
// This file wires the OSS assembly itself (the shared suite has no setupFiles) and dynamically imports the manifest,
// guaranteeing the English messages are installed before module-level evaluation. No private package imports, no DB/model/backend.
configureOssI18n();

const manifest = await import("@ontomato/workbench-server/core/skills/manifest");

const scratchDirs: string[] = [];

afterAll(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

function captureThrow(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

describe("oss manifest fixed text", () => {
  it("reports the fixed schema messages through actual zod results", () => {
    const badId = manifest.SkillIdSchema.safeParse("Bad_ID");
    expect(badId.success).toBe(false);
    if (!badId.success) {
      expect(badId.error.issues.map((issue) => issue.message)).toContain(
        "Skill ID may only contain lowercase letters, numbers, and hyphens"
      );
    }

    expect(manifest.getSkillCombinationError("knowledge", "visualization")).toBe(
      "Visualization skills must use the executable type"
    );

    const missingEntries = manifest.SkillManifestSchema.safeParse({
      name: "ok-id",
      description: "d",
      type: "executable",
      category: "analysis",
      entries: [],
    });
    expect(missingEntries.success).toBe(false);
    if (!missingEntries.success) {
      expect(missingEntries.error.issues.map((issue) => issue.message)).toContain(
        "executable skills must declare entries"
      );
    }

    const escapedEntry = manifest.SkillManifestSchema.safeParse({
      name: "ok-id",
      description: "d",
      type: "executable",
      category: "analysis",
      entries: ["../escape"],
    });
    expect(escapedEntry.success).toBe(false);
    if (!escapedEntry.success) {
      expect(escapedEntry.error.issues.map((issue) => issue.message)).toContain(
        "entries must be a relative path inside the skill package"
      );
    }
  });

  it("verifies frontmatter failures through actual parse results", () => {
    const missingClose = captureThrow(() =>
      manifest.parseSkillMarkdown("---\ntitle: bad\n")
    ) as Error | null;
    expect(missingClose).toBeInstanceOf(manifest.InvalidSkillPackageError);
    expect(missingClose?.message).toBe("SKILL.md frontmatter is missing the closing delimiter");

    const badYaml = captureThrow(() =>
      manifest.parseSkillMarkdown("---\n: bad: [\n---\nbody\n")
    ) as Error | null;
    expect(badYaml?.message.startsWith("SKILL.md frontmatter YAML parse failed: ")).toBe(true);

    const multiIssue = captureThrow(() =>
      manifest.parseSkillMarkdown(
        '---\nname: Bad_ID!\ndescription: ""\ntype: executable\ncategory: analysis\nentries: []\n---\nbody\n'
      )
    ) as Error | null;
    expect(multiIssue).toBeInstanceOf(manifest.InvalidSkillPackageError);
    expect(multiIssue?.message.startsWith("SKILL.md frontmatter validation failed: ")).toBe(true);
    expect(multiIssue?.message).toContain("; ");
    expect(multiIssue?.message).toContain("Skill ID may only contain lowercase letters, numbers, and hyphens");
    expect(multiIssue?.message).toContain("description cannot be empty");
    expect(multiIssue?.message).toContain("executable skills must declare entries");
  });

  it("keeps the 400 class on migrateLegacy failures with fixed text", () => {
    const badJsonDir = makeTempDir("t5b-oss-legacy-badjson-");
    fs.writeFileSync(path.join(badJsonDir, "manifest.json"), "{bad");
    const badJson = captureThrow(() => manifest.migrateLegacySkillManifest(badJsonDir));
    expect(badJson).toBeInstanceOf(manifest.InvalidSkillPackageError);
    expect((badJson as InvalidSkillPackageError).code).toBe("INVALID_SKILL_PACKAGE");
    expect((badJson as Error).message).toBe("manifest.json is not valid JSON");

    const badShapeDir = makeTempDir("t5b-oss-legacy-badshape-");
    fs.writeFileSync(path.join(badShapeDir, "manifest.json"), "{}");
    const badShape = captureThrow(() => manifest.migrateLegacySkillManifest(badShapeDir));
    expect(badShape).toBeInstanceOf(manifest.InvalidSkillPackageError);
    expect((badShape as Error).message.startsWith("manifest.json validation failed: ")).toBe(
      true
    );
  });

  it("verifies entry/knowledge failures through actual function results", () => {
    const missingEntry = captureThrow(() =>
      manifest.assertSkillPackageComplete(
        { type: "executable", entries: ["scripts/missing.mjs"] } as never,
        () => false,
        "body"
      )
    ) as Error | null;
    expect(missingEntry?.message).toBe("executable skill is missing entry file: scripts/missing.mjs");

    const emptyKnowledge = captureThrow(() =>
      manifest.assertSkillPackageComplete({ type: "knowledge" } as never, () => true, "   ")
    ) as Error | null;
    expect(emptyKnowledge?.message).toBe("knowledge skill is missing knowledge content");
  });
});
