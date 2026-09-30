import { beforeEach, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import { createPinia, setActivePinia } from "pinia";
import AnalysisChatView from "../AnalysisChatView.vue";
import { useAnalysisStore, type TaskSession } from "../../stores/analysis";
import en from "../../../../locales/en";
import type { AnalysisAgent } from "@ontomato/contracts/analysis-agent";
import type { EgressMessage } from "@ontomato/contracts/agent-egress";
import type {
  AnalysisTaskDetail,
  AnalysisTaskRun,
} from "@ontomato/contracts/analysis-task";
import type {
  AnalysisActivity,
  AnalysisRunState,
  DeepAnalysisTaskPayload,
} from "@ontomato/contracts/analysis-presentation";
import type { Message, ResponseSnapshot } from "../../../../types/chat";
import { turnDiagnosisAccessKey } from "../../../diagnosis/access";

vi.mock("../../api", () => ({
  analysisAgentApi: {},
  analysisTaskApi: { getLoopSubagentTrace: vi.fn() },
  analysisReportApi: {},
  streamTaskExecution: vi.fn(() => () => {}),
  streamFollowUp: vi.fn(() => () => {}),
  streamFollowUpRun: vi.fn(() => () => {}),
  cancelDeepAnalysisRun: vi.fn(),
  cancelFollowUpRun: vi.fn(async () => ({ ok: true })),
}));

function activity(narrative: string): AnalysisActivity {
  return {
    activityId: `activity-${narrative}`,
    seq: 1,
    revision: 1,
    kind: "narrative",
    status: "completed",
    startedAt: 1,
    narrative,
  };
}

function runState(status: AnalysisRunState["status"], done: number): AnalysisRunState {
  return { status, revision: 1, progress: { done, label: "" } };
}

function execution(
  activities: AnalysisActivity[],
  patch: Partial<DeepAnalysisTaskPayload> = {}
): DeepAnalysisTaskPayload {
  return {
    executionMode: "loop",
    runState: runState("completed", activities.length),
    activities,
    sections: [],
    charts: [],
    chartDiagnostics: [],
    ...patch,
  };
}

function answerMessage(
  id: number,
  answer: string,
  narrative: string,
  patch: Partial<DeepAnalysisTaskPayload> = {},
  trace: EgressMessage[] = []
): Message {
  return {
    id,
    role: "assistant",
    content: answer,
    snapshot: {
      mode: "deep-analysis",
      status: "completed",
      source: "history",
      primaryText: answer,
      trace,
      deepAnalysis: execution([activity(narrative)], { finalAnswer: answer, ...patch }),
    },
  };
}

function agent(reportDeliverableEnabled: boolean): AnalysisAgent {
  return {
    id: "agent-1",
    name: "Harness",
    description: "",
    executionMode: "loop",
    reportDeliverableEnabled,
    summarizerPrompt: "",
    conclusionMakerPrompt: "",
    isEnabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function taskFixture(patch: Partial<AnalysisTaskDetail> = {}): AnalysisTaskDetail {
  return {
    id: "task-1",
    agentId: "agent-1",
    userId: "owner",
    name: "conversation-task",
    description: "",
    status: "completed",
    reportDeliverableEnabled: false,
    question: "task-question",
    scheduleEnabled: false,
    notifyOnComplete: false,
    triggerSource: "manual",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

function sessionFixture(
  messages: Message[],
  streamingSnapshot: ResponseSnapshot | null = null
): TaskSession {
  return {
    taskId: "task-1",
    agentId: "agent-1",
    threadId: "thread-1",
    taskName: "conversation-task",
    messages,
    input: "",
    isLoading: false,
    streamingSnapshot,
    stopRequested: false,
  };
}

function seed(options: {
  messages: Message[];
  streamingSnapshot?: ResponseSnapshot | null;
  report?: boolean;
  taskPatch?: Partial<AnalysisTaskDetail>;
  runs?: AnalysisTaskRun[];
  runIndex?: number;
}) {
  const store = useAnalysisStore();
  const report = options.report ?? false;
  store.agents = [agent(report)];
  store.selectedAgentId = "agent-1";
  store.tasks = [taskFixture({ reportDeliverableEnabled: report, ...options.taskPatch })];
  store.currentTaskId = "task-1";
  store.taskRuns = options.runs ?? [];
  store.taskRunIndex = options.runIndex ?? 0;
  store.sessions = {
    "task-1": sessionFixture(options.messages, options.streamingSnapshot ?? null),
  };
}

function streamingExecution(activities: AnalysisActivity[]): ResponseSnapshot {
  return {
    mode: "deep-analysis",
    status: "streaming",
    source: "live",
    primaryText: "",
    deepAnalysis: execution(activities, { runState: runState("running", 0) }),
  };
}

function render() {
  return mount(AnalysisChatView, {
    global: {
      plugins: [createI18n({ legacy: false, locale: "en", messages: { en } }), ElementPlus],
      stubs: { DeepAnalysisResult: true, QueryExecutionView: true },
      // The turn diagnosis entry is injected by the app; here permissions are not loaded, so the entry is hidden.
      provide: { [turnDiagnosisAccessKey as symbol]: { prepare: () => {}, visible: () => false } },
    },
  });
}

function occurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

function userTrace(text: string): EgressMessage {
  return { role: "user", content: [{ type: "text", text }] };
}

function toolCallTrace(name: string, args: Record<string, unknown>): EgressMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: `call-${name}`, name, arguments: args }],
  };
}

function toolResultTrace(toolName: string, text: string): EgressMessage {
  return {
    role: "toolResult",
    toolCallId: `call-${toolName}`,
    toolName,
    content: [{ type: "text", text }],
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

// Public surface under test: first-turn message layout; observable result: the user question shows before the system acknowledgement.
it("shows the user's question before the analysis acknowledgment", () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "user-analysis-question" },
      answerMessage(2, "analysis-answer", "analysis-activity"),
    ],
  });

  const rows = render().findAll(".chat-msg");
  expect(rows[0].classes()).toContain("user");
  expect(rows[0].text()).toContain("user-analysis-question");
  expect(rows[1].classes()).toContain("analysis-acknowledgment");
});

it("shows the run switcher below the user's question", () => {
  seed({
    report: true,
    messages: [
      { id: 1, role: "user", content: "user-analysis-question" },
      answerMessage(2, "analysis-answer", "analysis-activity"),
    ],
    runs: [
      { id: "run-1", status: "completed" },
      { id: "run-2", status: "completed" },
    ],
    runIndex: 1,
  });

  const children = render().find(".messages-inner").element.children;
  expect(children[0].classList).toContain("user");
  expect(children[1].classList).toContain("run-switcher-row");
  expect(children[2].classList).toContain("analysis-acknowledgment");
});

// Public surface under test: execution output consumed once per turn; observable result: both Q&A turns and both activities are present, with no repeated replies.
it("renders every turn's question, activities and reply instead of only the last turn", async () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "first-question" },
      answerMessage(2, "first-answer", "first-round-writing", {
        activities: [
          activity("first-round-writing"),
          {
            activityId: "activity-evidence",
            seq: 2,
            revision: 1,
            kind: "evidence",
            status: "completed",
            startedAt: 1,
            questions: [
              {
                questionId: "q-1",
                question: "data-query-question",
                status: "completed",
                execution: {},
              },
            ],
          },
        ],
      }),
      { id: 3, role: "user", content: "second-question" },
      answerMessage(4, "second-answer", "second-round-writing"),
    ],
  });
  const wrapper = render();
  const text = wrapper.text();

  expect(text).toContain("first-question");
  expect(text).toContain("second-question");
  expect(text).toContain("first-round-writing");
  expect(text).toContain("second-round-writing");
  // Once Node fills in question.execution in /turns, the existing QueryExecutionView picks up that execution fact.
  for (const header of wrapper.findAll(".loop-activity-header")) await header.trigger("click");
  expect(wrapper.find("query-execution-view-stub").exists()).toBe(true);
  expect(occurrences(text, "first-answer")).toBe(1);
  expect(occurrences(text, "second-answer")).toBe(1);
});

// Public surface under test: partial body of a cancelled turn and the streaming tail; observable result: the partial body stays without duplication and the streaming turn renders normally.
it("keeps a cancelled turn's partial answer while the next turn streams", () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "first-question" },
      answerMessage(2, "completed-partial-answer", "completed-round-writing", { runState: runState("cancelled", 1) }),
      { id: 3, role: "user", content: "second-question" },
    ],
    streamingSnapshot: streamingExecution([activity("in-progress-round-writing")]),
  });
  const text = render().text();

  expect(text).toContain("completed-partial-answer");
  expect(text).toContain("completed-round-writing");
  expect(text).toContain("in-progress-round-writing");
  expect(occurrences(text, "completed-partial-answer")).toBe(1);
});

// Public surface under test: streaming body of a standard follow-up; observable result: the body and typing tail appear in that turn.
it("shows the streaming carrier text for a standard follow-up turn", () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "report-question" },
      answerMessage(2, "report-reply", "report-round-activity"),
      { id: 3, role: "user", content: "follow-up-question" },
    ],
    streamingSnapshot: {
      mode: "standard",
      status: "streaming",
      source: "live",
      primaryText: "follow-up-streaming-body",
    },
  });
  const wrapper = render();

  expect(wrapper.text()).toContain("follow-up-streaming-body");
  expect(wrapper.find(".typing-cursor").exists()).toBe(true);
});

// Public surface under test: the authoritative source of per-turn replies; observable result: while the task row is still on the previous turn, its answer is not carried into the unfinished new turn.
it("keeps a finished turn's answer out of the next unfinished turn", () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "question-A" },
      answerMessage(2, "answer-A", "round-A-activity"),
      { id: 3, role: "user", content: "question-B" },
    ],
    streamingSnapshot: streamingExecution([activity("round-B-in-progress")]),
    taskPatch: { finalAnswer: "answer-A" },
  });
  const text = render().text();

  expect(text).toContain("question-A");
  expect(text).toContain("question-B");
  expect(text).toContain("round-B-in-progress");
  expect(occurrences(text, "answer-A")).toBe(1);
});

// Public surface under test: history run selection of report tasks; observable result: without a run snapshot the report body
// is not disguised as a chat message; the report view still renders the report body.
it("does not show a historical run's report body in the conversation view", () => {
  seed({
    report: true,
    messages: [
      { id: 1, role: "user", content: "current-question" },
      answerMessage(2, "current-answer", "current-round-activity"),
    ],
    runs: [
      { id: "run-1", status: "completed", resultReport: "first-run-body" },
      { id: "run-2", status: "completed", resultReport: "second-run-body" },
    ],
    runIndex: 0,
  });
  const text = render().text();

  expect(text).toContain("task-question");
  expect(text).not.toContain("first-run-body");
  expect(text).not.toContain("second-run-body");
  // Run records have no public messages, so no empty "messages and tools" panel should appear.
  expect(render().findAll(".message-trace-list")).toHaveLength(0);
});

// Public surface under test: per-turn public messages and tool results; observable result: expanding does not mix turns and internal thinking fields are never read.
it("does not leak partial report text from a cancelled run into chat", () => {
  const cancelledPayload = execution([activity("pre-cancel-activity")], {
    runState: runState("cancelled", 1),
    sections: [
      {
        sectionId: "report",
        order: 0,
        revision: 1,
        markdown: "pre-cancel-partial-report",
        status: "success",
      },
    ],
  });
  seed({
    report: true,
    messages: [],
    runs: [
      {
        id: "run-cancelled",
        status: "cancelled",
        resultReport: "pre-cancel-partial-report",
        snapshot: {
          mode: "deep-analysis",
          status: "failed",
          source: "history",
          primaryText: "pre-cancel-partial-report",
          deepAnalysis: cancelledPayload,
        },
      },
      { id: "run-current", status: "completed", resultReport: "current-report" },
    ],
    runIndex: 0,
  });

  const text = render().text();
  expect(text).toContain("pre-cancel-activity");
  expect(text).not.toContain("pre-cancel-partial-report");
});

it("keeps each turn's messages and tool results inside its own expandable trace", async () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "first-question" },
      answerMessage(2, "first-answer", "first-round-writing", {}, [
        userTrace("first-question"),
        userTrace("[Orders](https://example.com/orders) submitted"),
        userTrace('{"sku":"SKU42","qty":3}'),
        userTrace('<img src=x onerror="alert(1)">'),
        toolCallTrace("orders_query", { region: "north" }),
        toolResultTrace("orders_query", "orders-result-A"),
        { ...userTrace("hidden-message"), thinking: "internal-thinking-A" } as unknown as EgressMessage,
      ]),
      { id: 3, role: "user", content: "second-question" },
      answerMessage(4, "second-answer", "second-round-writing", {}, [
        toolCallTrace("stock_query", { sku: "SKU42" }),
        toolResultTrace("stock_query", "stock-result-B"),
      ]),
    ],
  });
  const wrapper = render();
  const toggles = wrapper.findAll(".message-trace-list .loop-trace-toggle");

  expect(toggles).toHaveLength(2);
  expect(wrapper.text()).not.toContain("orders-result-A");
  expect(wrapper.text()).not.toContain("internal-thinking-A");

  await toggles[0].trigger("click");
  expect(wrapper.text()).toContain("orders_query");
  expect(wrapper.text()).toContain("orders-result-A");
  expect(wrapper.text()).not.toContain("stock_query");
  expect(wrapper.text()).not.toContain("stock-result-B");
  expect(wrapper.text()).not.toContain("internal-thinking-A");
  // Per-turn public messages reuse the old safe renderer: Markdown links and JSON code blocks are kept and raw HTML is not executed.
  expect(wrapper.find('.loop-trace-text a[href="https://example.com/orders"]').exists()).toBe(true);
  const codeBlock = wrapper.find(".loop-trace-text pre code");
  expect(codeBlock.exists()).toBe(true);
  expect(codeBlock.text()).toContain('"sku"');
  expect(wrapper.find(".loop-trace-text img").exists()).toBe(false);
  expect(wrapper.text()).toContain("onerror");

  await toggles[1].trigger("click");
  expect(wrapper.text()).toContain("stock_query");
  expect(wrapper.text()).toContain("stock-result-B");
  expect(occurrences(wrapper.text(), "orders-result-A")).toBe(1);
  expect(occurrences(wrapper.text(), "stock-result-B")).toBe(1);
});

// Public surface under test: a regular continuous session does not switch by run history; observable result: all turns and activities stay present,
// the unfinished turn's streaming tail is still visible, and the "can continue" flag the store gives the input is true.
it("keeps every turn visible for a regular conversation with run history", () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "first-question" },
      answerMessage(2, "first-answer", "first-round-writing"),
      { id: 3, role: "user", content: "second-question" },
      answerMessage(4, "second-answer", "second-round-writing"),
      { id: 5, role: "user", content: "third-question" },
    ],
    streamingSnapshot: streamingExecution([activity("third-round-in-progress")]),
    runs: [
      { id: "run-1", status: "completed", resultReport: "first-run-body" },
      { id: "run-2", status: "completed", resultReport: "second-run-body" },
    ],
    runIndex: 0,
  });
  const store = useAnalysisStore();
  const wrapper = render();
  const text = wrapper.text();

  expect(text).toContain("first-question");
  expect(text).toContain("second-question");
  expect(text).toContain("first-round-writing");
  expect(text).toContain("second-round-writing");
  expect(text).toContain("third-question");
  expect(text).toContain("third-round-in-progress");
  expect(store.isSelectedLatestRun).toBe(true);
  expect(store.displayStreamingSnapshot?.mode).toBe("deep-analysis");
  store.sessions["task-1"].isLoading = true;
  expect(store.displayIsLoading).toBe(true);
  expect(text).not.toContain("first-run-body");
  expect(wrapper.find(".typing-cursor, .streaming-dots").exists()).toBe(false);
});

// Public surface under test: one report-task execution plus a standard follow-up; observable result: the report body stays in the report view and the follow-up renders as-is.
it("keeps one execution block plus standard follow-up turns for a report task", () => {
  seed({
    report: true,
    messages: [
      { id: 1, role: "user", content: "report-question" },
      answerMessage(2, "report-body-ABC", "report-round-activity", {
        sections: [{ sectionId: "s1", order: 0, revision: 1, markdown: "report-body-ABC" }],
      }),
      { id: 3, role: "user", content: "follow-up-question" },
      {
        id: 4,
        role: "assistant",
        content: "follow-up-answer",
        snapshot: {
          mode: "standard",
          status: "completed",
          source: "history",
          primaryText: "follow-up-answer",
        },
      },
    ],
  });
  const wrapper = render();
  const text = wrapper.text();

  expect(text).toContain("report-question");
  expect(text).toContain("report-round-activity");
  expect(wrapper.find(".follow-up-divider").exists()).toBe(true);
  expect(text).toContain("follow-up-question");
  expect(text).toContain("follow-up-answer");
  expect(text).not.toContain("report-body-ABC");
});
