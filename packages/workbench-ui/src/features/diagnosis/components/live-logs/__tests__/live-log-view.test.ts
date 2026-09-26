import { describe, expect, it } from "vitest";
import { appendRecentLogs, isLogViewAtBottom } from "../live-log-view";

describe("live log view", () => {
  it("follows only when the viewport is at the bottom", () => {
    expect(isLogViewAtBottom(null)).toBe(true);
    expect(isLogViewAtBottom({ scrollHeight: 100, scrollTop: 80, clientHeight: 20 })).toBe(true);
    expect(isLogViewAtBottom({ scrollHeight: 100, scrollTop: 78, clientHeight: 20 })).toBe(true);
    expect(isLogViewAtBottom({ scrollHeight: 100, scrollTop: 77, clientHeight: 20 })).toBe(false);
  });

  it("preserves arrival order and trims the display in one batch", () => {
    expect(appendRecentLogs([1, 2], [3], 3, 2)).toEqual([1, 2, 3]);
    expect(appendRecentLogs([1, 2], [3, 4], 3, 2)).toEqual([3, 4]);
  });
});
