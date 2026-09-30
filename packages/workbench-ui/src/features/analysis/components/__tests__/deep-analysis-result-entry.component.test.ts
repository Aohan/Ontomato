import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import DeepAnalysisResult from "../DeepAnalysisResult.vue";
import { MessageContent, QueryExecutionView } from "../../../query-view";
import { workbenchI18n } from "../../../../i18n";
import type {
  AnalysisActivity,
  AnalysisEvidenceQuestion,
} from "@ontomato/contracts/analysis-presentation";

const i18n = workbenchI18n();

/**
 * The report provenance entry and the standard data query entry see the same data query facts.
 *
 * Uses the same data query fact sample as the standard entry: the full answer is shown once, only by the execution view,
 * and failure notes, quality checks and table download are visible from the same facts; the question list and folding stay with this entry.
 */
const global = {
  plugins: [i18n],
  stubs: {
    "el-icon": true,
    "el-dialog": true,
    "el-table": true,
    "el-table-column": true,
    "el-tag": true,
  },
};

/** The same data query fact sample as the standard entry; assertions in both places must stay consistent. */
const EXECUTION: AnalysisEvidenceQuestion["execution"] = {
  fullContent: "Construction sites per town are as follows",
  markdownTable: "| Town | Sites |",
  dataCount: 12,
  thinkingSummary: "ABC decomposition complete",
  qcState: { status: "completed", steps: [], result: { conclusion: "Definition is correct" } },
  qcResult: { conclusion: "Definition is correct", score: 90, steps: [] },
};

const activities: AnalysisActivity[] = [
  {
    activityId: "plan",
    kind: "plan",
    seq: 1,
    revision: 1,
    status: "completed",
    startedAt: 1,
    dimensions: [
      {
        dimensionId: "dim-1",
        name: "By town",
        questions: [{ questionId: "q-1", question: "Construction sites per town" }],
      },
    ],
  },
  {
    activityId: "evidence",
    kind: "evidence",
    groupId: "dim-1",
    seq: 2,
    revision: 2,
    status: "completed",
    startedAt: 1,
    questions: [
      {
        questionId: "q-1",
        question: "Construction sites per town",
        status: "completed",
        execution: EXECUTION,
      },
    ],
  },
];

const render = () =>
  mount(DeepAnalysisResult, {
    props: { activities },
    global,
  });

describe("report provenance entry", () => {
  it("hands the execution facts to the execution view after a sub-question is expanded", async () => {
    const w = render();
    // Nothing renders until expanded, matching the carrier shape where expanding shows this data query question and its query facts.
    expect(w.findComponent(QueryExecutionView).exists()).toBe(false);

    await w.find(".question-left").trigger("click");

    const view = w.findComponent(QueryExecutionView);
    expect(view.exists()).toBe(true);
    expect(view.props("facts")).toMatchObject({
      fullContent: "Construction sites per town are as follows",
      markdownTable: "| Town | Sites |",
    });
  });

  it("the same answer is shown only once: only fullContent is rendered", async () => {
    const w = render();
    await w.find(".question-left").trigger("click");

    const bodies = w.findAllComponents(MessageContent);
    // The data query body appears only once (the quality check conclusion is separate content).
    expect(bodies.filter((m) => m.props("content") === "Construction sites per town are as follows")).toHaveLength(1);
    expect(w.find(".data-preview").exists()).toBe(false);
  });
});
