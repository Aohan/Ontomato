import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installContentLayout, installWorkbenchProduct } from "@ontomato/workbench-server";
import { workbenchServerResourceRoot } from "@ontomato/workbench-server/content/resources";
import { syncRuntimeDefaultResources } from "@ontomato/workbench-server/platform/runtime-defaults";
import { ossContentLayout } from "../content";
import { configureOssI18n } from "../i18n";
import { ossProduct } from "../product";

// knowledge-store and skill-loader reach core/skills/manifest's module-level tApp,
// so they must be imported only after the OSS i18n assembly (the suite's established pattern).
configureOssI18n();
const { readKnowledgeMarkdown } = await import(
  "@ontomato/workbench-server/platform/diagnosis/observe/agent/knowledge-store"
);
const { loadSkills, resolveSkillDir } = await import(
  "@ontomato/workbench-server/platform/diagnosis/observe/agent/skill-loader"
);

let runtimeRoot: string;
let tempDirs: string[] = [];
const tempDir = (prefix: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};
const data = (...segments: string[]) => path.join(runtimeRoot, "data", ...segments);

beforeEach(() => {
  runtimeRoot = tempDir("oss-runtime-");
  vi.stubEnv("ONTOMATO_LOG_DIR", path.join(runtimeRoot, "logs"));
  installWorkbenchProduct(ossProduct);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("open-source runtime default resources", () => {
  // Extra files and stale default files already in the persistent runtime directory: after syncing, readers see the new defaults and extra files are kept.
  it("syncs the assembled defaults into the persistent data directory that readers use", async () => {
    installContentLayout(ossContentLayout(runtimeRoot));
    fs.mkdirSync(data("knowledge"), { recursive: true });
    fs.mkdirSync(data("echart"), { recursive: true });
    fs.writeFileSync(data("knowledge", "site-note.md"), "# Site note\n");
    fs.writeFileSync(data("echart", "echarts.min.js"), "stale");

    await syncRuntimeDefaultResources();

    expect(readKnowledgeMarkdown("site-note.md").title).toBe("Site note");
    expect(readKnowledgeMarkdown("index.md").content).toBe(
      fs.readFileSync(path.join(workbenchServerResourceRoot, "data", "knowledge", "index.md"), "utf8")
    );
    expect(fs.readFileSync(data("echart", "echarts.min.js"))).toEqual(
      fs.readFileSync(path.join(workbenchServerResourceRoot, "data", "echart", "echarts.min.js"))
    );
    expect(loadSkills(resolveSkillDir()).map((skill) => skill.name)).toContain(
      "query-flow-diagnosis"
    );
  });

  it("does not copy custom paths from a default source", async () => {
    const source = tempDir("oss-defaults-");
    fs.mkdirSync(path.join(source, "custom"));
    fs.writeFileSync(path.join(source, "custom", "local.md"), "local");
    fs.writeFileSync(path.join(source, "shipped.md"), "shipped");
    installContentLayout({
      ...ossContentLayout(runtimeRoot),
      runtimeResources: [{ from: source, to: "knowledge" }],
    });

    await syncRuntimeDefaultResources();

    expect(fs.readFileSync(data("knowledge", "shipped.md"), "utf8")).toBe("shipped");
    expect(fs.existsSync(data("knowledge", "custom"))).toBe(false);
  });
});
