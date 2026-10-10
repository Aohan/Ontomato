import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getQuestionExecution = vi.fn();
vi.mock("../../api", () => ({
  analysisTaskApi: {
    getQuestionExecution: (...args: unknown[]) => getQuestionExecution(...args),
  },
}));

import DeepAnalysisResult from "../DeepAnalysisResult.vue";
import { MessageContent, QueryExecutionView } from "../../../query-view";
import { workbenchI18n } from "../../../../i18n";
import type {
  AnalysisActivity,
  AnalysisEvidenceQuestion,
} from "@ontomato/contracts/analysis-presentation";

const i18n = workbenchI18n();

/**
 * The report provenance entry and the standard data query entry see the same data query facts.
 *
 * Uses the same data query fact sample as the standard entry: the full answer is shown once, only by the execution view,
 * and failure notes, quality checks and table download are visible from the same facts; the question list and folding stay with this entry.
 */
const global = {
  plugins: [i18n],
  stubs: {
    "el-icon": true,
    "el-dialog": true,
    "el-table": true,
    "el-table-column": true,
    "el-tag": true,
  },
};

/** The same data query fact sample as the standard entry; assertions in both places must stay consistent. */
const EXECUTION: AnalysisEvidenceQuestion["execution"] = {
  fullContent: "Construction sites per town are as follows",
  markdownTable: "| Town | Sites |",
  dataCount: 12,
  thinkingSummary: "ABC decomposition complete",
  qcState: { status: "completed", steps: [], result: { conclusion: "Definition is correct" } },
  qcResult: { conclusion: "Definition is correct", score: 90, steps: [] },
};

const activities: AnalysisActivity[] = [
  {
    activityId: "plan",
    kind: "plan",
    seq: 1,
    revision: 1,
    status: "completed",
    startedAt: 1,
    dimensions: [
      {
        dimensionId: "dim-1",
        name: "By town",
        questions: [{ questionId: "q-1", question: "Construction sites per town" }],
      },
    ],
  },
  {
    activityId: "evidence",
    kind: "evidence",
    groupId: "dim-1",
    seq: 2,
    revision: 2,
    status: "completed",
    startedAt: 1,
    questions: [
      {
        questionId: "q-1",
        question: "Construction sites per town",
        status: "completed",
        execution: EXECUTION,
      },
    ],
  },
];

const render = () =>
  mount(DeepAnalysisResult, {
    props: { activities, executionScope: { taskId: "task-1" } },
    global,
  });

describe("report provenance entry", () => {
  it("hands the execution facts to the execution view after a sub-question is expanded", async () => {
    const w = render();
    // Nothing renders until expanded, matching the carrier shape where expanding shows this data query question and its query facts.
    expect(w.findComponent(QueryExecutionView).exists()).toBe(false);

    await w.find(".question-left").trigger("click");

    const view = w.findComponent(QueryExecutionView);
    expect(view.exists()).toBe(true);
    expect(view.props("facts")).toMatchObject({
      fullContent: "Construction sites per town are as follows",
      markdownTable: "| Town | Sites |",
    });
  });

  it("the same answer is shown only once: only fullContent is rendered", async () => {
    const w = render();
    await w.find(".question-left").trigger("click");

    const bodies = w.findAllComponents(MessageContent);
    // The data query body appears only once (the quality check conclusion is separate content).
    expect(bodies.filter((m) => m.props("content") === "Construction sites per town are as follows")).toHaveLength(1);
    expect(w.find(".data-preview").exists()).toBe(false);
  });
});

// Legacy chat-history deep-analysis snapshots carry inline facts and no task; they stay readable.
it("shows inline facts of a snapshot without a task and reads nothing", async () => {
  getQuestionExecution.mockReset();
  const w = mount(DeepAnalysisResult, { props: { activities }, global });
  await w.find(".question-left").trigger("click");
  await flushPromises();
  expect(w.findComponent(QueryExecutionView).props("facts")).toMatchObject({
    fullContent: "Construction sites per town are as follows",
  });
  expect(getQuestionExecution).not.toHaveBeenCalled();
});

/** A question whose query run was saved carries only its state and identity until expanded. */
describe("deferred query facts", () => {
  const deferred: AnalysisActivity[] = activities.map((activity) =>
    activity.kind === "evidence"
      ? {
          ...activity,
          questions: activity.questions!.map((question) => ({
            ...question,
            execution: { dataCount: 12, thinkingSummary: "ABC decomposition complete" },
            executionDeferred: true as const,
          })),
        }
      : activity
  );
  const mountDeferred = (executionScope: { taskId: string; runId?: string }) =>
    mount(DeepAnalysisResult, { props: { activities: deferred, executionScope }, global });

  beforeEach(() => getQuestionExecution.mockReset());

  it("reads the question's facts only when it is expanded, from the viewed run", async () => {
    getQuestionExecution.mockResolvedValue(EXECUTION);
    const w = mountDeferred({ taskId: "task-1", runId: "run-old" });
    await flushPromises();
    expect(getQuestionExecution).not.toHaveBeenCalled();

    await w.find(".question-left").trigger("click");
    await flushPromises();
    expect(getQuestionExecution).toHaveBeenCalledTimes(1);
    expect(getQuestionExecution).toHaveBeenCalledWith("task-1", "q-1", {
      runId: "run-old",
      requestSeq: undefined,
    });
    expect(w.findComponent(QueryExecutionView).props("facts")).toMatchObject({
      fullContent: "Construction sites per town are as follows",
    });
  });

  it("drops a late answer for a run the view has already left", async () => {
    let answerOld!: (facts: unknown) => void;
    getQuestionExecution
      .mockImplementationOnce(() => new Promise((resolve) => (answerOld = resolve)))
      .mockResolvedValueOnce({ ...EXECUTION, fullContent: "current run facts" });
    const w = mountDeferred({ taskId: "task-1", runId: "run-old" });
    await w.find(".question-left").trigger("click");
    await w.setProps({ executionScope: { taskId: "task-1" } });
    await flushPromises();
    answerOld({ ...EXECUTION, fullContent: "old run facts" });
    await flushPromises();
    expect(w.findComponent(QueryExecutionView).props("facts")).toMatchObject({
      fullContent: "current run facts",
    });
  });
});

/** The skill block reports real skills; a skill stage without entries is a placeholder. */
describe("skill execution block", () => {
  const skillStage = (skills: NonNullable<AnalysisActivity["skills"]>): AnalysisActivity => ({
    activityId: "skill",
    kind: "skill",
    seq: 3,
    revision: 3,
    status: "completed",
    startedAt: 1,
    skills,
  });
  const mountWith = (extra: AnalysisActivity[], status: "completed" | "cancelled" = "completed") =>
    mount(DeepAnalysisResult, {
      props: {
        activities: [...activities, ...extra],
        runState: { status, revision: 1, progress: { done: 100, label: "" } },
      },
      global,
    });

  it("is hidden for a completed or stopped run whose skill stage has no skills", () => {
    expect(mountWith([skillStage([])]).find(".skill-execution-status").exists()).toBe(false);
    const stopped = mountWith([skillStage([])], "cancelled");
    expect(stopped.find(".skill-execution-status").exists()).toBe(false);
    expect(stopped.find(".thinking-status.stopped").exists()).toBe(true);
  });

  it("reports real skills as before", () => {
    const w = mountWith([skillStage([{ skillId: "s1", action: "run", status: "completed" }])]);
    expect(w.find(".skill-status-item.complete").exists()).toBe(true);
  });
});
