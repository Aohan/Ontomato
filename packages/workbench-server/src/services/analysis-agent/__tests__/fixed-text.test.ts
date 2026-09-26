import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { configureI18n, setLocale } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { zhCN, zhCNLocaleMeta } from "../../../i18n/locales/zh-CN";
import type { SkillMeta } from "../../../core/skills/types";
import { SkillCategory, SkillType } from "../../../core/skills/constants";

const previousApp = process.env.APP_DEFAULT_LOCALE;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "p3-t3-en-"));

const SKILL_DESCRIPTION =
  "Read the SKILL.md instruction body of a currently available analysis skill, without returning frontmatter. Both knowledge skills and executable skills should read the instructions before use.";
const SKILL_ID = "The skill name in the skill index";
const SKILL_ERROR = "load_skill failed: skill_id must be a non-empty string";
const CHART_DESCRIPTION =
  "Generate charts from the already-obtained data evidence. Pass in the data question identity (questionId) to visualize, and the system will plan and render charts using the evidence's raw data, returning chart identifiers; only chart identifiers returned by this tool can be referenced in the report body.";
const CHART_ERROR =
  "Invalid parameters: questionIds must be an array of data question identities with obtained evidence";
const PLAN_ERROR = "Analysis dimension is missing a stable dimensionId";

function skill(): SkillMeta {
  return {
    id: "demo",
    path: path.join(root, "demo"),
    manifest: {
      name: "demo",
      description: "looks up sales",
      category: SkillCategory.ANALYSIS,
      type: SkillType.EXECUTABLE,
      entries: ["main", "alt"],
      entry: "main",
      tags: [],
      version: "1.0.0",
    },
  } as SkillMeta;
}

afterAll(() => {
  if (previousApp === undefined) delete process.env.APP_DEFAULT_LOCALE;
  else process.env.APP_DEFAULT_LOCALE = previousApp;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("analysis fixed English text", () => {
  it("keeps OSS tool text, model input, report title, and plan error after setLocale", async () => {
    process.env.APP_DEFAULT_LOCALE = "zh-CN";
    installContentLayout({
      runtimeRoot: root,
      prompts: [],
      skillTemplate: [],
      runtimeResources: [],
    });
    configureI18n({
      defaultLocale: "en",
      languageSwitchEnabled: true,
      appTextLocale: "en",
      packs: {
        en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta },
        "zh-CN": {
          messages: { ...zhCN, "analysis.loop.skills.355": "不应出现" },
          ...zhCNLocaleMeta,
        },
      },
    });
    setLocale("zh-CN");

    const skills = await import("../loop/skills");
    const chartMod = await import("../loop/chart");
    const report = await import("../report/report-assembly");
    const artifacts = await import("../task/artifacts");
    const plan = await import("../dimension/plan");

    const loadSkill = skills
      .createLoopSkillTools({
        trajectory: artifacts.createDeepAnalysisArtifactStore({ executionMode: "loop" }),
        domainId: "domain-1",
        selectedSkillIds: [],
        resolveEvidence: () => undefined,
      })
      .find((tool) => tool.name === "load_skill");
    const parameters = loadSkill?.parameters as { properties: { skill_id: { description: string } } };
    expect(loadSkill?.description).toBe(SKILL_DESCRIPTION);
    expect(parameters.properties.skill_id.description).toBe(SKILL_ID);
    const failed = await loadSkill?.execute("call-1", {});
    expect(failed?.content[0]).toEqual({ type: "text", text: SKILL_ERROR });

    expect(skills.buildLoopSkillCapabilityPrompt([skill()])).toBe(
      [
        "## Available analysis skills",
        "- `demo` (looks up sales; executable, declared entries: `main`, `alt`)",
        "",
        "When using a skill, first call `load_skill` to read the instructions; when you need auxiliary material, call `read_skill_file`.Executable skills use `run_skill` to process the questionId returned by `collect_evidence`; when entry is not provided, use the first declared entry.",
        "",
      ].join("\n")
    );

    const chart = chartMod.assembleLoopChartCapability({
      domainId: "domain-1",
      userQuestion: "sales",
      visualizationSkillIds: ["viz"],
      reportDeliverableEnabled: true,
      resolveCandidates: () => [],
      trajectory: artifacts.createDeepAnalysisArtifactStore({ executionMode: "loop" }),
    });
    expect(chart.supervisorTools[0].name).toBe("generate_chart");
    expect(chart.supervisorTools[0].description).toBe(CHART_DESCRIPTION);
    expect(chart.prompt).toBe(
      [
        "- `generate_chart`: hand successfully evidence-collected data questions to the chart capability, plan and render charts from the evidence's raw data, and return chart identifiers. Chart failure does not affect the report, and you can continue without charts.",
        "",
        "## Chart Reference Rules",
        "- In the chapter body, write `[chart:summary:<chartId>]` on its own line to reference a chart, with one blank line before and after.",
        "- You can only reference a chartId that `generate_chart` has already returned this time; identifiers that were never returned will not be rendered.",
        "- Do not output images, HTML, or chart code yourself.",
        "",
      ].join("\n")
    );
    await expect(chart.supervisorTools[0].execute("call-2", {})).rejects.toThrow(CHART_ERROR);

    expect(report.dimensionSectionTitle({ dimensionName: "区域", dimensionValue: "华东" })).toBe("区域: 华东");
    expect(() =>
      plan.assertPlannedDimensionIds(
        [{ dimensionId: "", dimensionName: "区域", dimensionValue: "华东", subQuestions: [] }],
        "thread-1",
        1
      )
    ).toThrow(PLAN_ERROR);
  });
});
