import type { AnalysisActivity, DeepAnalysisTaskPayload } from "../analysis-presentation";

export function presentation(
  overrides: Partial<DeepAnalysisTaskPayload> = {}
): DeepAnalysisTaskPayload {
  return {
    executionMode: "dimension",
    runState: { status: "running", revision: 0, progress: { done: 12, total: 100, label: "Preuve" } },
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
      { questionId: "q1", question: "ventes", status: "running" },
      { questionId: "q2", question: "annuel", status: "pending" },
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
        name: "Région",
        value: "Est",
        reason: "observation régionale",
        questions: [
          { questionId: "q1", question: "ventes" },
          { questionId: "q2", question: "annuel" },
        ],
      },
    ],
  };
}
