import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { dimensionSectionTitle } from "../report/report-assembly";
import { createDeepAnalysisArtifactStore } from "../task/artifacts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "p3-t3-import-"));
installContentLayout({
  runtimeRoot: root,
  prompts: [],
  skillTemplate: [],
  runtimeResources: [],
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("analysis text before configure", () => {
  it("imports report, chart, and skill factories before a language is configured", async () => {
    const trajectory = createDeepAnalysisArtifactStore({ executionMode: "loop" });
    expect(() => dimensionSectionTitle({ dimensionName: "Région", dimensionValue: "Est" })).toThrow(
      "Workbench i18n is not configured"
    );

    const chart = await import("../loop/chart");
    const skills = await import("../loop/skills");
    expect(() =>
      skills.createLoopSkillTools({
        trajectory,
        domainId: "domain-1",
        selectedSkillIds: [],
        resolveEvidence: () => undefined,
      })
    ).toThrow("Workbench i18n is not configured");
    expect(() =>
      chart.assembleLoopChartCapability({
        domainId: "domain-1",
        userQuestion: "sales",
        visualizationSkillIds: ["viz"],
        reportDeliverableEnabled: true,
        resolveCandidates: () => [],
        trajectory,
      })
    ).toThrow("Workbench i18n is not configured");
  });
});
