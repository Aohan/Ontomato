import { expect, it } from "vitest";
import { installWorkbenchContent } from "@ontomato/workbench-ui/content";
import { EchartsGenerator } from "@ontomato/workbench-ui/features/dashboard/components/utils/echartsGenerator";
import { workbenchContent } from "../../../web/src/workbench-content";

installWorkbenchContent(workbenchContent);

const reasons = (type: string) =>
  new EchartsGenerator().generateWithHealth(type, "t", {}, []).health.reasons;

// The public method generateWithHealth returns the original reason sentences for this edition's assembly; sentences shared by several charts carry each chart's name.
it("returns this edition's original health reasons", () => {
  expect(reasons("radar")).toEqual([
    "radar: radar.indicator is empty",
    "radar: series[0].data[0].value is empty",
    "radar: too few dimensions (≤2), the radar chart can hardly present a meaningful comparison",
  ]);
  expect(reasons("area-line")).toEqual([
    "area-line: xAxis.data is empty",
    "area-line: series[0].data is empty",
    "area-line: series[0].data is all zeros (ECharts often renders it blank",
  ]);
});
