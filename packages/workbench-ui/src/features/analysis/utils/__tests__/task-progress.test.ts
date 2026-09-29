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
    progress: { done: 83, total: 100, label: "writing" },
  };
  expect(buildTaskProgressMap([{ ...task, runState }], {}, t).t).toEqual({
    progress: 83,
    stageText: "writing",
  });
});
// Public surface under test: task list read model; observable result: an empty label is never filled in by guessing the stage from the percentage or activity.
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
      progress: { done: 100, total: 100, label: "done" },
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
    progress: { done: 7, label: "checking trend" },
  };
  expect(buildTaskProgressMap([{ ...task, executionMode: "loop", runState }], {}, t).t).toEqual({
    progress: undefined,
    stageText: 'analysis.loopProgress:{"done":7,"label":"checking trend"}',
  });
});
