import { mount, type DOMWrapper, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../api", () => ({ nodeApiBlobPost: vi.fn() }));
vi.mock("element-plus", () => ({ ElMessage: { success: vi.fn(), error: vi.fn() } }));

import SnapshotContent from "../components/SnapshotContent.vue";
import { MessageContent, QueryExecutionView } from "../../query-view";
import { workbenchI18n } from "../../../i18n";
import type { ResponseSnapshot } from "../../../types/chat";

const i18n = workbenchI18n();

/**
 * The standard query entry and the report tracing entry see the same set of query facts.
 *
 * This file shares the same query fact sample with the report tracing entry: the complete
 * answer is shown only once by the execution display view, and the entry does not lay out
 * the body again; the failure description, QC, and table download are visible with the
 * same facts.
 */
const global = {
  plugins: [i18n],
  stubs: {
    "el-icon": true,
    "el-dialog": {
      props: ["title"],
      template: "<div><span class='dialog-title'>{{ title }}</span><slot /></div>",
    },
    "el-table": true,
    "el-table-column": true,
    "el-tag": true,
    DeepAnalysisResult: true,
  },
};

const t = i18n.global.t;

async function clickButton(wrapper: VueWrapper | DOMWrapper<Element>, text: string) {
  const button = wrapper.findAll("button").find((item) => item.text().includes(text));
  expect(button, `Button not found: ${text}`).toBeTruthy();
  await button!.trigger("click");
}

/** Same query fact sample as the report tracing entry; assertions in both places must stay consistent. */
const EXECUTION = {
  fullContent: "Construction sites by town as follows",
  markdownTable: "| Town | Site Count |",
  dataCount: 12,
  thinkingSummary: "ABC decomposition complete",
  qcState: { status: "completed", steps: [], result: { conclusion: "Definition correct" } },
  qcResult: { conclusion: "Definition correct", score: 90 },
};

const STANDARD = {
  mode: "standard",
  status: "completed",
  source: "history",
  threadId: "thread-1",
  requestSeq: 0,
  primaryText: "Construction sites by town as follows",
  execution: EXECUTION,
} as unknown as ResponseSnapshot;

/** A standalone body without execution facts also carries the result datasets of the historical read model. */
const PRIMARY_WITH_DATASETS = {
  mode: "standard",
  status: "completed",
  source: "history",
  primaryText:
    "### Construction sites by town\n\n| Town | Site Count |\n| --- | --- |\n| Renhe Town | 137 |",
  datasets: [
    {
      id: "dataset-0",
      title: "Construction sites by town",
      rows: [{ Town: "Renhe Town" }],
      dsl: { problem: "stat" },
      subQuestion: "Construction sites by town",
    },
  ],
} as unknown as ResponseSnapshot;

/** Execution facts have only datasets without fullContent: the execution view still renders the result body card. */
const DATASETS_ONLY = {
  mode: "standard",
  status: "completed",
  source: "history",
  threadId: "thread-1",
  requestSeq: 0,
  primaryText:
    "### Construction sites by town\n\n| Town | Site Count |\n| --- | --- |\n| Renhe Town | 137 |",
  analysisText: "Appended analysis body",
  execution: {
    datasets: [
      {
        subQuestion: "Construction sites by town",
        data: [{ Town: "Renhe Town" }],
        dsl: { problem: "stat" },
      },
    ],
    thinkingSummary: "ABC decomposition complete",
  },
} as unknown as ResponseSnapshot;

describe("standard query entry", () => {
  it("hands the execution facts to the execution display view", () => {
    const view = mount(SnapshotContent, { props: { snapshot: STANDARD }, global }).findComponent(
      QueryExecutionView
    );

    expect(view.exists()).toBe(true);
    expect(view.props("facts")).toMatchObject({
      fullContent: "Construction sites by town as follows",
      markdownTable: "| Town | Site Count |",
    });
  });

  it("shows the same answer only once: the entry does not lay it out again after the execution view takes the body", () => {
    const messages = mount(SnapshotContent, {
      props: { snapshot: STANDARD },
      global,
    }).findAllComponents(MessageContent);

    // The query body appears only once (the one inside the execution view; the QC conclusion is separate content).
    expect(
      messages.filter((m) => m.props("content") === "Construction sites by town as follows")
    ).toHaveLength(1);
  });

  it("still shows the reply body as-is when there are no execution facts", () => {
    const w = mount(SnapshotContent, {
      props: {
        snapshot: {
          mode: "standard",
          status: "completed",
          source: "history",
          primaryText: "Direct reply",
        } as unknown as ResponseSnapshot,
      },
      global,
    });

    expect(w.findComponent(QueryExecutionView).exists()).toBe(false);
    const messages = w.findAllComponents(MessageContent);
    expect(messages).toHaveLength(1);
    expect(messages[0].props("content")).toBe("Direct reply");
  });

  it("renders the appended analysis inside this card only once when there is no new query this turn", () => {
    // Appended analysis referencing historical results: without execution facts there is no body card, so the appended analysis goes through the original card.
    const w = mount(SnapshotContent, {
      props: {
        snapshot: {
          mode: "standard",
          status: "completed",
          source: "history",
          primaryText: "",
          analysisText: "Appended analysis of historical data",
        } as unknown as ResponseSnapshot,
      },
      global,
    });

    expect(w.findComponent(QueryExecutionView).exists()).toBe(false);
    const bodies = w
      .findAllComponents(MessageContent)
      .filter((m) => m.props("content") === "Appended analysis of historical data");
    expect(bodies).toHaveLength(1);
  });

  it("does not let existing execution facts hide the error body and partial analysis when a later stage fails", () => {
    const w = mount(SnapshotContent, {
      props: {
        snapshot: {
          ...STANDARD,
          mode: "error",
          status: "failed",
          primaryText: "Analysis failed",
          analysisText: "Partially generated analysis",
        },
      },
      global,
    });
    const contents = w.findAllComponents(MessageContent).map((m) => m.props("content"));
    expect(contents).toContain("Analysis failed");
    expect(contents).toContain("Partially generated analysis");
  });

  it.each([
    ["live error page", "live", (reason: string) => `${t("common.error")}: ${reason}`],
    ["history-restored error page", "history", (reason: string) => reason],
  ] as const)(
    "%s truncates an over-long failure description for display",
    (_, source, toPrimaryText) => {
      const reason = `ABC Decomposition: ${"the complete failure reason returned by the backend".repeat(20)}; Dynamic Metrics Hot Data: recall failed`;
      const primaryText = toPrimaryText(reason);
      const snapshot = {
        mode: "error",
        status: "failed",
        source,
        primaryText,
      } as unknown as ResponseSnapshot;

      const messages = mount(SnapshotContent, { props: { snapshot }, global }).findAllComponents(
        MessageContent
      );

      expect(messages.map((m) => m.props("content"))).toEqual([`${primaryText.slice(0, 160)}...`]);
    }
  );

  it("passes the table's dashboard entry through with this turn's identity", async () => {
    const w = mount(SnapshotContent, { props: { snapshot: STANDARD }, global });
    await w.findComponent(QueryExecutionView).vm.$emit("addToDashboard", {
      threadId: "thread-1",
      requestSeq: 0,
      datasetIndex: 0,
      datasetTitle: "Construction sites by town",
    });

    expect(w.emitted("addToDashboard")).toEqual([
      [
        {
          threadId: "thread-1",
          requestSeq: 0,
          datasetIndex: 0,
          datasetTitle: "Construction sites by town",
        },
      ],
    ]);
  });

  it("places appended analysis and charts in the body card, before QC", () => {
    const w = mount(SnapshotContent, {
      props: {
        snapshot: {
          ...STANDARD,
          analysisText: "Appended analysis body",
          visualizationHTML: "<div>chart</div>",
        } as unknown as ResponseSnapshot,
      },
      global,
    });

    const html = w.html();
    const bodyIndex = html.indexOf('class="execution-body"');
    const appendixIndex = html.indexOf("Appended analysis body");
    const qcIndex = html.indexOf('class="post-thinking-panel"');
    expect(bodyIndex).toBeGreaterThanOrEqual(0);
    expect(appendixIndex).toBeGreaterThan(bodyIndex);
    // QC comes after the result; there is only one query body in the same body card.
    expect(qcIndex).toBeGreaterThan(appendixIndex);
    expect(
      w
        .findAllComponents(MessageContent)
        .filter((m) => m.props("content") === "Construction sites by town as follows")
    ).toHaveLength(1);
    // When a body card exists, no separate entry card is created: only one of the two appended contents is rendered.
    expect(w.find(".assistant-content").exists()).toBe(false);
  });

  it("does not render the query-question-level view for deep analysis turns", () => {
    const deep = { ...STANDARD, mode: "deep-analysis" } as unknown as ResponseSnapshot;
    const w = mount(SnapshotContent, { props: { snapshot: deep }, global });
    expect(w.findComponent(QueryExecutionView).exists()).toBe(false);
  });

  it("still expands the result details in a standalone body without execution facts", async () => {
    const w = mount(SnapshotContent, { props: { snapshot: PRIMARY_WITH_DATASETS }, global });
    expect(w.findComponent(QueryExecutionView).exists()).toBe(false);

    const block = w.find(".table-section .result-dataset");
    expect(block.exists()).toBe(true);
    await clickButton(block, t("common.detail"));
    await clickButton(block, t("common.viewDsl"));
    expect(block.find(".dsl-pre").text()).toContain("stat");
  });

  it("does not drop or duplicate appended analysis when the execution view takes the body from datasets alone", () => {
    const w = mount(SnapshotContent, { props: { snapshot: DATASETS_ONLY }, global });

    const primaryText = DATASETS_ONLY.primaryText;
    const primaryBodies = w
      .findAllComponents(MessageContent)
      .filter((m) => m.props("content") === primaryText);
    expect(primaryBodies).toHaveLength(1);
    // Dataset actions are provided only once by the execution view; the standalone body does not repeat them.
    expect(w.findAll(".result-dataset")).toHaveLength(1);
    expect(primaryBodies[0]!.props("resultDatasets")).toHaveLength(0);
    // The appended analysis goes into the execution view's body card, and appears only once.
    expect(w.text().match(/Appended analysis body/g)).toHaveLength(1);
    expect(w.html().indexOf("Appended analysis body")).toBeGreaterThan(
      w.html().indexOf('class="execution-body"')
    );
  });

  it("keeps the standalone body's download and details when execution facts only carry a failure description and results live in the read model", () => {
    const snapshot = {
      mode: "standard",
      status: "failed",
      source: "history",
      threadId: "thread-1",
      requestSeq: 0,
      primaryText:
        "### Construction sites by town\n\n| Town | Site Count |\n| --- | --- |\n| Renhe Town | 137 |",
      datasets: [
        {
          id: "dataset-0",
          title: "Construction sites by town",
          rows: [{ Town: "Renhe Town" }],
          dsl: { problem: "stat" },
          subQuestion: "Construction sites by town",
        },
      ],
      execution: { error: "Query timed out" },
    } as unknown as ResponseSnapshot;
    const w = mount(SnapshotContent, { props: { snapshot }, global });

    expect(w.find(".execution-error").text()).toContain("Query timed out");
    const primaryBodies = w
      .findAllComponents(MessageContent)
      .filter((m) => m.props("content") === snapshot.primaryText);
    expect(primaryBodies).toHaveLength(1);
    expect(primaryBodies[0]!.props("resultDatasets")).toHaveLength(1);
  });
});
