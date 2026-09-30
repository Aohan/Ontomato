import { describe, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { generateChartsFromCandidates } from "../chart-generator";

configureI18n({
  defaultLocale: "en",
  languageSwitchEnabled: false,
  appTextLocale: "en",
  packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
});

vi.mock("../../../logging/model-agents", () => ({
  modelAgentName: () => "chartPlanner",
}));

vi.mock("../../../config/model-factory", () => ({
  createModel: () => ({
    invoke: async () => ({
      content: JSON.stringify([
        {
          title: "Sales By Department",
          chartType: "bar",
          sourceSubQuestion: "q1",
          skillId: "custom-bar-skill",
          xField: "dept",
          yField: "sales",
        },
      ]),
    }),
  }),
}));

vi.mock("../../../core/prompts/loader", () => ({
  renderPrompt: () => "prompt",
}));

vi.mock("../../../core/skills/discovery/loader", () => ({
  loadSkillContent: () => "skill instruction body",
}));

vi.mock("../../../core/skills/registry/manager", () => ({
  skillRegistryManager: {
    forDomain: async () => ({
      getSkills: () => [
        {
          id: "custom-bar-skill",
          path: "/fake/custom-bar-skill",
          manifest: {
            name: "custom-bar-skill",
            type: "executable",
            category: "visualization",
            title: "Custom Bar Skill",
            description: "Custom bar skill without chart type declaration",
            tags: [],
            version: "1.0.0",
            entries: ["index.js"],
          },
        },
      ],
    }),
  },
}));

vi.mock("../../../core/skills/execution/runtime", () => ({
  skillRuntime: {
    execute: async () => ({
      html: "<div id='chart'>rendered chart</div>",
      meta: {
        title: "Sales By Department",
        chartType: "bar",
      },
    }),
  },
}));

describe("generateChartsFromCandidates", () => {
  it("executes and produces chart for executable skill without chart type declaration", async () => {
    const result = await generateChartsFromCandidates({
      domainId: "domain-1",
      userQuestion: "Sales by department",
      scopeId: "scope-1",
      candidates: [
        {
          sourceSubQuestion: "q1",
          data: [
            { dept: "Engineering", sales: 100 },
            { dept: "Sales", sales: 200 },
          ],
        },
      ],
      maxCharts: 1,
      failurePolicy: "error",
    });

    expect(result.error).toBeUndefined();
    expect(result.charts).toHaveLength(1);
    expect(result.charts[0].skillId).toBe("custom-bar-skill");
    expect(result.charts[0].chartType).toBe("bar");
    expect(result.charts[0].html).toBe("<div id='chart'>rendered chart</div>");
    expect(result.diagnostics).toEqual([]);
  });
});
