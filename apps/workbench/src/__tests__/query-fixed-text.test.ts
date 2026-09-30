import { afterAll, describe, expect, it, vi } from "vitest";
import { getLocale, setLocale, t } from "@ontomato/workbench-server/i18n/index";
import { installModelAgentCatalog } from "@ontomato/workbench-server/logging/model-agents";
import { parseQueryAnswerPayload, parseQueryAnswerPayloads } from "@ontomato/workbench-server/services/data-query/protocol";
import { truncateErrorForDisplay } from "@ontomato/workbench-server/services/data-query/display-error";
import { createDashboard } from "@ontomato/workbench-server/services/dashboard/store";
import { applyTransformSpec } from "@ontomato/workbench-server/services/dashboard/planning/core/utils";
import { generateChartsFromCandidates } from "@ontomato/workbench-server/services/charts/chart-generator";
import { buildQcMarkdown } from "@ontomato/workbench-server/services/data-query/qc-state";
import { buildThinkingSummary } from "@ontomato/workbench-server/services/data-query/thinking/thinking-state";
import { configureOssI18n } from "../i18n";
import { ossModelAgents } from "../model-agents";

configureOssI18n();
installModelAgentCatalog(ossModelAgents);
const previousLocale = getLocale();
const db = vi.hoisted(() => ({ queries: [] as { sql: string; params?: unknown[] }[] }));

vi.mock("@ontomato/workbench-server/infrastructure/postgres", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ontomato/workbench-server/infrastructure/postgres")>();
  return {
    ...actual,
    getPostgresPool: () => ({
      async query(sql: string, params?: unknown[]) {
        db.queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
    }),
  };
});
vi.mock("@ontomato/workbench-server/core/skills/registry/manager", () => ({
  skillRegistryManager: {
    forDomain: async () => ({
      getSkills: () => [{ id: "bar-skill", manifest: { title: "Bar" } }],
    }),
  },
}));
vi.mock("@ontomato/workbench-server/core/skills/discovery/loader", () => ({
  loadSkillContent: () => "skill body",
}));
vi.mock("@ontomato/workbench-server/core/prompts/loader", () => ({
  renderPrompt: () => "prompt",
}));
vi.mock("@ontomato/workbench-server/config/model-factory", () => ({
  createModel: () => ({ invoke: async () => ({ content: "[]" }) }),
}));

afterAll(() => {
  configureOssI18n();
  setLocale(previousLocale);
});

describe("oss query fixed text", () => {
  it("keeps protocol, display, dashboard, chart and thinking text on the fixed English pack", async () => {
    setLocale("zh-CN");
    expect(getLocale()).toBe("en");

    expect(parseQueryAnswerPayload({ answer: [1] }).answer).toEqual([1]);
    expect(() => parseQueryAnswerPayload({ answer: "no" })).toThrow(
      "data query response protocol error: answer must be an array"
    );
    expect(() => parseQueryAnswerPayloads([])).toThrow(
      "data query response protocol error: data must be a non-empty result-pack array"
    );

    expect(truncateErrorForDisplay("")).toBe("Unknown error");
    expect(truncateErrorForDisplay(new Error("  "))).toBe("Unknown error");
    expect(truncateErrorForDisplay("boom")).toBe("boom");
    expect(t("query.error.unknownError")).toBe("Unknown Error");

    db.queries.length = 0;
    const created = await createDashboard({ ownerId: "owner-1", domainId: "domain-1", name: "" });
    const insert = db.queries.find((query) => query.sql.includes("INSERT INTO"));
    expect(insert?.sql).toContain("dashboards");
    expect(insert?.params?.[2]).toBe("Unnamed dashboard");
    expect(insert?.params?.[2]).toBe(created.name);
    expect(insert?.params?.[7]).toBe("domain-1");
    db.queries.length = 0;
    const named = await createDashboard({ ownerId: "owner-1", domainId: "domain-1", name: "Kept" });
    expect(db.queries.find((query) => query.sql.includes("INSERT INTO"))?.params?.[2]).toBe("Kept");
    expect(named.name).toBe("Kept");
    expect(
      applyTransformSpec([{ amount: 2 }], {
        kind: "groupBy",
        groupBy: ["region"],
        metrics: [{ op: "count", as: "n" }],
      })
    ).toEqual([{ region: "Unknown", n: 1 }]);

    const candidate = { sourceSubQuestion: "q1", data: [{ x: 1, y: 2 }] };
    const diagnostic = await generateChartsFromCandidates({
      domainId: "domain-1",
      userQuestion: "q",
      scopeId: "scope-1",
      candidates: [candidate],
      maxCharts: 1,
      failurePolicy: "diagnostic",
    });
    expect(diagnostic.error).toBeUndefined();
    expect(diagnostic.diagnostics[0]).toMatchObject({
      scopeId: "scope-1",
      reason: "no_viable_plan",
      message: "The chart planning stage produced no executable chart plan",
    });
    const failed = await generateChartsFromCandidates({
      domainId: "domain-1",
      userQuestion: "q",
      scopeId: "scope-1",
      candidates: [candidate],
      maxCharts: 1,
      failurePolicy: "error",
    });
    expect(failed.error).toBe("LLM did not return valid config JSON");
    expect(failed.diagnostics[0]?.message).toBe("The chart planning stage produced no executable chart plan");
    expect(failed.diagnostics[0]?.reason).toBe("no_viable_plan");

    const label = t("query.branch.static");
    expect(label).toBe("Fixed Metrics Hot Data");
    const summary = buildThinkingSummary({
      summary: "",
      status: "completed",
      branches: [{ key: "static", label, status: "success", detail: "late", logs: [] }],
      abc: { status: "success", steps: [{ key: "s", text: "", done: true, timestamp: 1, label: "step", status: "done" }] },
    });
    expect(summary).toContain(`${label}: late`);
    expect(summary).toContain("ABC query process:");
    const qc = buildQcMarkdown({
      status: "completed",
      steps: [{ meaning: "why", status: "done", timestamp: 1 }],
      result: { conclusion: "KEEP", score: 1, fittedQuestion: "Q" },
    });
    expect(qc).toContain("KEEP");
    expect(qc).toContain("<details><summary>View details</summary>\n\nwhy\n</details>");
    expect(qc).toContain("**Score**: 1\n\n");
    expect(qc).toContain("The exact business question corresponding to this query is: Q\n\n");
  });
});
