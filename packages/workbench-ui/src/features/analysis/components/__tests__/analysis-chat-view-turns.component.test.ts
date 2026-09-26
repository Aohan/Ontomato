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
    name: "会话",
    description: "",
    status: "completed",
    reportDeliverableEnabled: false,
    question: "任务问题",
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
    taskName: "会话",
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
      // 回合诊断入口由装配注入；原企业用例下权限未加载，入口不显示。
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

// 被测公开面：首轮消息布局；可观察结果：用户问题先于系统受理确认显示。
it("shows the user's question before the analysis acknowledgment", () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "用户分析问题" },
      answerMessage(2, "分析回答", "分析活动"),
    ],
  });

  const rows = render().findAll(".chat-msg");
  expect(rows[0].classes()).toContain("user");
  expect(rows[0].text()).toContain("用户分析问题");
  expect(rows[1].classes()).toContain("analysis-acknowledgment");
});

it("shows the run switcher below the user's question", () => {
  seed({
    report: true,
    messages: [
      { id: 1, role: "user", content: "用户分析问题" },
      answerMessage(2, "分析回答", "分析活动"),
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

// 被测公开面：一轮一次的执行产物消费；可观察结果：两轮问答与两轮活动同时在位，回复不重复。
it("renders every turn's question, activities and reply instead of only the last turn", async () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "第一问" },
      answerMessage(2, "第一答", "第一轮写作", {
        activities: [
          activity("第一轮写作"),
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
                question: "问数问题",
                status: "completed",
                execution: {},
              },
            ],
          },
        ],
      }),
      { id: 3, role: "user", content: "第二问" },
      answerMessage(4, "第二答", "第二轮写作"),
    ],
  });
  const wrapper = render();
  const text = wrapper.text();

  expect(text).toContain("第一问");
  expect(text).toContain("第二问");
  expect(text).toContain("第一轮写作");
  expect(text).toContain("第二轮写作");
  // Node 在 /turns 中补齐 question.execution 后，现有 QueryExecutionView 即接入该执行事实。
  for (const header of wrapper.findAll(".loop-activity-header")) await header.trigger("click");
  expect(wrapper.find("query-execution-view-stub").exists()).toBe(true);
  expect(occurrences(text, "第一答")).toBe(1);
  expect(occurrences(text, "第二答")).toBe(1);
});

// 被测公开面：取消轮的部分正文与流式尾部；可观察结果：部分正文保留且不重复，流式轮照常呈现。
it("keeps a cancelled turn's partial answer while the next turn streams", () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "第一问" },
      answerMessage(2, "已完成的部分回答", "已完成轮写作", { runState: runState("cancelled", 1) }),
      { id: 3, role: "user", content: "第二问" },
    ],
    streamingSnapshot: streamingExecution([activity("进行中轮写作")]),
  });
  const text = render().text();

  expect(text).toContain("已完成的部分回答");
  expect(text).toContain("已完成轮写作");
  expect(text).toContain("进行中轮写作");
  expect(occurrences(text, "已完成的部分回答")).toBe(1);
});

// 被测公开面：standard 追问的流式正文；可观察结果：正文与打字尾部出现在该轮。
it("shows the streaming carrier text for a standard follow-up turn", () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "报告问题" },
      answerMessage(2, "报告答复", "报告轮活动"),
      { id: 3, role: "user", content: "追问问题" },
    ],
    streamingSnapshot: {
      mode: "standard",
      status: "streaming",
      source: "live",
      primaryText: "追问流式正文",
    },
  });
  const wrapper = render();

  expect(wrapper.text()).toContain("追问流式正文");
  expect(wrapper.find(".typing-cursor").exists()).toBe(true);
});

// 被测公开面：逐轮回复的权威来源；可观察结果：任务行仍停在上一轮时，答案不会带进未完成的新轮。
it("keeps a finished turn's answer out of the next unfinished turn", () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "问题A" },
      answerMessage(2, "答案A", "A轮活动"),
      { id: 3, role: "user", content: "问题B" },
    ],
    streamingSnapshot: streamingExecution([activity("B轮进行中")]),
    taskPatch: { finalAnswer: "答案A" },
  });
  const text = render().text();

  expect(text).toContain("问题A");
  expect(text).toContain("问题B");
  expect(text).toContain("B轮进行中");
  expect(occurrences(text, "答案A")).toBe(1);
});

// 被测公开面：报告任务的历史运行选择；可观察结果：没有运行快照时不把报告正文
// 伪装成对话消息；报告正文仍由报告视图负责呈现。
it("does not show a historical run's report body in the conversation view", () => {
  seed({
    report: true,
    messages: [
      { id: 1, role: "user", content: "当前问题" },
      answerMessage(2, "当前回答", "当前轮活动"),
    ],
    runs: [
      { id: "run-1", status: "completed", resultReport: "第一次运行正文" },
      { id: "run-2", status: "completed", resultReport: "第二次运行正文" },
    ],
    runIndex: 0,
  });
  const text = render().text();

  expect(text).toContain("任务问题");
  expect(text).not.toContain("第一次运行正文");
  expect(text).not.toContain("第二次运行正文");
  // 运行记录没有公开消息，不应出现空的"消息与工具"面板。
  expect(render().findAll(".message-trace-list")).toHaveLength(0);
});

// 被测公开面：每轮公开消息与工具结果；可观察结果：展开互不串轮，内部思考字段不被读取。
it("does not leak partial report text from a cancelled run into chat", () => {
  const cancelledPayload = execution([activity("取消前活动")], {
    runState: runState("cancelled", 1),
    sections: [
      {
        sectionId: "report",
        order: 0,
        revision: 1,
        markdown: "取消前部分报告",
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
        resultReport: "取消前部分报告",
        snapshot: {
          mode: "deep-analysis",
          status: "failed",
          source: "history",
          primaryText: "取消前部分报告",
          deepAnalysis: cancelledPayload,
        },
      },
      { id: "run-current", status: "completed", resultReport: "当前报告" },
    ],
    runIndex: 0,
  });

  const text = render().text();
  expect(text).toContain("取消前活动");
  expect(text).not.toContain("取消前部分报告");
});

it("keeps each turn's messages and tool results inside its own expandable trace", async () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "第一问" },
      answerMessage(2, "第一答", "第一轮写作", {}, [
        userTrace("第一问"),
        userTrace("[订单](https://example.com/orders) 已提交"),
        userTrace('{"sku":"SKU42","qty":3}'),
        userTrace('<img src=x onerror="alert(1)">'),
        toolCallTrace("orders_query", { region: "north" }),
        toolResultTrace("orders_query", "订单结果甲"),
        { ...userTrace("隐藏消息"), thinking: "内部思考甲" } as unknown as EgressMessage,
      ]),
      { id: 3, role: "user", content: "第二问" },
      answerMessage(4, "第二答", "第二轮写作", {}, [
        toolCallTrace("stock_query", { sku: "SKU42" }),
        toolResultTrace("stock_query", "库存结果乙"),
      ]),
    ],
  });
  const wrapper = render();
  const toggles = wrapper.findAll(".message-trace-list .loop-trace-toggle");

  expect(toggles).toHaveLength(2);
  expect(wrapper.text()).not.toContain("订单结果甲");
  expect(wrapper.text()).not.toContain("内部思考甲");

  await toggles[0].trigger("click");
  expect(wrapper.text()).toContain("orders_query");
  expect(wrapper.text()).toContain("订单结果甲");
  expect(wrapper.text()).not.toContain("stock_query");
  expect(wrapper.text()).not.toContain("库存结果乙");
  expect(wrapper.text()).not.toContain("内部思考甲");
  // 每轮公开消息复用旧安全 renderer：Markdown 链接与 JSON 代码块保留，原始 HTML 不执行。
  expect(wrapper.find('.loop-trace-text a[href="https://example.com/orders"]').exists()).toBe(true);
  const codeBlock = wrapper.find(".loop-trace-text pre code");
  expect(codeBlock.exists()).toBe(true);
  expect(codeBlock.text()).toContain('"sku"');
  expect(wrapper.find(".loop-trace-text img").exists()).toBe(false);
  expect(wrapper.text()).toContain("onerror");

  await toggles[1].trigger("click");
  expect(wrapper.text()).toContain("stock_query");
  expect(wrapper.text()).toContain("库存结果乙");
  expect(occurrences(wrapper.text(), "订单结果甲")).toBe(1);
  expect(occurrences(wrapper.text(), "库存结果乙")).toBe(1);
});

// 被测公开面：常规连续会话不按运行历史切换；可观察结果：全部回合与活动始终在位，
// 未完成轮的流式尾部仍可见，且 store 提供给输入框的"可继续"标志为 true。
it("keeps every turn visible for a regular conversation with run history", () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "第一问" },
      answerMessage(2, "第一答", "第一轮写作"),
      { id: 3, role: "user", content: "第二问" },
      answerMessage(4, "第二答", "第二轮写作"),
      { id: 5, role: "user", content: "第三问" },
    ],
    streamingSnapshot: streamingExecution([activity("第三轮进行中")]),
    runs: [
      { id: "run-1", status: "completed", resultReport: "第一次运行正文" },
      { id: "run-2", status: "completed", resultReport: "第二次运行正文" },
    ],
    runIndex: 0,
  });
  const store = useAnalysisStore();
  const wrapper = render();
  const text = wrapper.text();

  expect(text).toContain("第一问");
  expect(text).toContain("第二问");
  expect(text).toContain("第一轮写作");
  expect(text).toContain("第二轮写作");
  expect(text).toContain("第三问");
  expect(text).toContain("第三轮进行中");
  expect(store.isSelectedLatestRun).toBe(true);
  expect(store.displayStreamingSnapshot?.mode).toBe("deep-analysis");
  store.sessions["task-1"].isLoading = true;
  expect(store.displayIsLoading).toBe(true);
  expect(text).not.toContain("第一次运行正文");
  expect(wrapper.find(".typing-cursor, .streaming-dots").exists()).toBe(false);
});

// 被测公开面：报告任务一轮执行 + 标准追问；可观察结果：报告正文留在报告视图，追问原样呈现。
it("keeps one execution block plus standard follow-up turns for a report task", () => {
  seed({
    report: true,
    messages: [
      { id: 1, role: "user", content: "报告问题" },
      answerMessage(2, "报告正文ABC", "报告轮活动", {
        sections: [{ sectionId: "s1", order: 0, revision: 1, markdown: "报告正文ABC" }],
      }),
      { id: 3, role: "user", content: "追问问题" },
      {
        id: 4,
        role: "assistant",
        content: "追问回答",
        snapshot: {
          mode: "standard",
          status: "completed",
          source: "history",
          primaryText: "追问回答",
        },
      },
    ],
  });
  const wrapper = render();
  const text = wrapper.text();

  expect(text).toContain("报告问题");
  expect(text).toContain("报告轮活动");
  expect(wrapper.find(".follow-up-divider").exists()).toBe(true);
  expect(text).toContain("追问问题");
  expect(text).toContain("追问回答");
  expect(text).not.toContain("报告正文ABC");
});
