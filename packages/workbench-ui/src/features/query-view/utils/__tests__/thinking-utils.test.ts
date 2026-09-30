import { describe, expect, it } from "vitest";
import { computeCardDisplayData, formatCheckScore, tryParseCheckResult } from "../thinkingUtils";

describe("MetricView quality-check display", () => {
  it("accepts the MetricView quality-check object contract without steps", () => {
    expect(
      tryParseCheckResult({
        score: 86,
        fittedQuestion: "How healthy are customers in the east region?",
        conclusion: "The question matches the metric view",
      })
    ).toEqual({
      steps: undefined,
      score: 86,
      fittedQuestion: "How healthy are customers in the east region?",
      conclusion: "The question matches the metric view",
    });
  });

  it("displays the backend score on its 0-100 scale", () => {
    expect(formatCheckScore(86.4)).toBe(86);
  });

  it("keeps an invalid quality-check value diagnosable", () => {
    const invalid = { unexpected: true };
    const display = computeCardDisplayData({
      md: "# Customer health\nQuestion: How healthy are customers?\nAnswer: normal",
      originCheckResult: invalid,
    });

    expect(display.checkResult).toBeNull();
    expect(display.rawCheckResult).toBe(invalid);
  });
});
