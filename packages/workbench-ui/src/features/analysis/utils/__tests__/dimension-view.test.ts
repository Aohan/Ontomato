import { expect, it } from "vitest";
import {
  evidence,
  plan,
  presentation,
} from "@ontomato/contracts/__tests__/presentation-fixtures";
import { buildDimensionTree, dimensionStageStates } from "../dimension-view";

it("keeps the complete plan and the common query display fact, including failed and missing evidence", () => {
  const execution = {
    dataCount: 0,
    error: "cannot query",
    abcCodes: ["code"],
    qcState: { status: "completed" as const, steps: [] },
  };
  const tree = buildDimensionTree([
    plan(),
    evidence({
      questions: [
        { questionId: "q1", question: "sales", status: "failed", error: "cannot query", execution },
      ],
    }),
  ]);
  expect(tree[0].questions).toEqual([
    expect.objectContaining({ id: "q1", status: "failed", execution }),
    expect.objectContaining({ id: "q2", status: "pending" }),
  ]);
  expect(buildDimensionTree([])).toEqual([]);
});

it("interleaved chapter activity cannot complete collection, and cancellation marks the first unmet stage", () => {
  const data = presentation({
    activities: [
      plan(),
      evidence(),
      { ...evidence(), kind: "chapter", activityId: "chapter", seq: 3, questions: undefined },
    ],
  });
  expect(dimensionStageStates(data)).toEqual(["done", "active", "pending", "pending"]);
  data.runState.status = "cancelled";
  expect(dimensionStageStates(data)).toEqual(["done", "stopped", "pending", "pending"]);
  data.activities[1] = evidence({ status: "completed", questions: [] });
  expect(dimensionStageStates(data)).toEqual(["done", "done", "done", "stopped"]);
  data.activities[2].status = "cancelled";
  data.activities.push(
    {
      ...evidence(),
      activityId: "skill",
      kind: "skill",
      seq: 4,
      status: "completed",
      questions: undefined,
    },
    {
      ...evidence(),
      activityId: "chart",
      kind: "chart",
      seq: 5,
      status: "completed",
      questions: undefined,
    }
  );
  data.sections = [
    { sectionId: "d1", markdown: "body", order: 0, revision: 1, status: "success" },
    { sectionId: "summary", markdown: "unfinished summary", order: 1, revision: 2, status: "failed" },
  ];
  expect(dimensionStageStates(data)).toEqual(["done", "done", "done", "stopped"]);
  data.activities.find((a) => a.kind === "skill")!.status = "cancelled";
  expect(dimensionStageStates(data)).toEqual(["done", "done", "stopped", "pending"]);
});
