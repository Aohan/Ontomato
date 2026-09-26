import { describe, expect, it } from "vitest";
import { computeCardDisplayData, formatCheckScore, tryParseCheckResult } from "../thinkingUtils";

describe("MetricView quality-check display", () => {
  it("accepts the MetricView quality-check object contract without steps", () => {
    expect(
      tryParseCheckResult({
        score: 86,
        fittedQuestion: "华东区客户健康度如何？",
        conclusion: "问题与指标视图匹配",
      })
    ).toEqual({
      steps: undefined,
      score: 86,
      fittedQuestion: "华东区客户健康度如何？",
      conclusion: "问题与指标视图匹配",
    });
  });

  it("displays the backend score on its 0-100 scale", () => {
    expect(formatCheckScore(86.4)).toBe(86);
  });

  it("keeps an invalid quality-check value diagnosable", () => {
    const invalid = { unexpected: true };
    const display = computeCardDisplayData({
      md: "# 客户健康度\n问题：客户健康度如何？\n回答：正常",
      originCheckResult: invalid,
    });

    expect(display.checkResult).toBeNull();
    expect(display.rawCheckResult).toBe(invalid);
  });
});
