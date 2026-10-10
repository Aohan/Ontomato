import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeepAnalysisEmittedEvent } from "@ontomato/contracts/analysis-events";
import type { AnalysisEvidenceQuestion } from "@ontomato/contracts/analysis-presentation";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

/**
 * Both evidence paths publish a settled query only after its query run is persisted, and then carry
 * only state and identity; a failed save keeps the full facts inline and the question's outcome.
 * Doubles: the query executor and the query_runs write boundary.
 */
const io = vi.hoisted(() => ({
  saved: [] as string[],
  saveGate: null as Promise<void> | null,
  refuseSave: false,
}));

const RESULT = {
  status: "completed" as const,
  data: [{ town: "A", sites: 3 }],
  fullContent: "Construction sites per town are as follows",
  markdownTable: "| town | sites |",
  dsl: { from: "Site" },
  dataCount: 1,
};

vi.mock("../runtime/deep-analysis-tool", () => ({
  executeSubQuestionWithBranches: async () => ({ result: RESULT, pendingQualityCheck: undefined }),
}));

vi.mock("../../data-query/query-run-store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  upsertQueryRun: async (input: { sourceRef: string }) => {
    if (io.saveGate) await io.saveGate;
    if (io.refuseSave) throw new Error("synthetic query_runs refusal");
    io.saved.push(input.sourceRef);
  },
}));

vi.mock("../dimension/plan", () => ({
  persistAnalysisHotCard: vi.fn(),
  resolveAnalysisPlan: async (_ctx: unknown, store: { start: (...args: unknown[]) => void }) => {
    store.start("evidence", {
      activityId: "evidence:d1",
      groupId: "d1",
      questions: [{ questionId: "q1", question: "Sites per town", status: "pending" }],
    });
    return {
      agent: { id: "a", enabledVisualizationSkillIds: [], enabledSkillIds: [] },
      datasetSchema: "",
      hotMatchCard: null,
      plannedDimensions: [
        {
          dimensionId: "d1",
          dimensionName: "Town",
          dimensionValue: "all",
          subQuestions: [
            { id: "q1", dimensionId: "d1", dimensionName: "Town", dimensionValue: "all", subQuestion: "Sites per town" },
          ],
        },
      ],
    };
  },
}));

vi.mock("../dimension/report-generator", () => ({
  ReportGenerator: class {
    generateDimensionReportStream(): AsyncGenerator<never> {
      throw new Error("report generation is outside this test");
    }
  },
}));

vi.mock("../dimension/skill-executor", () => ({
  analysisSkillExecutor: { executeMultipleSkills: async () => [] },
}));
vi.mock("../../charts/chart-generator", () => ({
  generateChartsFromCandidates: async () => ({ charts: [], diagnostics: [] }),
}));

const { createDeepAnalysisArtifactStore } = await import("../task/artifacts");
const { assembleLoopEvidenceCapability } = await import("../loop/evidence");
const { runAnalysisStage } = await import("../dimension/execute");

const HEAVY = ["data", "datasets", "datasetPreviews", "fullContent", "markdownTable"];

/** Every settled q1 the store emitted, with whether its query run was already persisted then. */
function recordSettled(events: Array<{ question: AnalysisEvidenceQuestion; savedThen: boolean }>) {
  return (event: DeepAnalysisEmittedEvent) => {
    if (event.type !== "analysis_activity") return;
    const question = event.content.questions?.find(
      (q) => q.questionId === "q1" || q.question === "Sites per town"
    );
    if (question && question.status === "completed")
      events.push({ question, savedThen: io.saved.length > 0 });
  };
}

async function runDimension() {
  const settled: Array<{ question: AnalysisEvidenceQuestion; savedThen: boolean }> = [];
  const emit = recordSettled(settled);
  const store = createDeepAnalysisArtifactStore({ executionMode: "dimension", emit });
  await runAnalysisStage(
    {
      lateFacts: { register: () => {} } as never,
      userQuestion: "q",
      userId: "u",
      threadId: "thread-1",
      requestSeq: 3,
      agentId: "a",
      domainId: "d",
      token: "t",
      apiKey: "",
      summarizerPrompt: "",
      conclusionMakerPrompt: "",
      enabledSkillIds: [],
      enabledVisualizationSkillIds: [],
      sendEvent: emit,
    },
    store
  );
  return { settled, store };
}

async function runLoop() {
  const settled: Array<{ question: AnalysisEvidenceQuestion; savedThen: boolean }> = [];
  const store = createDeepAnalysisArtifactStore({ executionMode: "loop", emit: recordSettled(settled) });
  const capability = assembleLoopEvidenceCapability({
    threadId: "thread-1",
    requestSeq: 3,
    token: "t",
    apiKey: "",
    userId: "u",
    signal: new AbortController().signal,
    trajectory: store,
  });
  await capability.supervisorTool.execute("call-1", { questions: ["Sites per town"] });
  return { settled, store };
}

describe.each([
  ["dimension", runDimension],
  ["loop", runLoop],
])("%s evidence publication", (_mode, run) => {
  beforeAll(() => {
    configureI18n({
      defaultLocale: "en",
      languageSwitchEnabled: false,
      appTextLocale: "en",
      packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
    });
  });
  beforeEach(() => {
    io.saved = [];
    io.saveGate = null;
    io.refuseSave = false;
  });

  it("publishes the settled query only after its query run is saved, without result copies", async () => {
    let release!: () => void;
    io.saveGate = new Promise((resolve) => (release = resolve));
    const running = run();
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    const { settled, store } = await running;

    expect(settled.length).toBeGreaterThan(0);
    for (const { question, savedThen } of settled) {
      expect(savedThen).toBe(true);
      expect(question.executionDeferred).toBe(true);
      for (const key of HEAVY) expect(question.execution).not.toHaveProperty(key);
      expect(question.execution?.dataCount).toBe(1);
    }
    const stored = store
      .current()
      .activities.flatMap((activity) => activity.questions || [])
      .find((q) => q.status === "completed")!;
    for (const key of HEAVY) expect(stored.execution).not.toHaveProperty(key);
    expect(stored.executionDeferred).toBe(true);
  });

  it("keeps the full facts inline and the query's outcome when saving its run fails", async () => {
    io.refuseSave = true;
    const { settled } = await run();

    expect(settled.length).toBeGreaterThan(0);
    const last = settled.at(-1)!.question;
    expect(last.status).toBe("completed");
    expect(last.executionDeferred).toBeUndefined();
    expect(last.execution).toMatchObject({
      fullContent: RESULT.fullContent,
      markdownTable: RESULT.markdownTable,
      data: RESULT.data,
    });
  });
});
