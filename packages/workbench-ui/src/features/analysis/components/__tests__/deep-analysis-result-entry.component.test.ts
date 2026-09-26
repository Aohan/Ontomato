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
 * 报告溯源入口与标准问数入口看到同一批问数事实。
 *
 * 与标准问数入口用同一份问数事实样本：完整回答只由执行展示视图显示一次，
 * 失败说明、质检与表格下载随同一份事实可见；问题列表与折叠仍归本入口。
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

/** 与标准问数入口同一份问数事实样本，两处断言必须保持一致。 */
const EXECUTION: AnalysisEvidenceQuestion["execution"] = {
  fullContent: "各镇街工地数如下",
  markdownTable: "| 镇街 | 工地数 |",
  dataCount: 12,
  thinkingSummary: "ABC 拆解完成",
  qcState: { status: "completed", steps: [], result: { conclusion: "口径正确" } },
  qcResult: { conclusion: "口径正确", score: 90, steps: [] },
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
        name: "按镇街",
        questions: [{ questionId: "q-1", question: "各镇街工地数" }],
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
        question: "各镇街工地数",
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

describe("报告溯源入口", () => {
  it("展开子问题后把执行事实交给执行展示视图", async () => {
    const w = render();
    // 未展开时不渲染，符合「展开即是本次问数问题与查询事实」的载体形态。
    expect(w.findComponent(QueryExecutionView).exists()).toBe(false);

    await w.find(".question-left").trigger("click");

    const view = w.findComponent(QueryExecutionView);
    expect(view.exists()).toBe(true);
    expect(view.props("facts")).toMatchObject({
      fullContent: "各镇街工地数如下",
      markdownTable: "| 镇街 | 工地数 |",
    });
  });

  it("同一段回答只显示一次：只渲染 fullContent", async () => {
    const w = render();
    await w.find(".question-left").trigger("click");

    const bodies = w.findAllComponents(MessageContent);
    // 问数正文只出现一次（质检结论是另一份内容）。
    expect(bodies.filter((m) => m.props("content") === "各镇街工地数如下")).toHaveLength(1);
    expect(w.find(".data-preview").exists()).toBe(false);
  });
});
