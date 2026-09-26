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
    name: "会话",
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

// 被测公开面：常规智能体的任务列表；可观察结果：只列无报告会话，不混入报告任务。
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

// 被测公开面：常规会话首条指令与后续指令；可观察结果：首条建任务、后续走 /turns。
it("starts a conversation from the composer and continues it over /turns", async () => {
  vi.useFakeTimers();
  const created = sessionTask({ id: "new", status: "running" });
  createTask.mockResolvedValue(created);
  listTaskPage.mockResolvedValue({ tasks: [created], total: 1, limit: 50, offset: 0 });

  const store = useAnalysisStore();
  await store.loadAgents();
  await store.selectAgent("harness");
  store.updateActiveInput("查库存");
  await store.sendCurrentMessage();

  expect(createTask).toHaveBeenCalledWith(
    expect.objectContaining({ agentId: "harness", question: "查库存", executeImmediately: true })
  );
  expect(store.currentTask?.id).toBe("new");
  expect(streamTaskExecution).toHaveBeenCalledWith("new", expect.anything());
});

// 被测公开面：常规会话后续指令；可观察结果：走 /turns 并带上服务端受理的回合号。
it("continues a saved conversation over /turns instead of the report follow-up endpoint", async () => {
  vi.useFakeTimers();
  const saved = sessionTask({ status: "completed" });
  listTaskPage.mockResolvedValue({ tasks: [saved], total: 1, limit: 50, offset: 0 });
  continueConversation.mockResolvedValue({ taskId: "saved", requestSeq: 7, status: "running" });

  const store = useAnalysisStore();
  await store.loadAgents();
  await store.selectAgent("harness");
  await store.openSession(saved as never);
  await store.sendMessage("saved", "继续");

  expect(continueConversation).toHaveBeenCalledWith("saved", "继续");
  expect(streamFollowUp).not.toHaveBeenCalled();
  expect(streamTaskExecution).toHaveBeenCalledWith(
    "saved",
    expect.objectContaining({ requestSeq: 7 })
  );
});

// 被测公开面：运行历史选择与报告读取；可观察结果：报告正文只在报告视图，
// 对话视图没有快照时不伪造 assistant 消息。
it("keeps a past run's report out of the conversation view", async () => {
  const task = sessionTask({ reportDeliverableEnabled: true, resultReport: "当前报告" });
  listTaskPage.mockResolvedValue({ tasks: [task], total: 1, limit: 50, offset: 0 });
  getTask.mockResolvedValue(task);
  listRuns.mockResolvedValue([
    { id: "run-1", status: "failed", resultReport: "第一次报告" },
    { id: "run-2", status: "completed", resultReport: "第二次报告" },
  ]);

  const store = useAnalysisStore();
  await store.loadAgents();
  await store.selectTask(task as never, () => {});
  expect(store.taskRuns).toHaveLength(2);
  expect(store.isSelectedLatestRun).toBe(true);

  store.selectRun(0);
  expect(store.isSelectedLatestRun).toBe(false);
  expect(store.reportSections).toEqual([{ id: "run:run-1", content: "第一次报告" }]);
  expect(store.reportContent).toBe("第一次报告");
  expect(store.selectedRunMessages.at(-1)?.content).not.toBe("第一次报告");
});

// 被测公开面：回看读模型的回合身份；可观察结果：常规会话各轮带服务端线程与受理序号，
// 诊断入口据此定位 Turn。
it("carries the server thread and request sequence into replayed conversation turns", async () => {
  const saved = sessionTask({ threadId: "thread-9" });
  listTaskPage.mockResolvedValue({ tasks: [saved], total: 1, limit: 50, offset: 0 });
  getTask.mockResolvedValue(saved);
  getTurns.mockResolvedValue([
    {
      requestSeq: 4,
      userMessage: "查库存",
      status: "completed",
      messages: [],
      activities: [],
      finalAnswer: "库存正常",
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

// 被测公开面：历史运行回看；可观察结果：选中的旧运行按任务线程与该运行的受理序号定位 Turn。
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

// 被测公开面：失败任务的交付件判定；可观察结果：已生成正文仍可交付，不因终态失败而清空。
it("keeps generated report content available after a failure", async () => {
  const task = sessionTask({
    reportDeliverableEnabled: true,
    status: "failed",
    resultSummary: "已生成的部分报告",
  });
  listTaskPage.mockResolvedValue({ tasks: [task], total: 1, limit: 50, offset: 0 });
  getTask.mockResolvedValue(task);

  const store = useAnalysisStore();
  await store.loadAgents();
  await store.selectTask(task as never, () => {});

  expect(store.hasReportArtifact).toBe(true);
  expect(store.reportContent).toBe("已生成的部分报告");
});

// 被测公开面：重跑；可观察结果：沿用同一任务身份重启执行并回到该任务的会话。
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
