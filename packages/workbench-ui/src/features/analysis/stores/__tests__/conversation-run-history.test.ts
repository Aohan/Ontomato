import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const listTaskPage = vi.fn();
const getTask = vi.fn();
const listRuns = vi.fn();
const createTask = vi.fn();
const executeTask = vi.fn();
const getTaskMessages = vi.fn();
const getTurns = vi.fn();
const continueConversation = vi.fn();
const streamTaskExecution = vi.fn();
const streamFollowUp = vi.fn();
const getEnabledAgents = vi.fn();

vi.mock("../../api", () => ({
  analysisAgentApi: { getEnabledAgents: () => getEnabledAgents() },
  analysisTaskApi: {
    listTaskPage: (...args: unknown[]) => listTaskPage(...args),
    getTask: (...args: unknown[]) => getTask(...args),
    listRuns: (...args: unknown[]) => listRuns(...args),
    createTask: (...args: unknown[]) => createTask(...args),
    executeTask: (...args: unknown[]) => executeTask(...args),
    getTaskMessages: (...args: unknown[]) => getTaskMessages(...args),
    getTurns: (...args: unknown[]) => getTurns(...args),
    continueConversation: (...args: unknown[]) => continueConversation(...args),
  },
  streamTaskExecution: (...args: unknown[]) => streamTaskExecution(...args),
  streamFollowUp: (...args: unknown[]) => streamFollowUp(...args),
  streamFollowUpRun: vi.fn(() => () => {}),
  cancelFollowUpRun: vi.fn(async () => ({ ok: true })),
  analysisReportApi: {},
}));

const { useAnalysisStore } = await import("../analysis");

const harnessAgent = {
  id: "harness",
  name: "Harness",
  description: "",
  executionMode: "loop",
  reportDeliverableEnabled: false,
  summarizerPrompt: "",
  conclusionMakerPrompt: "",
  isEnabled: true,
  createdAt: 1,
  updatedAt: 1,
};

const reportAgent = { ...harnessAgent, id: "report", reportDeliverableEnabled: true };

function sessionTask(patch: Record<string, unknown> = {}) {
  return {
    id: "saved",
    agentId: "harness",
    userId: "owner",
    name: "conversation-task",
    description: "",
    reportDeliverableEnabled: false,
    status: "completed",
    scheduleEnabled: false,
    notifyOnComplete: false,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  streamTaskExecution.mockReturnValue(() => {});
  getEnabledAgents.mockResolvedValue([harnessAgent, reportAgent]);
  listTaskPage.mockResolvedValue({ tasks: [], total: 0, limit: 50, offset: 0 });
  getTaskMessages.mockResolvedValue({ messages: [] });
  getTurns.mockResolvedValue([]);
  listRuns.mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
});

// Public surface under test: task list of a regular agent; observable result: only sessions without reports are listed, report tasks are not mixed in.
it("separates regular-agent conversations from report tasks", async () => {
  const store = useAnalysisStore();
  await store.loadAgents();
  await store.selectAgent("harness");
  expect(listTaskPage).toHaveBeenCalledWith(
    expect.objectContaining({ reportDeliverableEnabled: false })
  );
  listTaskPage.mockClear();
  await store.selectAgent("report");
  expect(listTaskPage).not.toHaveBeenCalledWith(
    expect.objectContaining({ reportDeliverableEnabled: false })
  );
});

// Public surface under test: first and later instructions of a regular session; observable result: the first creates the task, later ones go through /turns.
it("starts a conversation from the composer and continues it over /turns", async () => {
  vi.useFakeTimers();
  const created = sessionTask({ id: "new", status: "running" });
  createTask.mockResolvedValue(created);
  listTaskPage.mockResolvedValue({ tasks: [created], total: 1, limit: 50, offset: 0 });

  const store = useAnalysisStore();
  await store.loadAgents();
  await store.selectAgent("harness");
  store.updateActiveInput("check stock");
  await store.sendCurrentMessage();

  expect(createTask).toHaveBeenCalledWith(
    expect.objectContaining({ agentId: "harness", question: "check stock", executeImmediately: true })
  );
  expect(store.currentTask?.id).toBe("new");
  expect(streamTaskExecution).toHaveBeenCalledWith("new", expect.anything());
});

// Public surface under test: later instructions of a regular session; observable result: they go through /turns with the turn number the server accepted.
it("continues a saved conversation over /turns instead of the report follow-up endpoint", async () => {
  vi.useFakeTimers();
  const saved = sessionTask({ status: "completed" });
  listTaskPage.mockResolvedValue({ tasks: [saved], total: 1, limit: 50, offset: 0 });
  continueConversation.mockResolvedValue({ taskId: "saved", requestSeq: 7, status: "running" });

  const store = useAnalysisStore();
  await store.loadAgents();
  await store.selectAgent("harness");
  await store.openSession(saved as never);
  await store.sendMessage("saved", "continue");

  expect(continueConversation).toHaveBeenCalledWith("saved", "continue");
  expect(streamFollowUp).not.toHaveBeenCalled();
  expect(streamTaskExecution).toHaveBeenCalledWith(
    "saved",
    expect.objectContaining({ requestSeq: 7 })
  );
});

// Public surface under test: run history selection and report reading; observable result: the report body appears only in the report view,
// and the chat view does not fake an assistant message without a snapshot.
it("keeps a past run's report out of the conversation view", async () => {
  const task = sessionTask({ reportDeliverableEnabled: true, resultReport: "current-report" });
  listTaskPage.mockResolvedValue({ tasks: [task], total: 1, limit: 50, offset: 0 });
  getTask.mockResolvedValue(task);
  listRuns.mockResolvedValue([
    { id: "run-1", status: "failed", resultReport: "first-report" },
    { id: "run-2", status: "completed", resultReport: "second-report" },
  ]);

  const store = useAnalysisStore();
  await store.loadAgents();
  await store.selectTask(task as never, () => {});
  expect(store.taskRuns).toHaveLength(2);
  expect(store.isSelectedLatestRun).toBe(true);

  store.selectRun(0);
  expect(store.isSelectedLatestRun).toBe(false);
  expect(store.reportSections).toEqual([{ id: "run:run-1", content: "first-report" }]);
  expect(store.reportContent).toBe("first-report");
  expect(store.selectedRunMessages.at(-1)?.content).not.toBe("first-report");
});

// Public surface under test: turn identity of the replay read model; observable result: each turn of a regular session carries the server thread and accepted sequence number,
// which the diagnosis entry uses to locate the Turn.
it("carries the server thread and request sequence into replayed conversation turns", async () => {
  const saved = sessionTask({ threadId: "thread-9" });
  listTaskPage.mockResolvedValue({ tasks: [saved], total: 1, limit: 50, offset: 0 });
  getTask.mockResolvedValue(saved);
  getTurns.mockResolvedValue([
    {
      requestSeq: 4,
      userMessage: "check stock",
      status: "completed",
      messages: [],
      activities: [],
      finalAnswer: "stock is normal",
      charts: [],
      chartDiagnostics: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
  const store = useAnalysisStore();
  await store.loadAgents();
  await store.selectAgent("harness");
  await store.selectTask(saved as never, () => {});
  expect(store.displayMessages.at(-1)?.snapshot).toMatchObject({
    threadId: "thread-9",
    requestSeq: 4,
  });
});

// Public surface under test: replaying a past run; observable result: the selected old run locates its Turn by the task thread and that run's accepted sequence number.
it("identifies a selected past run by the task thread and that run's request sequence", async () => {
  const task = sessionTask({ reportDeliverableEnabled: true, threadId: "thread-r" });
  listTaskPage.mockResolvedValue({ tasks: [task], total: 1, limit: 50, offset: 0 });
  getTask.mockResolvedValue(task);
  listRuns.mockResolvedValue([
    { id: "run-1", status: "completed", requestSeq: 2, snapshot: { mode: "deep-analysis" } },
    { id: "run-2", status: "completed", requestSeq: 5, snapshot: { mode: "deep-analysis" } },
  ]);
  const store = useAnalysisStore();
  await store.loadAgents();
  await store.selectTask(task as never, () => {});
  store.selectRun(0);
  expect(store.selectedRunMessages.at(-1)?.snapshot).toMatchObject({
    threadId: "thread-r",
    requestSeq: 2,
  });
});

// Public surface under test: deliverable check of a failed task; observable result: an already generated body stays deliverable and is not cleared by the failed final state.
it("keeps generated report content available after a failure", async () => {
  const task = sessionTask({
    reportDeliverableEnabled: true,
    status: "failed",
    resultSummary: "partially generated report",
  });
  listTaskPage.mockResolvedValue({ tasks: [task], total: 1, limit: 50, offset: 0 });
  getTask.mockResolvedValue(task);

  const store = useAnalysisStore();
  await store.loadAgents();
  await store.selectTask(task as never, () => {});

  expect(store.hasReportArtifact).toBe(true);
  expect(store.reportContent).toBe("partially generated report");
});

// Public surface under test: rerun; observable result: execution restarts with the same task identity and returns to that task's session.
it("reruns a task in place and resets its session", async () => {
  vi.useFakeTimers();
  const task = sessionTask({ status: "completed", reportDeliverableEnabled: true });
  listTaskPage.mockResolvedValue({ tasks: [task], total: 1, limit: 50, offset: 0 });
  getTask.mockResolvedValue(task);
  executeTask.mockResolvedValue(undefined);

  const store = useAnalysisStore();
  await store.loadAgents();
  await store.loadTasks();
  await store.rerunTask(task as never);

  expect(executeTask).toHaveBeenCalledWith("saved");
  expect(store.currentTask?.status).toBe("running");
  expect(streamTaskExecution).toHaveBeenCalledWith("saved", expect.anything());
});
