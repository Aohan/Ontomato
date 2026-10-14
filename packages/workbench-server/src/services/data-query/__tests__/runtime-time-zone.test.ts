import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { formatTimeLabel, renderDataAsTable, type FieldDisplayPlan } from "../adapter";
import { installWorkbenchProduct } from "../../../product/installed";
import type { WorkbenchProduct } from "../../../product/types";

/**
 * Absolute timestamp inputs are displayed in the process time zone, including both sides of a
 * daylight-saving change.
 */

const originalTz = process.env.TZ;

beforeAll(() => {
  installWorkbenchProduct({
    groupColumnHeader: "group",
    primaryDimensionHeaders: { exact: [], contains: [] },
  } as unknown as WorkbenchProduct);
});

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const displayIn = (tz: string, value: unknown) => {
  process.env.TZ = tz;
  return formatTimeLabel(value);
};

describe("query time display follows the process time zone", () => {
  it("renders one instant according to the deployed zone", () => {
    const instant = "2026-03-08T07:30:00Z";
    expect(displayIn("UTC", instant)).toBe("2026-03-08 07:30:00");
    expect(displayIn("Asia/Shanghai", instant)).toBe("2026-03-08 15:30:00");
    expect(displayIn("America/New_York", instant)).toBe("2026-03-08 03:30:00");
  });

  it("follows the daylight-saving offset instead of a fixed one", () => {
    // Both instants are 03:30 local in New York, one hour apart in UTC.
    expect(displayIn("America/New_York", "2026-03-08T07:30:00Z")).toBe("2026-03-08 03:30:00");
    expect(displayIn("America/New_York", "2026-11-01T08:30:00Z")).toBe("2026-11-01 03:30:00");
    expect(displayIn("Asia/Shanghai", "2026-03-08T07:30:00Z")).toBe("2026-03-08 15:30:00");
    expect(displayIn("Asia/Shanghai", "2026-11-01T08:30:00Z")).toBe("2026-11-01 16:30:00");
  });

  it("keeps the date-only rule for local midnight in the deployed zone", () => {
    const instant = "2026-03-09T04:00:00Z";
    expect(displayIn("America/New_York", instant)).toBe("2026-03-09");
    expect(displayIn("Asia/Shanghai", instant)).toBe("2026-03-09 12:00:00");
  });

  it("formats an epoch timestamp column through the runtime zone", () => {
    const plan: FieldDisplayPlan = { ts: { displayName: "ts", kind: "datetime" } };
    const rows = [{ ts: Date.parse("2026-03-08T07:30:00Z") }];
    process.env.TZ = "America/New_York";
    expect(renderDataAsTable(rows, plan)).toContain("2026-03-08 03:30:00");
    process.env.TZ = "Asia/Shanghai";
    expect(renderDataAsTable(rows, plan)).toContain("2026-03-08 15:30:00");
  });
});
