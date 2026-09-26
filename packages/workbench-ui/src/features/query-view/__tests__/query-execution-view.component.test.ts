import { mount, type DOMWrapper, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import QueryExecutionView from "../components/QueryExecutionView.vue";
import MessageContent from "../components/MessageContent/index.vue";
import { workbenchI18n } from "../../../i18n";
import type { QueryExecutionFacts } from "../../../types/chat";

const i18n = workbenchI18n();

/**
 * Blueprint scenario: a single query's result is presented only by the body's tables — the dataset
 * name, row count, and data/DSL download aggregate onto the corresponding table, and the DSL view,
 * post-calculation program, and field lineage are details expanded on demand for the corresponding
 * result; real results without a body table are still presented as result entries. This mounts the
 * real components and asserts the actual rendered output and interactions with a real i18n
 * instance, rather than grepping component source code.
 */

const global = {
  plugins: [i18n],
  stubs: {
    "el-icon": { template: "<i><slot /></i>" },
    // The dialog title is the assertion target: it proves which dataset's details are open.
    "el-dialog": {
      props: ["title"],
      template: "<div><span class='dialog-title'>{{ title }}</span><slot /></div>",
    },
    // The lineage table content is not the assertion target of this case, so it is stubbed wholesale.
    "el-table": true,
    "el-table-column": true,
    "el-tag": true,
    // Subgraph rendering depends on G6 and backend metadata and is not the assertion target of this case.
    SubgraphView: true,
  },
};

const t = i18n.global.t;

async function clickButton(wrapper: VueWrapper | DOMWrapper<Element>, text: string) {
  const button = wrapper.findAll("button").find((item) => item.text().includes(text));
  expect(button, `Button not found: ${text}`).toBeTruthy();
  await button!.trigger("click");
}

const buttonLabels = (wrapper: VueWrapper | DOMWrapper<Element>) =>
  wrapper.findAll("button").map((item) => item.text());

/**
 * A programmatic two-level decomposition of two sub-questions: the body has one table each, and the
 * code and lineage correspond by dataset index. abcSubQuestions includes one extra failed
 * sub-question to prove the pairing is not guessed blindly from the sub-question array position.
 */
const MULTI: QueryExecutionFacts = {
  fullContent: [
    "## Data results",
    "",
    "### Construction sites by town",
    "",
    "| Town | Site Count |",
    "| --- | --- |",
    "| Renhe Town | 137 |",
    "",
    "### Town list",
    "",
    "| Town | Name |",
    "| --- | --- |",
    "| Renhe Town | A |",
  ].join("\n"),
  datasets: [
    {
      subQuestion: "Construction sites by town",
      data: [{ Town: "Renhe Town", "Site Count": 137 }],
      dsl: { problem: "stat" },
    },
    {
      subQuestion: "Town list",
      data: [{ Town: "Renhe Town", Name: "A" }],
      dsl: { problem: "list" },
    },
  ],
  abcSubQuestions: [
    "Sub-question with no output in the previous round",
    "Construction sites by town",
    "Town list",
  ],
  abcCodes: ["code-stat", "code-list"],
  abcOutKeyRefs: [[{ key: "k1", attrName: "Site Count" }], [{ key: "k2", attrName: "Name" }]],
  thinkingSummary: "ABC decomposition complete",
  thinkingState: { summary: "ABC won", status: "completed", branches: [] },
  qcState: { status: "completed", steps: [], result: { conclusion: "Definition correct" } },
  qcResult: { conclusion: "Definition correct", score: 90 },
  winner: "abc",
};

const render = (facts: QueryExecutionFacts) =>
  mount(QueryExecutionView, { props: { facts }, global });

describe("execution display view renders by facts", () => {
  it("removes the standalone data preview and ABC split blocks, presenting results only via body tables", () => {
    const w = render(MULTI);

    expect(w.find(".dataset-detail").exists()).toBe(false);
    expect(w.find(".abc-detail").exists()).toBe(false);
    // Each of the two datasets attaches to its body table, with no redundant duplicate list.
    expect(w.findAll(".table-section .result-dataset")).toHaveLength(2);
    expect(w.findAll(".unattached-results .result-dataset")).toHaveLength(0);
  });

  it("aggregates the real name and row count on the body tables", () => {
    const blocks = render(MULTI).findAll(".result-dataset");

    expect(blocks[0]!.text()).toContain("Construction sites by town");
    expect(blocks[0]!.text()).toContain(t("analysis.rowCountHint", { n: 1 }));
    expect(blocks[1]!.text()).toContain("Town list");
  });

  it("collapses details by default and only offers DSL view, code and lineage after expanding on demand", async () => {
    const w = render(MULTI);
    expect(w.findAll(".result-dataset-details")).toHaveLength(0);

    await clickButton(w.findAll(".result-dataset")[0]!, t("common.detail"));

    const details = w.findAll(".result-dataset-details");
    expect(details).toHaveLength(1);
    expect(details[0]!.text()).toContain(t("common.viewDsl"));
    expect(details[0]!.text()).toContain(t("common.code"));
    expect(details[0]!.text()).toContain(t("common.lineage"));
  });

  it("expanded details view that dataset's own DSL, code and lineage", async () => {
    const w = render(MULTI);
    const first = () => w.findAll(".result-dataset")[0]!;
    const second = () => w.findAll(".result-dataset")[1]!;

    await clickButton(first(), t("common.detail"));
    await clickButton(first(), t("common.viewDsl"));
    expect(first().find(".dsl-pre").text()).toContain("stat");

    await clickButton(first(), t("common.code"));
    expect(first().find(".code-pre").text()).toContain("code-stat");

    await clickButton(second(), t("common.detail"));
    await clickButton(second(), t("common.code"));
    expect(second().find(".code-pre").text()).toContain("code-list");

    await clickButton(second(), t("common.lineage"));
    expect(
      second()
        .findAll(".dialog-title")
        .map((node) => node.text())
    ).toContain(`${t("common.lineage")} - Town list`);
  });

  it("maps results to each table via the DSL-style sub-question description", () => {
    const w = render({
      fullContent: [
        "For <strong>«Construction sites by town»</strong> the results are as follows:",
        "",
        "| Town | Site Count |",
        "| --- | --- |",
        "| Renhe Town | 137 |",
      ].join("\n"),
      datasets: [
        {
          subQuestion: "Construction sites by town",
          data: [{ Town: "Renhe Town" }],
          dsl: { problem: "stat" },
        },
      ],
    });

    const block = w.find(".table-section .result-dataset");
    expect(block.exists()).toBe(true);
    expect(block.text()).toContain("Construction sites by town");
    expect(buttonLabels(block)).toContain(t("chat.downloadDsl"));
  });

  it("still maps each segment's table to its own dataset when subgraphs split the body into segments", async () => {
    const w = render({
      fullContent: [
        "### Dataset A",
        "",
        "| a |",
        "| --- |",
        "| 1 |",
        "",
        "```data-agent-subgraph",
        '{"subgraph":{"nodes":[]}}',
        "```",
        "",
        "### Dataset B",
        "",
        "| b |",
        "| --- |",
        "| 2 |",
        "",
        "```data-agent-subgraph",
        '{"subgraph":{"nodes":[]}}',
        "```",
        "",
        "### Dataset C",
        "",
        "| c |",
        "| --- |",
        "| 3 |",
      ].join("\n"),
      datasets: [
        { subQuestion: "Dataset A", data: [{ a: 1 }], dsl: { problem: "A" } },
        { subQuestion: "Dataset B", data: [{ b: 2 }], dsl: { problem: "B" } },
        { subQuestion: "Dataset C", data: [{ c: 3 }], dsl: { problem: "C" } },
      ],
    });

    const blocks = w.findAll(".table-section .result-dataset");
    expect(blocks.map((block) => block.text())).toEqual([
      expect.stringContaining("Dataset A"),
      expect.stringContaining("Dataset B"),
      expect.stringContaining("Dataset C"),
    ]);

    // Each segment's table id restarts from 0; mapping by object identity avoids attaching a later table to an earlier one.
    for (const [index, name] of ["A", "B", "C"].entries()) {
      await clickButton(blocks[index]!, t("common.detail"));
      await clickButton(blocks[index]!, t("common.viewDsl"));
      expect(blocks[index]!.find(".dsl-pre").text()).toContain(name);
    }
  });

  it("puts technical facts without datasets into a compact detail, without faking datasets or rebuilding split cards", async () => {
    const w = render({
      fullContent: "Historical result body",
      abcSubQuestions: ["Construction sites by town", "Town list"],
      abcDsls: [{ problem: "stat" }],
      abcCodes: ["code-stat", "code-list"],
      abcOutKeyRefs: [[{ key: "k1" }], []],
    });

    expect(w.find(".result-dataset").exists()).toBe(false);
    expect(w.find(".abc-detail").exists()).toBe(false);

    const panel = w.find(".result-technical");
    expect(panel.exists()).toBe(true);
    expect(panel.find(".result-technical-list").exists()).toBe(false);

    await clickButton(panel, t("common.detail"));
    const items = w.findAll(".result-technical-item");
    expect(items).toHaveLength(2);
    expect(items[0]!.text()).toContain(`${t("common.detail")} 1`);
    expect(items[1]!.text()).toContain(`${t("common.detail")} 2`);

    await clickButton(items[0]!, t("common.code"));
    expect(panel.find(".code-pre").text()).toContain("code-stat");
  });

  it("does not list technical details again when datasets exist", () => {
    expect(render(MULTI).find(".result-technical").exists()).toBe(false);
  });

  it("does not create an empty detail entry for datasets that produced no details", () => {
    const block = render({
      fullContent: "### Only one table\n\n| a |\n| --- |\n| 1 |",
      datasets: [{ subQuestion: "Only one table", data: [{ a: 1 }] }],
    }).find(".result-dataset");

    expect(block.exists()).toBe(true);
    expect(buttonLabels(block)).toContain(t("chat.downloadData"));
    expect(buttonLabels(block)).not.toContain(t("common.detail"));
  });

  it("still presents the real output as a result entry when there is no body but there is data", () => {
    const w = render({
      datasets: [{ subQuestion: "Data-only result", data: [{ x: 1 }], dsl: { problem: "only" } }],
      abcCodes: ["only-code"],
      abcOutKeyRefs: [[{ key: "k" }]],
    });

    const blocks = w.findAll(".result-dataset");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text()).toContain("Data-only result");
    expect(blocks[0]!.text()).toContain(t("analysis.rowCountHint", { n: 1 }));
    expect(w.findComponent(MessageContent).props("content")).toBe("");
  });

  it("keeps the name and details of a zero-row dataset, only losing downloadable data", () => {
    const block = render({
      fullContent: "No data",
      datasets: [{ subQuestion: "Empty result", data: [], dsl: { problem: "empty" } }],
      abcCodes: ["empty-code"],
      abcOutKeyRefs: [[{ key: "k" }]],
    }).find(".result-dataset");

    expect(block.exists()).toBe(true);
    expect(block.text()).toContain("Empty result");
    expect(block.text()).toContain(t("analysis.rowCountHint", { n: 0 }));
    expect(buttonLabels(block)).not.toContain(t("chat.downloadData"));
    expect(buttonLabels(block)).toContain(t("common.detail"));
  });

  it("keeps download and details in the result entry when the body table does not match a dataset", () => {
    const w = render({
      fullContent: "### Unmatched title\n\n| c |\n| --- |\n| 3 |",
      datasets: [
        { subQuestion: "Dataset A", data: [{ a: 1 }], dsl: { problem: "a" } },
        { subQuestion: "Dataset B", data: [{ b: 2 }] },
      ],
    });

    expect(w.findAll(".table-section .result-dataset")).toHaveLength(0);
    expect(w.findAll(".unattached-results .result-dataset")).toHaveLength(2);
  });

  it("passes the table's dashboard entry to the caller with the index ordered by datasets with rows", async () => {
    const w = mount(QueryExecutionView, {
      props: {
        facts: {
          fullContent: "### Has data\n\n| a |\n| --- |\n| 1 |",
          datasets: [
            { subQuestion: "Zero rows", data: [] },
            { subQuestion: "Has data", data: [{ a: 1 }] },
          ],
        },
        dashboardContext: { threadId: "thread-1", requestSeq: 0 },
      },
      global,
    });

    await clickButton(w.find(".table-section .result-dataset"), t("chat.addToDashboard"));

    expect(w.emitted("addToDashboard")).toEqual([
      [{ threadId: "thread-1", requestSeq: 0, datasetIndex: 0, datasetTitle: "Has data" }],
    ]);
  });

  it("does not offer the dashboard entry without dashboard context, but keeps download", () => {
    const w = render(MULTI);
    const labels = buttonLabels(w.findAll(".result-dataset")[0]!);

    expect(labels).toContain(t("chat.downloadData"));
    expect(labels).not.toContain(t("chat.addToDashboard"));
  });

  it("shows the same answer only once: only fullContent renders, with no extra preview card", () => {
    const w = render(MULTI);
    const bodies = w.findAllComponents(MessageContent);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.props("content")).toBe(MULTI.fullContent);
    expect(w.find(".data-preview").exists()).toBe(false);
    expect(w.text()).not.toContain("Preview omitted");
  });

  it("passes result datasets to the body table by the dataset itself", () => {
    const body = render(MULTI).findComponent(MessageContent);
    const datasets = body.props("resultDatasets")!;

    expect(datasets).toHaveLength(2);
    expect(datasets[0]).toMatchObject({
      title: "Construction sites by town",
      subQuestion: "Construction sites by town",
      code: "code-stat",
    });
    expect(datasets[1]).toMatchObject({ title: "Town list", code: "code-list" });
  });

  it("orders process first, body and result in the middle, and QC after the result", () => {
    const html = render(MULTI).html();

    const order = ["thinking-panel", "execution-body", "post-thinking-panel"].map((name) =>
      html.indexOf(`class="${name}"`)
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("renders the QC panel when QC is ready, with a parsed label rather than the raw key", () => {
    const w = render(MULTI);

    expect(w.text()).toContain(t("thinking.qcResult"));
    expect(w.text()).not.toContain("query.qcResult.label");
  });

  it("does not render the QC panel when QC is not ready, leaving other facts unaffected", () => {
    const w = render({ ...MULTI, qcState: undefined, qcResult: undefined });

    expect(w.text()).not.toContain(t("thinking.qcResult"));
    expect(w.find(".execution-body").exists()).toBe(true);
  });

  it("keeps the failure description and body when it fails with partial results", () => {
    const w = render({
      fullContent: "Partial body",
      error: "Query timed out",
      thinkingSummary: "Already decomposed",
    });

    expect(w.find(".execution-error").text()).toContain("Query timed out");
    expect(w.findComponent(MessageContent).props("content")).toBe("Partial body");
  });

  it("only shows the failure description when it fails with no body, without fabricating an empty body", () => {
    const w = render({ error: "Query timed out", thinkingSummary: "Already decomposed" });

    expect(w.find(".execution-error").text()).toContain("Query timed out");
    expect(w.findComponent(MessageContent).exists()).toBe(false);
  });

  it("truncates an over-long final error for display and shows a short error as-is", () => {
    const longError = `ABC Decomposition: ${"the complete failure reason returned by the backend".repeat(20)}; Dynamic Metrics Hot Data: recall failed`;
    const long = render({ error: longError, thinkingSummary: "Already decomposed" }).find(
      ".execution-error"
    );

    expect(long.text()).toBe(`${longError.slice(0, 160)}...`);
    expect(long.text()).not.toContain("Dynamic Metrics Hot Data: recall failed");

    const short = render({
      error: "ABC Decomposition: Query timed out",
      thinkingSummary: "Already decomposed",
    });
    expect(short.find(".execution-error").text()).toBe("ABC Decomposition: Query timed out");
  });

  it("does not show a failure description when there is no failure", () => {
    expect(render(MULTI).find(".execution-error").exists()).toBe(false);
  });

  it("places appended content in the body card, after the body", () => {
    const w = mount(QueryExecutionView, {
      props: { facts: { fullContent: "Body" } },
      slots: { appendix: "<div class='appendix-stub'>Appended analysis</div>" },
      global,
    });

    const html = w.html();
    expect(html.indexOf("Appended analysis")).toBeGreaterThan(
      html.indexOf('class="execution-body"')
    );
  });

  it("passes thinking steps to the thinking panel and renders them", () => {
    const w = mount(QueryExecutionView, {
      props: {
        expandThinking: true,
        facts: {
          ...MULTI,
          thinkingSteps: [{ text: "Data fetch complete", done: true, timestamp: 1 }],
        } as QueryExecutionFacts,
      },
      global,
    });

    expect(w.findAll(".step-item").length).toBe(1);
    expect(w.text()).toContain("Data fetch complete");
  });

  it("presents only the static, hot and abc branches in the new query's thinking panel", () => {
    const w = mount(QueryExecutionView, {
      props: {
        expandThinking: true,
        facts: {
          ...MULTI,
          thinkingState: {
            summary: "ABC won",
            status: "completed",
            winner: "abc",
            branches: [
              { key: "static", label: "Fixed metric hot data", status: "not_found", logs: [] },
              { key: "hot", label: "Dynamic metric hot data", status: "cancelled", logs: [] },
              { key: "abc", label: "ABC decomposition", status: "success", winner: true, logs: [] },
            ],
          },
        },
      },
      global,
    });

    expect(w.findAll(".branch-card .branch-label").map((label) => label.text())).toEqual([
      "Fixed metric hot data",
      "Dynamic metric hot data",
      "ABC decomposition",
    ]);
  });

  it("does not render the whole view when there are no execution facts", () => {
    expect(
      mount(QueryExecutionView, { props: {}, global }).find(".query-execution-view").exists()
    ).toBe(false);
  });
});
