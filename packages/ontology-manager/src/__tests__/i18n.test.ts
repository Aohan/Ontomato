import { describe, expect, it } from "vitest";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import ja from "element-plus/es/locale/lang/ja";
import { elementLocale, ontologyText, sharedText } from "../i18n";

describe("词条回退沿用原规则", () => {
  it("Manager 自有词条只有中英，其余语种回退英文", () => {
    expect(ontologyText("zh-CN", "backToGraph")).toBe("返回图谱");
    expect(ontologyText("en", "backToGraph")).toBe("Back to graph");
    expect(ontologyText("ja", "backToGraph")).toBe("Back to graph");
    expect(ontologyText("en", "assetSaved", { title: "Metric view" })).toBe("Metric view saved");
  });

  it("共用词条按原八语种取值；原来缺词的语种回退 zh-CN", () => {
    expect(sharedText("ja", "nav.dataBrowser")).not.toBe(sharedText("en", "nav.dataBrowser"));
    expect(sharedText("ja", "nav.metrics")).toBe(sharedText("zh-CN", "nav.metrics"));
    expect(sharedText("en", "dataBrowser.filterCount", { n: 2 })).toBe("Filter (2)");
  });

  it("Element Plus 语种映射与原 useLocale 相同，未知语种回退中文", () => {
    expect(elementLocale("ja")).toBe(ja);
    expect(elementLocale("ko")).toBe(zhCn);
  });
});
