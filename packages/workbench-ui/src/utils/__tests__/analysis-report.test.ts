import { beforeAll, describe, expect, it } from "vitest";
import { presentation } from "@ontomato/contracts/__tests__/presentation-fixtures";
import {
  buildReportFromDeepAnalysis,
  buildReportSectionsFromDeepAnalysis,
  isDeepAnalysisReportStreaming,
  joinReportSections,
  moveSummaryMarkdownToTop,
  orderReportSections,
  updateParsedReportContent,
} from "../analysis-report";
import { installWorkbenchContent, workbenchContent } from "../../content";

// 原用例为企业前端：综合总结标题按企业原识别集合（迁出前 web/src/utils/analysis-report.ts）。
beforeAll(() =>
  installWorkbenchContent({
    ...workbenchContent(),
    comprehensiveSummaryTitles: [
      "综合总结",
      "綜合總結",
      "Comprehensive Summary",
      "総合サマリー",
      "ملخص شامل",
      "Résumé complet",
      "Umfassende Zusammenfassung",
      "Riepilogo completo",
    ],
  })
);

describe("analysis report sections", () => {
  it("moves the comprehensive summary to the front only when configured", () => {
    const sections = [
      { id: "dimension-1", content: "维度一" },
      { id: "summary", content: "综合总结" },
      { id: "dimension-2", content: "维度二" },
    ];

    expect(orderReportSections(sections)).toEqual(sections);
    expect(orderReportSections(sections, "top")).toEqual([sections[1], sections[0], sections[2]]);
    expect(moveSummaryMarkdownToTop("正文\n\n---\n\n# 综合总结\n\n结论")).toBe(
      "# 综合总结\n\n结论\n\n---\n\n正文"
    );
  });

  it("keeps same-shaped tasks independent and follows backend title decisions", () => {
    const first = presentation({
      sections: [{ sectionId: "d1", order: 0, revision: 1, markdown: "AAAA" }],
    });
    const second = presentation({
      sections: [
        {
          sectionId: "d1",
          order: 0,
          revision: 1,
          markdown: "BBBB",
          title: "区域：华北",
          titleLevel: 2,
        },
      ],
    });
    expect(buildReportFromDeepAnalysis(first)).toBe("AAAA");
    expect(buildReportFromDeepAnalysis(second)).toBe("## 区域：华北\n\nBBBB");
  });

  it("keeps concurrent section updates isolated and reuses the untouched chart parse", () => {
    const chartHtml = '<div class="chart-container"><script>echarts.init()</script></div>';
    const data = presentation({
      sections: [
        { sectionId: "a", order: 0, revision: 1, markdown: "A 首段" },
        { sectionId: "b", order: 1, revision: 1, markdown: "B 首段\n[chart:dimension:c1]\nB 尾部" },
      ],
      charts: [
        {
          chartId: "c1",
          scopeId: "b",
          title: "图",
          chartType: "bar",
          sourceSubQuestion: "问题",
          skillId: "bar",
          dataCount: 1,
          html: chartHtml,
        },
      ],
    });
    const initial = buildReportSectionsFromDeepAnalysis(data);
    const parsed = new Map(
      initial.map((s) => [s.id, updateParsedReportContent(undefined, s.content, s.id, true)])
    );
    data.sections[0].markdown += "\n\n### A 新结论\n\n增长 20%";
    const next = new Map(
      buildReportSectionsFromDeepAnalysis(data).map((s) => [
        s.id,
        updateParsedReportContent(parsed.get(s.id), s.content, s.id, true),
      ])
    );
    expect(next.get("b")).toBe(parsed.get("b"));
    expect(
      next.get("a")?.parts.some((p) => p.type === "text" && p.content.includes("A 新结论"))
    ).toBe(true);
    expect(next.get("b")?.parts.map((p) => p.type)).toContain("chart");
    expect(next.get("b")?.parts.some((p) => p.type === "text" && p.content.includes("```"))).toBe(
      false
    );
  });

  it("performs a full parse at terminal and follows only runState for report streaming", () => {
    const content =
      '正文\n```html\n<div class="chart-container"><script>echarts.init()</script></div>\n```';
    const stale = {
      content,
      isStreaming: true,
      parts: [{ type: "text" as const, id: "a:part-0", content }],
    };
    expect(updateParsedReportContent(stale, content, "a", false).parts.map((p) => p.type)).toEqual([
      "text",
      "chart",
    ]);
    expect(joinReportSections([{ id: "a", content }])).toBe(content);
    const snapshot = {
      mode: "deep-analysis" as const,
      status: "completed" as const,
      source: "live" as const,
      primaryText: "",
      deepAnalysis: presentation({
        sections: [{ sectionId: "a", order: 0, revision: 1, markdown: "草稿" }],
      }),
    };
    expect(isDeepAnalysisReportStreaming(snapshot)).toBe(true);
    snapshot.deepAnalysis.runState.status = "completed";
    expect(isDeepAnalysisReportStreaming(snapshot)).toBe(false);
  });

  it("shows failure-only reports but leaves action-only tasks without report blocks", () => {
    const data = presentation({ executionMode: "loop", finalAnswer: "完成动作" });
    expect(buildReportSectionsFromDeepAnalysis(data)).toEqual([]);
    data.runState.error = "执行失败";
    expect(buildReportSectionsFromDeepAnalysis(data)).toEqual([
      { id: "failure", content: "执行失败" },
    ]);
  });
});
