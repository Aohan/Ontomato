import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installContentLayout,
  installRuntimeDefaults,
  installWorkbenchProduct,
} from "@ontomato/workbench-server";
import { installM3DiagnosticSupport } from "@ontomato/workbench-server/platform/diagnosis/observe/m3-support";
import { syncRuntimeDefaultResources } from "@ontomato/workbench-server/platform/runtime-defaults";
import { syncDefaultPrompts } from "@ontomato/workbench-server/core/prompts/loader";
import { runtimeDataDir } from "@ontomato/workbench-server/content/layout";
import { evaluateAnswer } from "@ontomato/workbench-server/platform/diagnosis/autotest/evaluation/answer-evaluator";
import { extractLogic } from "@ontomato/workbench-server/platform/diagnosis/observe/workspace-artifact/logic/index";
import { createServiceHealthTool } from "@ontomato/workbench-server/platform/diagnosis/observe/agent/tools/service-health-tool";
import { fetchBackendConfig } from "@ontomato/workbench-server/platform/diagnosis/observe/backend-config-fetcher";
import { renderDataAsTable } from "@ontomato/workbench-server/services/data-query/adapter";
import { WORKSPACE_DIRS } from "@ontomato/workbench-server/platform/diagnosis/observe/workspaces/store";
import { setLogSourceConfig } from "@ontomato/workbench-server/platform/diagnosis/observe/config";
import { resolveVisualizationData } from "@ontomato/workbench-server/services/chat/graph/utils/data-resolver";
import {
  QueryArtifactCache,
  createQueryArtifactRef,
  extractRowsFromQueryResult,
  resolveAnalysisData,
} from "@ontomato/workbench-server/services/chat/graph/utils/query-artifact-cache";
import { installModelAgentCatalog } from "@ontomato/workbench-server/logging/model-agents";
import { installWorkspaceArtifactText } from "@ontomato/workbench-server/platform/diagnosis/observe/workspace-artifact/artifact-text";
import { installCurrentDatasetRule, lastDatasetWithRows } from "@ontomato/workbench-server/services/chat/graph/utils/current-dataset";
import { installNoDataVisualization, noDataChart } from "@ontomato/workbench-server/services/chat/graph/nodes/visualization-no-data";
import {
  buildWorkspaceArtifact,
  toResponseSnapshotMarkdown,
} from "@ontomato/workbench-server/platform/diagnosis/observe/workspace-artifact/post-processor";
import {
  parseBackendAgentLlmJsonlLines,
  parseFrontendAgentLlmJsonlLines,
} from "@ontomato/workbench-server/platform/diagnosis/observe/workspace-artifact/agent-llm-transcript";
import { ossContentLayout } from "../content";
import { configureOssI18n } from "../i18n";
import { ossProduct } from "../product";
import { ossWorkspaceArtifactText } from "../workspace-artifact-text";
import { ossModelAgents } from "../model-agents";
import { ossRuntimeDefaults } from "../runtime-defaults";

// 本文件重依赖经 skill-loader 触达 core/skills/manifest 的模块级 tApp，
// 必须在 OSS 装配之后求值：先 configure，再动态导入（type import 保留静态）。
configureOssI18n();
const { createDataQueryExecuteTool } = await import(
  "@ontomato/workbench-server/platform/diagnosis/observe/agent/tools/data-query-execute-tool"
);

// open-source 应用真实装配下，两版各自保留的诊断与数据规则（P3A-S1：C1/C2/C5/C6/C8/C9，S2：C3/C4/C7/C10/C11）。
// 模型与 DataRAG / 运维接口是外部依赖，用替身；其余走真实实现与本版内容。
const mocks = vi.hoisted(() => ({
  modelOutput: "",
  modelCalls: [] as Array<Array<{ role: string; content: string }>>,
  upstream: {} as Record<string, unknown>,
  backend: undefined as undefined | (() => Response),
  chartInputs: [] as unknown[][],
}));

// 图表生成（技能匹配、模型规划与技能渲染）是外部副作用，用替身记录收到的数据并返回一张图。
vi.mock("@ontomato/workbench-server/services/charts/chart-generator", () => ({
  generateChartsFromCandidates: async (input: { candidates: Array<{ data: unknown[] }> }) => {
    mocks.chartInputs.push(input.candidates.map((candidate) => candidate.data));
    return { charts: [{ chartType: "bar", title: "Chart", skillId: "bar-skill", html: "<chart/>" }], diagnostics: [] };
  },
}));

// 与 createModel 的包装一样，按调用方给的 agentName 写真实 LLM 日志。
vi.mock("@ontomato/workbench-server/config/model-factory", async () => {
  const { startLlmLog } = await import("@ontomato/workbench-server/logging/llm-logger");
  return {
    createModel: (options: { agentName: string }) => ({
      invoke: async (messages: Array<{ role: string; content: string }>) => {
        mocks.modelCalls.push(messages);
        const result = { content: mocks.modelOutput };
        startLlmLog(options.agentName, messages).success(result);
        return result;
      },
    }),
  };
});

let runtimeRoot: string;

beforeAll(async () => {
  runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oss-rules-"));
  vi.stubEnv("ONTOMATO_LOG_DIR", path.join(runtimeRoot, "logs"));
  vi.stubEnv("APP_DEFAULT_LOCALE", "");
  vi.stubEnv("VITE_APP_DEFAULT_LOCALE", "");
  installContentLayout(ossContentLayout(runtimeRoot));
  installWorkbenchProduct(ossProduct);
  installModelAgentCatalog(ossModelAgents);
  installRuntimeDefaults(ossRuntimeDefaults);
  configureOssI18n();
  installWorkspaceArtifactText(ossWorkspaceArtifactText);
  installCurrentDatasetRule(lastDatasetWithRows);
  installNoDataVisualization(noDataChart);
  installM3DiagnosticSupport(null);
  await syncRuntimeDefaultResources();
  syncDefaultPrompts();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (mocks.backend) return mocks.backend();
      const endpoint = Object.keys(mocks.upstream).find((suffix) => String(url).endsWith(suffix));
      return Response.json(endpoint ? mocks.upstream[endpoint] : {});
    })
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

beforeEach(() => {
  mocks.modelCalls = [];
  mocks.upstream = {};
});

// 已采集好的工作区证据：后端 agent-llm 与本服务 LLM 记录、最终答案，走真实后处理落盘。
type LogRecords = Array<Record<string, unknown>>;
async function buildWorkspace(
  logs: { backend: LogRecords; frontend?: LogRecords },
  finalAnswer: string
): Promise<string> {
  const artifactDir = fs.mkdtempSync(path.join(runtimeRoot, "workspace-"));
  const rawLogs = path.join(artifactDir, WORKSPACE_DIRS.RAW_LOGS);
  fs.mkdirSync(rawLogs, { recursive: true });
  const jsonl = (records: LogRecords) => records.map((record) => `${JSON.stringify(record)}\n`).join("");
  fs.writeFileSync(path.join(rawLogs, "agent-llm.jsonl"), jsonl(logs.backend));
  fs.writeFileSync(path.join(rawLogs, "llm-calls.jsonl"), jsonl(logs.frontend ?? []));
  await buildWorkspaceArtifact({
    workspaceId: "w1",
    turnKey: "t1",
    artifactDir,
    metadata: { targetId: "w1", source: "manual", finalAnswer },
    records: [],
    backendSessions: [{ branch: "static", sessionId: "s1" }],
  });
  return artifactDir;
}

// 一轮后端调用：各角色消息（含缺 role 与未知 role）、未配对的工具返回、输出、工具调用与错误。
const PROMPT_RECORD = {
  sessionId: "s1-2-try-1",
  agentName: "QUESTION_SPLITER",
  round: 1,
  status: "error",
  messages: [
    { role: "system", text: "sys" },
    { role: "user", text: "ask" },
    { text: "no role" },
    { role: "developer", text: "dev" },
    { role: "tool", toolName: "fetch", toolCallId: "orphan", text: "rows" },
  ],
  output: { text: "answer", toolCalls: [{ id: "c1", name: "lookup", arguments: "{}" }] },
  error: "boom",
};

/** 提示词产物里的分段标记行：每段 BEGIN 紧跟同一标记的 END，返回各段 BEGIN 的标记部分。 */
function markerSections(markdown: string): string[] {
  const markers = markdown.split("\n").filter((line) => line.startsWith("-----"));
  const begins = markers.filter((_, index) => index % 2 === 0);
  expect(markers.filter((_, index) => index % 2 === 1)).toEqual(
    begins.map((line) => line.replace(/ BEGIN-----$/, " END-----"))
  );
  return begins.map((line) => line.replace(/^-----/, "").replace(/ BEGIN-----$/, ""));
}

// 当前请求的查询产物进真实 QueryArtifactCache，再由真实的分析数据解析与可视化节点消费。
async function runVisualization(datasets: Array<Record<string, unknown>>, configurable: Record<string, unknown> = {}) {
  const cache = new QueryArtifactCache();
  const queryArtifactRef = createQueryArtifactRef({ threadId: "thread-1", requestSeq: 3 });
  cache.setQueryResult(queryArtifactRef, { datasets });
  const state = {
    queryArtifactRef,
    threadId: "thread-1",
    userQuestion: "Plot the query results",
    plan: { steps: [{ type: "visualization", instruction: "Plot the query results" }] },
  } as never;
  const events: Array<Record<string, unknown>> = [];
  const config = {
    configurable: {
      queryArtifactCache: cache,
      domainId: "default",
      requestSeq: 3,
      onEvent: (event: Record<string, unknown>) => events.push(event),
      ...configurable,
    },
  };
  mocks.chartInputs = [];
  // 节点模块求值时读取 i18n 文案，须在本文件装配 i18n 之后加载。
  const { visualizationNode } = await import("@ontomato/workbench-server/services/chat/graph/nodes/visualization-node");
  const analysis = await resolveAnalysisData(state, config);
  const update = await visualizationNode(state, config);
  return { analysis, update, events, stored: cache.getVisualizationResult(update.visualizationArtifactRef) };
}

const ROWS = [{ category: "A", count: 3 }];
const WITH_ROWS_PLAN = { fields: [{ name: "count", label: "Count" }] };
const EMPTY_PLAN = { fields: [{ name: "none", label: "None" }] };

const ANSWER = { question: "q", judgment: "j", expectedAnswer: "3", finalAnswerSnapshot: "A is 3" };

describe("open-source edition rules", () => {
  it("C1: evaluates with this edition's prompt protocol only", async () => {
    mocks.modelOutput = "<test-answer>A is 3</test-answer>\n<analysis>ok</analysis>\n<verdict>correct</verdict>";
    const passed = await evaluateAnswer({ ...ANSWER, expectedLogic: "logic", actualLogicMarkdown: "actual" });
    expect(passed).toEqual({ passed: true, answerSummary: "A is 3", analysis: "ok" });
    const [system, user] = mocks.modelCalls[0];
    expect(system.content).toContain("<verdict>correct</verdict>");
    for (const tag of ["<standard-answer>", "<expected-query-logic>", "<actual-query-logic>"]) expect(user.content).toContain(tag);

    mocks.modelOutput = "<test-answer>A is 4</test-answer>\n<analysis>no</analysis>\n<verdict>incorrect</verdict>";
    expect((await evaluateAnswer(ANSWER)).passed).toBe(false);

    for (const output of ["<test-answer>A is 3</test-answer>\n<analysis>ok</analysis>", "<测试答案>A is 3</测试答案>\n<分析>ok</分析>\n<判定结果>正确</判定结果>"]) {
      mocks.modelOutput = output;
      expect(await evaluateAnswer(ANSWER)).toEqual({
        passed: undefined,
        error: "Failed to parse conclusion from LLM output",
      });
    }
  });

  it("C2: writes this edition's query-logic artifact that its knowledge and skills reference", async () => {
    const artifactDir = fs.mkdtempSync(path.join(runtimeRoot, "turn-"));
    fs.mkdirSync(path.join(artifactDir, "raw-logs"));
    fs.writeFileSync(
      path.join(artifactDir, "raw-logs", "diagnostic-events.jsonl"),
      [
        { eventType: "m3.query.succeeded", sessionId: "s1", payload: { problem: "Q1", mql: "M1", result: { json: { rows: [1] } } } },
        { eventType: "knowledge.verifier.completed", sessionId: "s1", payload: { problem: "K1", mqls: ["M2"] } },
        { eventType: "knowledge.verifier.completed", sessionId: "s1", payload: { mqls: ["M3-only"] } },
        { eventType: "question.split.completed", payload: { finalCalculation: "a+b" } },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n")
    );

    const { items, markdown } = await extractLogic({ artifactDir });

    expect(items.map((item) => item.problem)).toEqual(["K1"]);
    const written = path.join(artifactDir, "diagnostics", "query_logic.md");
    expect(fs.readFileSync(written, "utf8")).toBe(markdown);
    expect(fs.readdirSync(path.join(artifactDir, "diagnostics"))).toEqual(["query_logic.md"]);
    expect(markdown).not.toContain("MQLS");
    expect(markdown).not.toContain("M3");

    // 本版知识、技能与提示词里对查询逻辑产物的引用都指向实际写出的路径。
    const references: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.name.endsWith(".md")) {
          const text = fs.readFileSync(file, "utf8");
          references.push(...[...text.matchAll(/([^\s`'"(/]+)\/((?:mqls|query)_logic\.md)/g)].map((m) => m[0]));
        }
      }
    };
    for (const dir of ["knowledge", "skills", "prompts"]) walk(runtimeDataDir(dir));
    expect(references.length).toBeGreaterThan(0);
    expect(new Set(references)).toEqual(new Set([`${"diagnostics"}/${"query_logic.md"}`]));
  });

  it("C5: reports service health with this edition's groups and M3 rules", async () => {
    const tool = createServiceHealthTool({ current: "tk" });
    mocks.upstream["/maintenance/getserviceinfo"] = {
      m3: { services: [{ name: "m3-parser", status: "stopped" }, { name: "m3-core", status: "running" }] },
      backend: { service: { status: "stopped" } },
      frontend: { docker: { containers: [{ status: "running" }] } },
    };
    const report = (await tool.execute("call", {})).content[0].text as string;
    expect(report).toBe(
      [
        "# Service running status",
        "",
        "1 service(s) are not running (2 services in total):",
        "- [Backend] backend — Stopped",
        "",
        "## Service Details",
        "",
        "### Backend",
        "- backend: Stopped ⚠️",
        "",
        "### Frontend",
        "- frontend: Running",
      ].join("\n")
    );

    mocks.upstream["/maintenance/getserviceinfo"] = { m3: { services: [{ name: "m3-core", status: "running" }] } };
    const m3Only = (await tool.execute("call", {})).content[0].text as string;
    expect(m3Only).toBe(
      "The maintenance endpoint returned empty or unexpected format (does not contain a SystemStatus structure)."
    );
  });

  it("C6: assumes this edition's data adapter only when the backend config omits it", async () => {
    const configEndpoint = "/businessConfig/getConfigAndDesc";
    const withAdapter = (datarag: Record<string, unknown>) => {
      mocks.upstream[configEndpoint] = { success: true, data: { config: { ontomato: { datarag } } } };
    };

    withAdapter({});
    expect(await fetchBackendConfig("tk")).toEqual({ dataAdapter: "sql" });
    expect(createDataQueryExecuteTool({ current: "tk" }).description).toContain(
      "The current data adapter is sql; please submit sql dialect SQL"
    );

    const reference = path.join(runtimeDataDir("skills"), "query-flow-diagnosis", "references", "mql查询参考.md");
    fs.mkdirSync(path.dirname(reference), { recursive: true });
    fs.writeFileSync(reference, "reference");
    withAdapter({ dataAdapter: "m3" });
    await fetchBackendConfig("tk");
    const m3Description = createDataQueryExecuteTool({ current: "tk" }).description;
    expect(m3Description).toContain("The current data adapter is m3; please submit m3 dialect SQL");
    expect(m3Description).not.toContain("MQL");
    expect(m3Description).not.toContain(reference);

    withAdapter({ dataAdapter: "mysql" });
    expect(await fetchBackendConfig("tk")).toEqual({ dataAdapter: "mysql" });
    expect(createDataQueryExecuteTool({ current: "tk" }).description).toContain(
      "The current data adapter is mysql; please submit mysql dialect SQL"
    );
  });

  it("C8: orders primary dimension columns and names the group column by this edition's headers", () => {
    const headerRow = (table: string) => table.split("\n").find((line) => line.startsWith("|"));
    expect(headerRow(renderDataAsTable([{ label: "x", district: "d", 区县: "e" }], undefined, { locale: "en" }))).toBe(
      "| district | label | 区县 |"
    );
    expect(headerRow(renderDataAsTable([{ group: "g", 分组: "h" }], undefined, { locale: "en" }))).toBe("| Group | 分组 |");
  });

  it("C9: detects user-supplied data with this edition's keywords", async () => {
    mocks.modelOutput = '[{"x":1}]';
    expect((await resolveVisualizationData("value option", null, undefined)).source).toBe("user_provided");
    expect((await resolveVisualizationData("数据 选项", null, undefined)).source).toBe("mock_generated");
  });

  it("C3: logs model agents under this edition's names and explains them with the same catalog", async () => {
    // agentName 是持久化标识，不随默认语言变化。
    vi.stubEnv("APP_DEFAULT_LOCALE", "zh-CN");
    const llmLog = path.join(runtimeRoot, "logs", ossProduct.llmLogFileName);
    fs.rmSync(llmLog, { force: true });
    mocks.modelOutput = "<test-answer>A is 3</test-answer>\n<analysis>ok</analysis>\n<verdict>correct</verdict>";
    await evaluateAnswer(ANSWER);
    mocks.modelOutput = '[{"x":1}]';
    await resolveVisualizationData("value option", null, undefined);

    const lines = fs.readFileSync(llmLog, "utf8").split("\n").filter(Boolean);
    expect(lines.map((line) => JSON.parse(line).agentName)).toEqual(["Evaluation-Answer", "Standard Data Query-DataResolver"]);
    const logged = (agentName: string, index: number) => JSON.stringify({ agentName, turnKey: `t${index}` });
    const explain = (records: string[], parse = parseFrontendAgentLlmJsonlLines) =>
      Object.fromEntries(parse(records).conversations.map((c) => [c.meta.agentName, c.displayName]));
    expect(explain(lines)).toEqual({ "Evaluation-Answer": "3.8 Auto Evaluator", "Standard Data Query-DataResolver": "3.20 Data Resolver" });

    // 未改名的固定名、历史名按本版目录解释；没有显示名的角色和另一版的名字按原名显示。
    const fixed = { "API-TitleGenerator": "3.1 Title Generator", "TaskPlanner": "1.1 Task Planner", "Standard Data Query-Reply": "Standard Data Query-Reply", "评测-答案": "评测-答案" };
    expect(explain(Object.keys(fixed).map(logged))).toEqual(fixed);
    const backend = { "QUESTION_SPLITER": "2.1 Question Analyzer", "DSL_COOKER": "2.2 DSL Generator", "UNKNOWN_AGENT": "UNKNOWN_AGENT" };
    expect(explain(Object.keys(backend).map(logged), parseBackendAgentLlmJsonlLines)).toEqual(backend);
    vi.stubEnv("APP_DEFAULT_LOCALE", "");
  });

  it("C4: writes prompt artifacts with this edition's section markers and sub-query file name", async () => {
    const artifactDir = await buildWorkspace({ backend: [PROMPT_RECORD] }, "done");
    const files = fs.readdirSync(path.join(artifactDir, "prompts"));
    expect(files).toEqual(["2.1 Question Analyzer-subquery2-try-1-001.md"]);
    const markdown = fs.readFileSync(path.join(artifactDir, "prompts", files[0]), "utf8");
    expect(markerSections(markdown)).toEqual([
      "System Prompt",
      "User Prompt",
      "Message role=unknown",
      "Message role=developer",
      "Tool Return name=fetch id=orphan",
      "LLM Output",
      expect.stringMatching(/^Tool Call /),
      "Message type=error",
    ]);
  });

  it("C7: rewrites folded table summaries in the response snapshot by this edition's rule", async () => {
    const snapshotOf = async (locale: string) => {
      const table = renderDataAsTable([{ v: 1 }, { v: 2 }, { v: 3 }], undefined, { locale, maxRows: 1 });
      const artifactDir = await buildWorkspace({ backend: [PROMPT_RECORD] }, table);
      return fs.readFileSync(path.join(artifactDir, "response.md"), "utf8");
    };
    // en 渲染文案是 `click to expand to view all`，本版原规则只认 `click to expand and view all`，按源保留原文。
    const snapshot = await snapshotOf("en");
    expect(snapshot).toContain("> 2 more rows, click to expand to view all (3 rows total)");
    expect(snapshot).not.toContain("| 2 |");
    expect(snapshot).not.toContain("<details");
    const matched = toResponseSnapshotMarkdown(
      '<details data-ai-table-details="1"><summary>2 more rows,click to expand and view all (3 rows total)</summary>\n| 2 |\n</details>'
    );
    expect(matched).toEqual({ content: "\n\n> 2 more rowsnot written to snapshot (3 rows total)\n", foldedTablesRemoved: 1 });
  });

  it("C7: classifies backend evidence by this edition's collector wording and failure rule", async () => {
    type WorkspaceInput = Parameters<typeof buildWorkspaceArtifact>[0];
    setLogSourceConfig({ backendNodes: [{ nodeId: "n1", baseUrl: "http://backend.test" }] });
    const session: WorkspaceInput["backendSessions"] = [{ branch: "static", sessionId: "s2", nodeId: "n1" }];
    const window = { minTs: Date.now() - 60_000, maxTs: Date.now(), turnRunning: false };
    const statusOf = async (
      backendSessions: WorkspaceInput["backendSessions"],
      backendTimeWindow: WorkspaceInput["backendTimeWindow"],
      respond: () => Response
    ) => {
      mocks.backend = respond;
      const artifactDir = fs.mkdtempSync(path.join(runtimeRoot, "evidence-"));
      await buildWorkspaceArtifact({
        workspaceId: "w2",
        turnKey: "t2",
        artifactDir,
        metadata: { targetId: "w2", source: "manual" },
        backendSessions,
        backendTimeWindow,
      });
      mocks.backend = undefined;
      const file = path.join(artifactDir, WORKSPACE_DIRS.DIAGNOSTICS, "post_process_status.json");
      const { items } = JSON.parse(fs.readFileSync(file, "utf8"));
      return ["backend_agent_llm", "backend_diagnostic_events", "backend_log"].map((key) => [
        items[key].status,
        items[key].message,
      ]);
    };

    // 取回失败：后端返回 404，错误详情里没有失败词，只能靠本版说明文字判定。
    const httpError = "Backend returned HTTP error 404: gone";
    expect(await statusOf(session, window, () => new Response("gone", { status: 404 }))).toEqual([
      ["failed", `s2@n1: ${"Failed to fetch agent-llm records: "}${httpError}`],
      ["failed", `s2@n1: ${"Failed to fetch diagnostic-events: "}${httpError}`],
      ["failed", `${"Failed to fetch the backend runtime log slice: "}n1: ${httpError}`],
    ]);
    // 取回成功但为空。
    expect(await statusOf(session, window, () => new Response(""))).toEqual([
      ["empty", "s2@n1: agent-llm records are empty: no backend LLM call records found for this sessionId"],
      ["empty", "s2@n1: diagnostic-events records are empty: no backend diagnostic events found for this sessionId"],
      ["empty", "backend.log is empty: no backend runtime logs found within this time window"],
    ]);
    // 没有后端会话与时间窗：会话类跳过，backend.log 的两条跳过说明以本版分隔符相连，不判为失败。
    const skipped = await statusOf([], undefined, () => new Response(""));
    expect(skipped.map(([status]) => status)).toEqual(["skipped", "skipped", "empty"]);
    expect(skipped[2][1]).toBe("No node located: the query record has no backend session; No backend runtime log time window found; backend.log slice skipped");
  });

  it("C4: prompt file references in this edition's content match files the writer produces", async () => {
    const backend = ["QUESTION_SPLITER", "DSL_COOKER", "TOOL_AND_PYTHON_CALCULATOR", "ABC_PROGRAMMER"];
    const frontend = ["taskPlanner", "conclusion", "fieldAdapter", "abcHarnessAnswer"] as const;
    const call = { round: 1, messages: [{ role: "user", text: "ask" }], output: { text: "answer" } };
    const artifactDir = await buildWorkspace(
      {
        backend: backend.map((agentName) => ({ ...call, sessionId: "s1", agentName })),
        frontend: frontend.map((role) => ({ ...call, turnKey: "t1", agentName: ossModelAgents.roles[role].agentName })),
      },
      "done"
    );
    const files = fs.readdirSync(path.join(artifactDir, WORKSPACE_DIRS.PROMPTS));

    const pattern = new RegExp(`${WORKSPACE_DIRS.PROMPTS}/([^\`]+?)-\\*\\.md`, "g");
    const references: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.name.endsWith(".md")) {
          references.push(...[...fs.readFileSync(file, "utf8").matchAll(pattern)].map((m) => m[1]));
        }
      }
    };
    for (const dir of ["knowledge", "skills", "prompts"]) walk(runtimeDataDir(dir));
    expect(references.length).toBeGreaterThan(0);
    const unmatched = references.filter(
      (name) => !files.some((file) => file.startsWith(`${name}-`) && file.endsWith(".md"))
    );
    expect(unmatched).toEqual([]);
  });

  it("C10/C11: current dataset selection and zero-row visualization follow this edition's rules", async () => {
    // [有数据, 空]：取最后一个有行的数据集，行与字段展示计划同源，走正常渲染。
    const mixed = [
      { subQuestion: "earlier", data: ROWS, fieldDisplayPlan: WITH_ROWS_PLAN },
      { subQuestion: "empty follow-up", data: [], fieldDisplayPlan: EMPTY_PLAN },
    ];
    expect(extractRowsFromQueryResult({ datasets: mixed })).toBe(ROWS);
    const withRows = await runVisualization(mixed);
    expect(withRows.analysis).toMatchObject({ data: ROWS, source: "current_query", fieldDisplayPlan: WITH_ROWS_PLAN });
    expect(mocks.chartInputs).toEqual([[ROWS]]);
    expect(withRows.stored?.result).toEqual({ html: "<chart/>", chartType: "bar", title: "Chart" });

    // 全空：取最后一个；不调用图表生成，写入“未生成图表”提示图。
    const empty = await runVisualization([{ data: [], fieldDisplayPlan: EMPTY_PLAN }]);
    expect(empty.analysis).toMatchObject({ data: [], source: "current_query", fieldDisplayPlan: EMPTY_PLAN });
    expect(mocks.chartInputs).toEqual([]);
    expect(empty.update).toEqual({ visualizationArtifactRef: "visualization:thread-1:3", events: [] });
    expect(empty.stored?.result).toMatchObject({ chartType: "none", title: "No chart generated" });
    expect(empty.stored?.result.html).toContain("<h2>No chart generated</h2><p>The query returned no rows for the selected conditions.</p>");
    expect(empty.stored?.thinkingState).toMatchObject({ status: "completed", headline: "No chart generated", tailLines: [] });
    expect(empty.stored?.thinking).toBe("No chart generated\nThe query returned no rows for the selected conditions.");
    const thinkingEvents = empty.events.filter((event) => event.type === "thinking_state");
    expect(thinkingEvents.at(-1)).toMatchObject({ node: "visualization" });

    // 原顺序：技能可用性检查在零数据处理之前。
    const noDomain = await runVisualization([{ data: [] }], { domainId: undefined });
    expect(noDomain.update.errors).toHaveLength(1);
    expect(noDomain.stored).toBeUndefined();
  });
});
