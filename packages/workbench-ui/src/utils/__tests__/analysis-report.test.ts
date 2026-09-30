import { describe, expect, it } from "vitest";
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

describe("analysis report sections", () => {
  it("moves the comprehensive summary to the front only when configured", () => {
    const sections = [
      { id: "dimension-1", content: "Dimension one" },
      { id: "summary", content: "Comprehensive Summary" },
      { id: "dimension-2", content: "Dimension two" },
    ];

    expect(orderReportSections(sections)).toEqual(sections);
    expect(orderReportSections(sections, "top")).toEqual([sections[1], sections[0], sections[2]]);
    expect(moveSummaryMarkdownToTop("Body\n\n---\n\n# Comprehensive Summary\n\nConclusion")).toBe(
      "# Comprehensive Summary\n\nConclusion\n\n---\n\nBody"
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
          title: "Region: North",
          titleLevel: 2,
        },
      ],
    });
    expect(buildReportFromDeepAnalysis(first)).toBe("AAAA");
    expect(buildReportFromDeepAnalysis(second)).toBe("## Region: North\n\nBBBB");
  });

  it("keeps concurrent section updates isolated and reuses the untouched chart parse", () => {
    const chartHtml = '<div class="chart-container"><script>echarts.init()</script></div>';
    const data = presentation({
      sections: [
        { sectionId: "a", order: 0, revision: 1, markdown: "A first paragraph" },
        { sectionId: "b", order: 1, revision: 1, markdown: "B first paragraph\n[chart:dimension:c1]\nB tail" },
      ],
      charts: [
        {
          chartId: "c1",
          scopeId: "b",
          title: "Chart",
          chartType: "bar",
          sourceSubQuestion: "Question",
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
    data.sections[0].markdown += "\n\n### A new conclusion\n\nGrowth 20%";
    const next = new Map(
      buildReportSectionsFromDeepAnalysis(data).map((s) => [
        s.id,
        updateParsedReportContent(parsed.get(s.id), s.content, s.id, true),
      ])
    );
    expect(next.get("b")).toBe(parsed.get("b"));
    expect(
      next.get("a")?.parts.some((p) => p.type === "text" && p.content.includes("A new conclusion"))
    ).toBe(true);
    expect(next.get("b")?.parts.map((p) => p.type)).toContain("chart");
    expect(next.get("b")?.parts.some((p) => p.type === "text" && p.content.includes("```"))).toBe(
      false
    );
  });

  it("performs a full parse at terminal and follows only runState for report streaming", () => {
    const content =
      'Body\n```html\n<div class="chart-container"><script>echarts.init()</script></div>\n```';
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
        sections: [{ sectionId: "a", order: 0, revision: 1, markdown: "Draft" }],
      }),
    };
    expect(isDeepAnalysisReportStreaming(snapshot)).toBe(true);
    snapshot.deepAnalysis.runState.status = "completed";
    expect(isDeepAnalysisReportStreaming(snapshot)).toBe(false);
  });

  it("shows failure-only reports but leaves action-only tasks without report blocks", () => {
    const data = presentation({ executionMode: "loop", finalAnswer: "Action completed" });
    expect(buildReportSectionsFromDeepAnalysis(data)).toEqual([]);
    data.runState.error = "Execution failed";
    expect(buildReportSectionsFromDeepAnalysis(data)).toEqual([
      { id: "failure", content: "Execution failed" },
    ]);
  });
});
