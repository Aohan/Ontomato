import type { AnalysisActivity, DeepAnalysisTaskPayload } from "../analysis-presentation";

export function presentation(
  overrides: Partial<DeepAnalysisTaskPayload> = {}
): DeepAnalysisTaskPayload {
  return {
    executionMode: "dimension",
    runState: { status: "running", revision: 0, progress: { done: 12, total: 100, label: "取证" } },
    activities: [],
    sections: [],
    charts: [],
    chartDiagnostics: [],
    ...overrides,
  };
}

export function evidence(overrides: Partial<AnalysisActivity> = {}): AnalysisActivity {
  return {
    activityId: "evidence:d1",
    seq: 2,
    revision: 2,
    kind: "evidence",
    groupId: "d1",
    status: "running",
    startedAt: 1,
    questions: [
      { questionId: "q1", question: "销量", status: "running" },
      { questionId: "q2", question: "同比", status: "pending" },
    ],
    ...overrides,
  };
}

export function plan(): AnalysisActivity {
  return {
    activityId: "plan",
    seq: 1,
    revision: 1,
    kind: "plan",
    status: "completed",
    startedAt: 1,
    finishedAt: 2,
    dimensions: [
      {
        dimensionId: "d1",
        name: "地区",
        value: "华东",
        reason: "区域观察",
        questions: [
          { questionId: "q1", question: "销量" },
          { questionId: "q2", question: "同比" },
        ],
      },
    ],
  };
}
