import { describe, expect, it } from "vitest";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { parseSkillMarkdown } from "../manifest";

configureI18n({
  defaultLocale: "en",
  languageSwitchEnabled: false,
  appTextLocale: "en",
  packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
});

describe("skill manifest parsing", () => {
  it("successfully parses skill markdown with legacy supportedChartTypes in frontmatter", () => {
    const markdown = `---
name: legacy-chart-skill
description: A chart skill package with legacy supportedChartTypes field
type: executable
category: visualization
title: Legacy Chart Skill
supportedChartTypes:
  - bar
  - line
entries:
  - scripts/index.mjs
---
## Legacy Chart Skill
This skill renders charts.
`;

    const parsed = parseSkillMarkdown(markdown);
    expect(parsed).not.toBeNull();
    expect(parsed?.manifest.name).toBe("legacy-chart-skill");
    expect(parsed?.manifest.type).toBe("executable");
    expect(parsed?.manifest.category).toBe("visualization");
    expect((parsed?.manifest as Record<string, unknown>).supportedChartTypes).toBeUndefined();
    expect(parsed?.content.trim()).toBe("## Legacy Chart Skill\nThis skill renders charts.");
  });
});
