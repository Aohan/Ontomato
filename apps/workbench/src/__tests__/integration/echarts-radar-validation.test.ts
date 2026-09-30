import { describe, expect, it } from "vitest";

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// The skill script ships with the shared service package's skills/ resources, outside the package export surface; located from the package root and loaded directly.
const serverRoot = dirname(dirname(createRequire(import.meta.url).resolve("@ontomato/workbench-server")));
const { execute } = await import(
  pathToFileURL(join(serverRoot, "skills/executable/visualization/echarts/scripts/index.mjs")).href
);

const validData = [
  { equipment_type: "A", temperature: 30, vibration: 2, current: 10 },
  { equipment_type: "B", temperature: 35, vibration: 3, current: 12 },
];
const validIndicators = [{ name: "temperature" }, { name: "vibration" }, { name: "current" }];

async function render(overrides: Record<string, unknown> = {}) {
  return execute({
    data: validData,
    chartType: "radar",
    title: "Equipment health",
    seriesField: "equipment_type",
    indicators: validIndicators,
    ...overrides,
  });
}

describe("echarts radar validation", () => {
  it("rejects indicator fields that do not exist", async () => {
    const result = await render({
      indicators: [{ name: "temperature" }, { name: "vibration" }, { name: "missing" }],
    });
    expect(result.meta).toMatchObject({ error: true, reason: "radar_indicator_field_not_found" });
  });

  it("rejects data when all indicator values are non-numeric", async () => {
    const result = await render({
      data: [{ equipment_type: "A", temperature: "x", vibration: "", current: null }],
    });
    expect(result.meta).toMatchObject({
      error: true,
      reason: "radar_no_numeric_indicator_values",
    });
  });

  it("accepts valid numeric strings and field/name indicators", async () => {
    const result = await render({
      data: [{ equipment_type: "A", temperature: "30", vibration: "2", current: "10" }],
      indicators: [
        { field: "temperature", name: "Temperature" },
        { field: "vibration", name: "Vibration" },
        { field: "current", name: "Current" },
      ],
    });
    expect(result.meta?.error).toBeUndefined();
    expect(result.html).toContain("Equipment health");
  });
});
