// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  evidence,
  plan,
  presentation,
} from "@ontomato/contracts/__tests__/presentation-fixtures";
import type { AnalysisTaskDetail } from "@ontomato/contracts/analysis-task";
import type { AnalysisActivityStatus } from "@ontomato/contracts/analysis-presentation";
import type { ResponseSnapshot } from "@ontomato/workbench-ui/types/chat";
import { buildAnalysisTaskTerminalEvent } from "@ontomato/workbench-server/services/analysis-agent/task/events";
import en from "element-plus/es/locale/lang/en";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { installWorkbenchI18n } from "@ontomato/workbench-ui/i18n";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
import { installWorkbenchContent } from "@ontomato/workbench-ui/content";
import { anonymousAuthHost } from "../../../web/src/auth";
import { workbenchContent } from "../../../web/src/workbench-content";
// The auth host, workbench content, and language that the store assembled by the OSS entry startWorkbenchWeb reads at call time.
installAuthHost(anonymousAuthHost);
installWorkbenchContent(workbenchContent);
installWorkbenchI18n({
  supported: ["en"],
  defaultLocale: "en",
  initialLocale: "en",
  switchEnabled: false,
  save: null,
  messages: { en: publicEn },
  elementLocale: () => en,
});
const getTaskMessages = vi.fn();
const streamTaskExecution = vi.fn();
vi.mock("@ontomato/workbench-ui/features/analysis/api", () => ({
  analysisTaskApi: { getTaskMessages: (...args: unknown[]) => getTaskMessages(...args) },
  streamTaskExecution: (...args: unknown[]) => streamTaskExecution(...args),
  streamFollowUp: vi.fn(() => () => {}),
  streamFollowUpRun: vi.fn(() => () => {}),
  cancelFollowUpRun: vi.fn(async () => ({ ok: true })),
}));
const { useAnalysisStore } = await import("@ontomato/workbench-ui/features/analysis/stores/analysis");
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  streamTaskExecution.mockReset().mockReturnValue(() => {});
});
afterEach(() => {
  vi.useRealTimers();
});

// Public surface under test: the same task's live session and /messages recovery; observable result: one shared read model and no extra trajectory requests.
it.each(["dimension", "loop"] as const)(
  "%s keeps the same terminal model after refreshing history",
  async (executionMode) => {
    let onEvent: (event: unknown) => void = () => {};
    streamTaskExecution.mockImplementation((_id, options) => {
      onEvent = options.onEvent;
      return () => {};
    });
    getTaskMessages.mockResolvedValue({ messages: [{ role: "user", content: "Question" }] });
    const task = {
      id: "t",
      agentId: "a",
      name: "Task",
      question: "Question",
      status: "running",
    } as any;
    const store = useAnalysisStore();
    await store.openSession(task);
    const activities =
      executionMode === "dimension"
        ? [plan(), evidence({ status: "completed" })]
        : [evidence({ status: "completed" })];
    for (const content of activities) onEvent({ type: "analysis_activity", content, timestamp: 1 });
    onEvent({
      type: "analysis_section",
      content: {
        sectionId: "report",
        order: 0,
        revision: 4,
        markdown: "Body",
        status: "success",
        mode: "replace",
        offset: 0,
      },
      timestamp: 4,
    });
    onEvent({
      type: "analysis_run_state",
      executionMode,
      content: {
        status: "completed",
        revision: 5,
        progress: {
          done: executionMode === "dimension" ? 100 : 1,
          ...(executionMode === "dimension" ? { total: 100 } : {}),
          label: "",
        },
      },
      timestamp: 5,
    });
    onEvent({
      type: "task_completed",
      taskId: "t",
      resultSummary: "Body",
      resultReport: "Body",
      timestamp: 6,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const live = store.sessions.t.messages.at(-1)!.snapshot!;
    expect(live.deepAnalysis).toMatchObject({
      executionMode,
      runState: { status: "completed" },
      activities,
      sections: [expect.objectContaining({ markdown: "Body" })],
    });
    getTaskMessages.mockResolvedValue({
      messages: [
        { role: "user", content: "Question" },
        { role: "assistant", content: live.primaryText, snapshot: { ...live, source: "history" } },
      ],
    });
    await store.openSession({ ...task, status: "completed" });
    const history = store.sessions.t.messages.at(-1)!.snapshot!;
    expect(history).toEqual({ ...live, source: "history" });
  }
);

const task: AnalysisTaskDetail = {
  id: "t",
  agentId: "a",
  userId: "u",
  name: "Task",
  question: "Question",
  description: "",
  status: "running",
  scheduleEnabled: false,
  notifyOnComplete: false,
  triggerSource: "manual",
  createdAt: 1,
  updatedAt: 2,
};

function taskSnapshot(status: AnalysisActivityStatus, revision = 10): ResponseSnapshot {
  const running = status === "running";
  return {
    mode: "deep-analysis",
    source: "history",
    status: running ? "streaming" : status === "completed" ? "completed" : "failed",
    primaryText: "Body",
    deepAnalysis: presentation({
      runState: {
        status,
        revision,
        progress: {
          done: running ? 45 : 100,
          total: 100,
          label: running ? "Collect metrics" : "Generate report",
        },
      },
      activities: [
        plan(),
        evidence({
          status,
          revision,
          finishedAt: running ? undefined : 20,
          questions: [{ questionId: "q1", question: "Sales", status }],
        }),
      ],
      sections: [
        {
          sectionId: "report",
          order: 0,
          revision,
          markdown: "Body",
          status: running ? undefined : status === "completed" ? "success" : "failed",
        },
      ],
      charts: [
        {
          chartId: running ? "draft-chart" : "final-chart",
          scopeId: "report",
          title: "Sales",
          chartType: "bar",
          sourceSubQuestion: "q1",
          html: "<div>chart</div>",
          skillId: "chart",
          dataCount: 1,
        },
      ],
      chartDiagnostics: running
        ? [
            {
              scopeId: "report",
              reason: "no_renderable_chart",
              message: "draft",
              severity: "info",
            },
          ]
        : [],
    }),
  };
}

function history(snapshot: ResponseSnapshot) {
  return {
    messages: [
      { role: "user", content: "Question" },
      { role: "assistant", content: snapshot.primaryText, snapshot },
    ],
  };
}

// The page leaves at 45% cached, the backend completes with an identical body; recovery must not leave stale activities, sections, or charts.
it.each(["retained session", "evicted session"])(
  "reopens a completed task over a running cache from a %s",
  async (cacheKind) => {
    vi.useFakeTimers();
    const store = useAnalysisStore();
    store.tasks = [task];
    store.currentTaskId = task.id;
    getTaskMessages.mockResolvedValue(history(taskSnapshot("running", 20)));
    await store.openSession(task);
    expect(store.taskProgressMap.t.progress).toBe(45);
    if (cacheKind === "evicted session") store.sessions.t.isLoading = false;
    store.closeSession(task.id);
    await vi.advanceTimersByTimeAsync(100);
    if (cacheKind === "evicted session") expect(store.sessions.t).toBeUndefined();

    // Terminal-state authority never depends on a revision greater than the local one, nor on the body having changed.
    const completed = taskSnapshot("completed", 10);
    getTaskMessages.mockResolvedValue(history(completed));
    await store.openSession({ ...task, status: "completed" });
    expect(store.sessions.t.streamingSnapshot).toBeNull();
    expect(store.sessions.t.isLoading).toBe(false);
    const restored = store.sessions.t.messages.at(-1)!.snapshot!;
    expect(restored).toEqual(completed);
    expect(
      restored.deepAnalysis!.activities.every((activity) => activity.status !== "running")
    ).toBe(true);
    expect(store.taskProgressMap.t.progress).toBe(100);
    expect(store.hasReportArtifact).toBe(true);
    expect(store.canCreatePpt).toBe(true);
    expect(store.isStreamingReport).toBe(false);
  }
);

// When the task has already ended, /stream emits only this lifecycle event; the client must use /messages to complete the same-body terminal state.
it.each(["completed", "failed", "cancelled"] as const)(
  "%s reconnect restores exactly the same model as reopening the page",
  async (status) => {
    let onEvent: (event: unknown) => void = () => {};
    streamTaskExecution.mockImplementation((_id, options) => {
      onEvent = options.onEvent;
      return () => {};
    });
    const store = useAnalysisStore();
    store.tasks = [task];
    store.currentTaskId = task.id;
    getTaskMessages.mockResolvedValue(history(taskSnapshot("running")));
    await store.openSession(task);
    store.closeSession(task.id);
    await store.openSession(task);
    const terminal = taskSnapshot(status, 30);
    getTaskMessages.mockResolvedValue(history(terminal));
    onEvent(
      buildAnalysisTaskTerminalEvent({
        taskId: task.id,
        status,
        resultSummary: "Body",
        resultReport: "Body",
      })
    );
    await vi.waitFor(() => {
      expect(store.sessions.t.messages.at(-1)?.snapshot).toEqual(terminal);
    });
    const reconnected = store.sessions.t.messages.at(-1)!.snapshot!;
    expect(
      store.sessions.t.messages.filter((message) => message.snapshot?.deepAnalysis)
    ).toHaveLength(1);
    expect(store.sessions.t.streamingSnapshot).toBeNull();
    expect(store.taskProgressMap.t.progress).toBe(100);
    await store.openSession({ ...task, status });
    expect(store.sessions.t.messages.at(-1)!.snapshot).toEqual(reconnected);
  }
);

it.each([9, 10, 11])("compares complete running snapshots by revision %s", async (revision) => {
  const store = useAnalysisStore();
  const local = taskSnapshot("running", 10);
  getTaskMessages.mockResolvedValue(history(local));
  await store.openSession(task);
  const remote = taskSnapshot("running", revision);
  remote.deepAnalysis!.runState.progress.done = 60;
  remote.deepAnalysis!.activities = [];
  remote.deepAnalysis!.charts = [];
  remote.deepAnalysis!.sections = [];
  getTaskMessages.mockResolvedValue(history(remote));
  await store.loadTaskHistory(task.id);
  expect(store.sessions.t.streamingSnapshot).toEqual(revision < 10 ? local : remote);
  expect(
    store.sessions.t.messages.filter((message) => message.snapshot?.deepAnalysis)
  ).toHaveLength(0);
});

it("replaces the task baseline while preserving an unfinished follow-up tail", async () => {
  const store = useAnalysisStore();
  getTaskMessages.mockResolvedValue(history(taskSnapshot("completed", 10)));
  await store.openSession({ ...task, status: "completed" });
  store.sessions.t.messages.push({ id: 99, role: "user", content: "Explain more" });
  const followUp: ResponseSnapshot = {
    mode: "standard",
    source: "live",
    status: "streaming",
    primaryText: "Follow-up draft",
  };
  store.sessions.t.streamingSnapshot = followUp;
  store.sessions.t.isLoading = true;
  const terminal = taskSnapshot("completed", 11);
  getTaskMessages.mockResolvedValue(history(terminal));
  await store.loadTaskHistory(task.id);
  expect(store.sessions.t.messages.map((message) => message.content)).toEqual([
    "Question",
    "Body",
    "Explain more",
  ]);
  expect(store.sessions.t.messages[1].snapshot).toEqual(terminal);
  expect(store.sessions.t.streamingSnapshot).toEqual(followUp);
  expect(store.sessions.t.isLoading).toBe(true);
});
