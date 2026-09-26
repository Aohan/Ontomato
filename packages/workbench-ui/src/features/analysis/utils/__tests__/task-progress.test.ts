import { expect, it } from "vitest";
import { presentation } from "@ontomato/contracts/__tests__/presentation-fixtures";
import { buildTaskProgressMap } from "../taskProgress";
import type { AnalysisTaskDetail } from "@ontomato/contracts/analysis-task";

const task = { id: "t", status: "running" } as AnalysisTaskDetail;
const t = (key: string, params?: Record<string, unknown>) =>
  `${key}:${JSON.stringify(params || {})}`;
it("reads the backend percentage even when the task has no client activity counters", () => {
  const runState = {
    status: "running" as const,
    revision: 1,
    progress: { done: 83, total: 100, label: "正在写作" },
  };
  expect(buildTaskProgressMap([{ ...task, runState }], {}, t).t).toEqual({
    progress: 83,
    stageText: "正在写作",
  });
});
// 被测公开面：任务列表读模型；可观察结果：空 label 也不从百分比或活动补猜阶段。
it.each([0, 12, 70, 97, 100])("displays the backend label unchanged at %s percent", (done) => {
  const deepAnalysis = presentation({
    runState: { status: "running", revision: 1, progress: { done, total: 100, label: "" } },
  });
  expect(
    buildTaskProgressMap(
      [task],
      {
        t: {
          streamingSnapshot: {
            mode: "deep-analysis",
            status: "streaming",
            source: "live",
            primaryText: "",
            deepAnalysis,
          },
        },
      },
      t
    ).t
  ).toEqual({ progress: done, stageText: "" });
});
it("keeps a terminal snapshot ahead of a stale running list, without recalculating progress", () => {
  const data = presentation({
    runState: {
      status: "completed",
      revision: 9,
      progress: { done: 100, total: 100, label: "完成" },
    },
  });
  expect(
    buildTaskProgressMap(
      [task],
      {
        t: {
          messages: [
            {
              snapshot: {
                mode: "deep-analysis",
                status: "completed",
                source: "history",
                primaryText: "",
                deepAnalysis: data,
              },
            },
          ],
        },
      },
      t
    ).t.progress
  ).toBe(100);
});
it("shows the backend activity count and narrative without a loop percentage", () => {
  const runState = {
    status: "running" as const,
    revision: 1,
    progress: { done: 7, label: "核对趋势" },
  };
  expect(buildTaskProgressMap([{ ...task, executionMode: "loop", runState }], {}, t).t).toEqual({
    progress: undefined,
    stageText: 'analysis.loopProgress:{"done":7,"label":"核对趋势"}',
  });
});
