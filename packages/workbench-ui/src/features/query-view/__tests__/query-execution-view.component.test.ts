import { mount, type DOMWrapper, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { datasetPlacement } from "@ontomato/contracts/query-execution";

// Downloads are asserted by the rows each action hands over, not by a browser file save.
vi.mock("../utils/downloadUtils", () => ({ downloadCsvFromData: vi.fn(), downloadDsl: vi.fn() }));
import { downloadCsvFromData } from "../utils/downloadUtils";

import QueryExecutionView from "../components/QueryExecutionView.vue";
import MessageContent from "../components/MessageContent/index.vue";
import { workbenchI18n } from "../../../i18n";
import type { QueryExecutionFacts } from "../../../types/chat";

const i18n = workbenchI18n();

/**
 * Blueprint scenario: a single query's result is presented by the body — the row count and data/DSL
 * download sit where the body places each dataset's id, and the DSL view, post-calculation program,
 * and field lineage are details expanded on demand for that result; datasets the body does not place
 * (saved before dataset ids) are listed after the body with their names. This mounts the real
 * components and asserts the actual rendered output and interactions with a real i18n instance,
 * rather than grepping component source code.
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

const placed = ".message-content .result-dataset";
const unplaced = ".unplaced-results .result-dataset";

/**
 * A programmatic two-level decomposition of two sub-questions: the body places each dataset after
 * its table, and the code and lineage correspond by dataset index. abcSubQuestions includes one
 * extra failed sub-question to prove the pairing is not guessed from the sub-question array position.
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
    datasetPlacement("ds-stat"),
    "",
    "### Town list",
    "",
    "| Town | Name |",
    "| --- | --- |",
    "| Renhe Town | A |",
    "",
    datasetPlacement("ds-list"),
  ].join("\n"),
  datasets: [
    {
      id: "ds-stat",
      subQuestion: "Construction sites by town",
      data: [{ Town: "Renhe Town", "Site Count": 137 }],
      dsl: { problem: "stat" },
    },
    {
      id: "ds-list",
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
  it("removes the standalone data preview and ABC split blocks, presenting results where the body places them", () => {
    const w = render(MULTI);

    expect(w.find(".dataset-detail").exists()).toBe(false);
    expect(w.find(".abc-detail").exists()).toBe(false);
    expect(w.findAll(placed)).toHaveLength(2);
    expect(w.findAll(unplaced)).toHaveLength(0);
  });

  it("shows only actions where the body places a dataset, the name staying in the body", () => {
    const w = render(MULTI);
    const blocks = w.findAll(placed);

    expect(blocks.map((block) => block.find(".result-dataset-title").exists())).toEqual([
      false,
      false,
    ]);
    expect(blocks.map((block) => block.find(".result-dataset-head").exists())).toEqual([
      false,
      false,
    ]);
    expect(buttonLabels(blocks[0]!)).toContain(t("chat.downloadData"));
    // The sub-question name appears once: in the body heading, not again in the actions.
    expect(w.text().split("Construction sites by town")).toHaveLength(2);
    expect(w.html()).not.toContain("query-dataset:");
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

  it("keeps each placement with its own dataset when subgraphs split the body into segments", async () => {
    const subgraph = ["```data-agent-subgraph", '{"subgraph":{"nodes":[]}}', "```"];
    const w = render({
      fullContent: [
        ...["### Dataset A", "", "| a |", "| --- |", "| 1 |", "", datasetPlacement("ds-a"), ""],
        ...subgraph,
        ...["", "### Dataset B", "", "| b |", "| --- |", "| 2 |", "", datasetPlacement("ds-b"), ""],
        ...subgraph,
        ...["", "### Dataset C", "", "| c |", "| --- |", "| 3 |", "", datasetPlacement("ds-c")],
      ].join("\n"),
      datasets: [
        { id: "ds-a", subQuestion: "Dataset A", data: [{ a: 1 }], dsl: { problem: "A" } },
        { id: "ds-b", subQuestion: "Dataset B", data: [{ b: 2 }], dsl: { problem: "B" } },
        { id: "ds-c", subQuestion: "Dataset C", data: [{ c: 3 }], dsl: { problem: "C" } },
      ],
    });

    const blocks = w.findAll(placed);
    expect(blocks).toHaveLength(3);
    for (const [index, name] of ["A", "B", "C"].entries()) {
      await clickButton(blocks[index]!, t("common.detail"));
      await clickButton(blocks[index]!, t("common.viewDsl"));
      expect(blocks[index]!.find(".dsl-pre").text()).toContain(name);
    }
  });

  it("presents three results of the real answer's shape in order, conclusion after them, conclusion and folded tables without actions", async () => {
    const row = (count: number, keys: string[]) =>
      Array.from({ length: count }, (_, index) =>
        Object.fromEntries(keys.map((key) => [key, `${key}-${index}`]))
      );
    const section = (name: string, id: string) =>
      [
        `Based on the steps above, the data results for <strong>"${name}"</strong> are as follows:`,
        "",
        "| Entity | Value |",
        "| --- | --- |",
        "| e-0 | 1 |",
        "",
        "<details><summary>All rows</summary>",
        "",
        "| Entity | Value |",
        "| --- | --- |",
        "| e-1 | 2 |",
        "</details>",
        "",
        datasetPlacement(id),
        "",
        "---",
        "",
      ].join("\n");
    const w = render({
      fullContent: [
        section("Revenue by entity", "ds-1"),
        section("Cash flow by entity", "ds-2"),
        section("Entities with growth", "ds-3"),
        '📌 <strong class="ai-conclusion">Conclusion</strong>: 41 entities.',
        "",
        "| Summary | Count |",
        "| --- | --- |",
        "| entities | 41 |",
      ].join("\n"),
      datasets: [
        { id: "ds-1", subQuestion: "Revenue by entity", data: row(6380, ["period", "org_code"]) },
        { id: "ds-2", subQuestion: "Cash flow by entity", data: row(6380, ["period", "org_code"]) },
        { id: "ds-3", subQuestion: "Entities with growth", data: row(41, ["org_code"]) },
      ],
    });

    // Each placed action downloads its own dataset's rows.
    const blocks = w.findAll(placed);
    expect(blocks).toHaveLength(3);
    vi.mocked(downloadCsvFromData).mockClear();
    for (const block of blocks) await clickButton(block, t("chat.downloadData"));
    expect(
      vi.mocked(downloadCsvFromData).mock.calls.map(([rows, name]) => [rows.length, name])
    ).toEqual([
      [6380, "Revenue by entity"],
      [6380, "Cash flow by entity"],
      [41, "Entities with growth"],
    ]);
    expect(w.findAll(unplaced)).toHaveLength(0);

    const html = w.html();
    const positions = [
      html.indexOf("Revenue by entity"),
      html.indexOf('class="result-dataset"'),
      html.indexOf("Cash flow by entity"),
      html.indexOf('class="result-dataset"', html.indexOf("Cash flow by entity")),
      html.indexOf("Entities with growth"),
      html.indexOf('class="result-dataset"', html.indexOf("Entities with growth")),
      html.indexOf("ai-conclusion"),
    ];
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("gives same-named sub-questions each their own actions and downloads", async () => {
    const w = render({
      fullContent: [
        "### Sales by region",
        "",
        "| region |",
        "| --- |",
        "| east |",
        "",
        datasetPlacement("ds-east"),
        "",
        "### Sales by region",
        "",
        "| region |",
        "| --- |",
        "| west |",
        "",
        datasetPlacement("ds-west"),
      ].join("\n"),
      datasets: [
        { id: "ds-east", subQuestion: "Sales by region", data: [{ region: "east" }], dsl: { problem: "east" } },
        { id: "ds-west", subQuestion: "Sales by region", data: [{ region: "west" }], dsl: { problem: "west" } },
      ],
    });

    const blocks = w.findAll(placed);
    expect(blocks).toHaveLength(2);
    for (const [index, name] of ["east", "west"].entries()) {
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

  it("closes one dataset's open details when another dataset takes its place, keeping them across body updates", async () => {
    const body = (id: string, text = "") =>
      `### Revenue\n\n| a |\n| --- |\n| 1 |\n\n${datasetPlacement(id)}\n\nConclusion.${text}`;
    const dataset = (datasetId: string, problem: string) => ({
      id: "dataset-0",
      datasetId,
      title: "Revenue",
      rows: [{ a: 1 }],
      dsl: { problem },
      code: `${problem}-code`,
    });
    const w = mount(MessageContent, {
      props: { content: body("ds-a"), resultDatasets: [dataset("ds-a", "branch-a")] },
      global,
    });
    const block = () => w.find(placed);

    await clickButton(block(), t("common.detail"));
    await clickButton(block(), t("common.viewDsl"));
    expect(block().find(".dsl-pre").text()).toContain("branch-a");

    // The same dataset with more body text keeps its open details.
    await w.setProps({ content: body("ds-a", " More.") });
    expect(block().find(".dsl-pre").text()).toContain("branch-a");

    // Another dataset in the same place: the earlier details are gone, reopening shows its own.
    await w.setProps({ content: body("ds-b"), resultDatasets: [dataset("ds-b", "branch-b")] });
    expect(block().find(".dsl-pre").exists()).toBe(false);
    expect(block().find(".result-dataset-details").exists()).toBe(false);
    await clickButton(block(), t("common.detail"));
    await clickButton(block(), t("common.code"));
    expect(block().find(".code-pre").text()).toContain("branch-b-code");
  });

  it("does not create an empty detail entry for datasets that produced no details", () => {
    const block = render({
      fullContent: `### Only one table\n\n| a |\n| --- |\n| 1 |\n\n${datasetPlacement("ds-1")}`,
      datasets: [{ id: "ds-1", subQuestion: "Only one table", data: [{ a: 1 }] }],
    }).find(placed);

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
    expect(w.findComponent(MessageContent).props("content")).toBe("");
  });

  it("puts zero-row and no-displayable-field results' actions right after the body's empty state", async () => {
    const w = render({
      fullContent: [
        "### Empty result",
        "",
        "No data to display.",
        "",
        datasetPlacement("ds-empty"),
        "",
        "### Blank fields",
        "",
        "No data to display.",
        "",
        datasetPlacement("ds-blank"),
        "",
        "Conclusion: nothing found.",
      ].join("\n"),
      datasets: [
        { id: "ds-empty", subQuestion: "Empty result", data: [], dsl: { problem: "empty" } },
        { id: "ds-blank", subQuestion: "Blank fields", data: [{ note: "" }, { note: null }] },
      ],
      abcCodes: ["empty-code", "blank-code"],
      abcOutKeyRefs: [[{ key: "k" }], [{ key: "k" }]],
    });

    const [empty, blank] = w.findAll(placed);
    expect(w.findAll(unplaced)).toHaveLength(0);
    expect(buttonLabels(empty!)).not.toContain(t("chat.downloadData"));
    expect(buttonLabels(empty!)).toContain(t("common.detail"));
    // Rows the adapter could not display are still the real data, downloadable as saved.
    vi.mocked(downloadCsvFromData).mockClear();
    await clickButton(blank!, t("chat.downloadData"));
    expect(vi.mocked(downloadCsvFromData)).toHaveBeenCalledWith(
      [{ note: "" }, { note: null }],
      "Blank fields"
    );
    expect(w.html().indexOf("Conclusion: nothing found.")).toBeGreaterThan(
      w.html().lastIndexOf('class="result-dataset"')
    );
  });

  it("lists datasets saved before dataset ids after the body, with their names", () => {
    const w = render({
      fullContent: [
        "Based on the steps above, the data results for <strong>\"Dataset A\"</strong> are as follows:",
        "",
        "| a |",
        "| --- |",
        "| 1 |",
        "",
        "Conclusion: done.",
      ].join("\n"),
      datasets: [
        { subQuestion: "Dataset A", data: [{ a: 1 }], dsl: { problem: "a" } },
        { subQuestion: "Dataset B", data: [] },
      ],
    });

    expect(w.findAll(placed)).toHaveLength(0);
    const listed = w.findAll(unplaced);
    expect(listed.map((block) => block.find(".result-dataset-title").text())).toEqual([
      "Dataset A",
      "Dataset B",
    ]);
    expect(buttonLabels(listed[0]!)).toContain(t("chat.downloadData"));
    expect(buttonLabels(listed[0]!)).toContain(t("chat.downloadDsl"));
  });

  it("waits for a placed dataset to arrive and never binds another branch's dataset in its place", async () => {
    const body = `### Revenue\n\n| a |\n| --- |\n| 1 |\n\n${datasetPlacement("ds-abc")}\n\nConclusion.`;
    const w = mount(MessageContent, { props: { content: body, resultDatasets: [] }, global });
    expect(w.findAll(".result-dataset")).toHaveLength(0);

    // Datasets of a branch whose body is not shown: no binding by position, only listed after the body.
    await w.setProps({
      resultDatasets: [{ id: "dataset-0", datasetId: "ds-hot", title: "Hot card", rows: [{ a: 9 }] }],
    });
    expect(w.findAll(placed)).toHaveLength(0);
    expect(w.findAll(unplaced)).toHaveLength(1);

    await w.setProps({
      resultDatasets: [{ id: "dataset-0", datasetId: "ds-abc", title: "Revenue", rows: [{ a: 1 }] }],
    });
    expect(w.findAll(placed)).toHaveLength(1);
    expect(w.findAll(unplaced)).toHaveLength(0);
  });

  it("passes the table's dashboard entry to the caller with the index ordered by datasets with rows", async () => {
    const w = mount(QueryExecutionView, {
      props: {
        facts: {
          fullContent: [
            `### Zero rows\n\nNo data.\n\n${datasetPlacement("ds-zero")}`,
            `### Has data\n\n| a |\n| --- |\n| 1 |\n\n${datasetPlacement("ds-data")}`,
          ].join("\n\n"),
          datasets: [
            { id: "ds-zero", subQuestion: "Zero rows", data: [] },
            { id: "ds-data", subQuestion: "Has data", data: [{ a: 1 }] },
          ],
        },
        dashboardContext: { threadId: "thread-1", requestSeq: 0 },
      },
      global,
    });

    await clickButton(w.findAll(placed)[1]!, t("chat.addToDashboard"));

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
      datasetId: "ds-stat",
      title: "Construction sites by town",
      subQuestion: "Construction sites by town",
      code: "code-stat",
    });
    expect(datasets[1]).toMatchObject({ datasetId: "ds-list", title: "Town list", code: "code-list" });
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
