import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ElementPlus, { ElDialog, ElInput, ElSelect } from "element-plus";
import type { AnalysisReportCardSummary } from "@ontomato/contracts/analysis-report";
import HotReportManager from "../components/hot-report/HotReportManager.vue";
import { workbenchI18n } from "../../../i18n";

const dialogs = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock("element-plus", async (original) => ({
  ...(await original<object>()),
  ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  ElMessageBox: dialogs,
}));

const i18n = workbenchI18n();
const t = i18n.global.t;

const cards: AnalysisReportCardSummary[] = [
  {
    id: "card-a",
    question: "Why did quarterly revenue in the east region decline",
    status: "PENDING_REVIEW",
    businessDescription: "",
    agentId: "agent-1",
    agentName: "Revenue analysis",
    dimensions: ["Region", "Product line"],
    questionTotal: 4,
    createdAt: Date.UTC(2026, 8, 1, 2, 30),
    updatedAt: Date.UTC(2026, 8, 1, 2, 30),
  },
  {
    id: "card-b",
    question: "Change in inventory turnover days",
    status: "PUBLISHED",
    businessDescription: "Reused in the weekly supply chain meeting",
    agentId: "agent-2",
    agentName: "Supply chain analysis",
    dimensions: [],
    questionTotal: 2,
    createdAt: Date.UTC(2026, 8, 2, 2, 30),
    updatedAt: Date.UTC(2026, 8, 2, 2, 30),
  },
];

type Call = { method: string; path: string; body?: unknown };
let calls: Call[] = [];

function respond(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  dialogs.confirm.mockResolvedValue("confirm");
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: { method?: string; body?: string }) => {
      const url = new URL(input, "http://localhost");
      const method = init?.method ?? "GET";
      calls.push({
        method,
        path: url.pathname + url.search,
        body: init?.body ? JSON.parse(init.body) : undefined,
      });
      if (method === "GET" && url.pathname.endsWith("/analysis-reports/cards")) {
        const status = url.searchParams.get("status");
        return respond({
          success: true,
          data: status ? cards.filter((card) => card.status === status) : cards,
        });
      }
      if (method === "GET" && url.pathname.endsWith("/analysis-reports/cards/card-a")) {
        return respond({
          success: true,
          data: { ...cards[0], reportContent: "## Conclusion\nRevenue declined" },
        });
      }
      return respond({ success: true, data: {} });
    })
  );
});

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
});

function mountPage() {
  const wrapper = mount(HotReportManager, {
    global: {
      plugins: [i18n, ElementPlus],
      stubs: {
        teleport: true,
        ElDialog: {
          name: "ElDialog",
          props: ["modelValue", "title"],
          template: '<section v-if="modelValue"><slot /><slot name="footer" /></section>',
        },
      },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}

function rowTitles(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll(".el-table__body-wrapper tbody tr")
    .map((row) => row.findAll("td")[0]!.text());
}

function rowButton(wrapper: ReturnType<typeof mount>, rowIndex: number, text: string) {
  const row = wrapper.findAll(".el-table__body-wrapper tbody tr")[rowIndex]!;
  return row.findAll("button").find((button) => button.text() === text)!;
}

function button(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll("button").find((candidate) => candidate.text() === text)!;
}

describe("hot report management", () => {
  it("lists, filters and refreshes reports only through the analysis report API", async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(rowTitles(wrapper)).toEqual([cards[0]!.question, cards[1]!.question]);

    await wrapper.getComponent(ElInput).get("input").setValue("inventory");
    expect(rowTitles(wrapper)).toEqual([cards[1]!.question]);

    const status = wrapper.getComponent(ElSelect);
    status.vm.$emit("update:modelValue", "PUBLISHED");
    status.vm.$emit("change", "PUBLISHED");
    await flushPromises();

    await button(wrapper, t("common.reset")).trigger("click");
    await flushPromises();
    expect(rowTitles(wrapper)).toEqual([cards[0]!.question, cards[1]!.question]);

    await button(wrapper, t("common.refresh")).trigger("click");
    await flushPromises();

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/analysis-reports/cards",
      "GET /api/analysis-reports/cards?status=PUBLISHED",
      "GET /api/analysis-reports/cards",
      "GET /api/analysis-reports/cards",
    ]);
  });

  it("previews the report content from the card detail", async () => {
    const wrapper = mountPage();
    await flushPromises();
    await rowButton(wrapper, 0, t("common.preview")).trigger("click");
    await flushPromises();

    expect(calls.at(-1)).toEqual({ method: "GET", path: "/api/analysis-reports/cards/card-a" });
    const preview = wrapper
      .findAllComponents(ElDialog)
      .find((dialog) => dialog.props("title") === t("report.preview"))!;
    expect(preview.text()).toContain(cards[0]!.question);
    expect(preview.text()).toContain("## Conclusion\nRevenue declined");
  });

  it("saves only status and business description, showing the question read-only", async () => {
    const wrapper = mountPage();
    await flushPromises();
    await rowButton(wrapper, 0, t("common.edit")).trigger("click");
    await flushPromises();

    const dialog = wrapper
      .findAllComponents(ElDialog)
      .find((item) => item.props("title") === t("report.editReport"))!;
    expect(dialog.text()).toContain(cards[0]!.question);
    expect(dialog.findAllComponents(ElInput)).toHaveLength(1);
    dialog.getComponent(ElSelect).vm.$emit("update:modelValue", "PUBLISHED");
    await dialog.get("textarea").setValue("Reused in the monthly business review");
    await dialog
      .findAll("button")
      .find((item) => item.text() === t("common.save"))!
      .trigger("click");
    await flushPromises();

    expect(calls.slice(1)).toEqual([
      {
        method: "PUT",
        path: "/api/analysis-reports/cards/card-a/status",
        body: { status: "PUBLISHED" },
      },
      {
        method: "PUT",
        path: "/api/analysis-reports/cards/card-a/business-description",
        body: { businessDescription: "Reused in the monthly business review" },
      },
      { method: "GET", path: "/api/analysis-reports/cards", body: undefined },
    ]);
  });

  it("deletes a report after confirmation and keeps it when cancelled", async () => {
    const wrapper = mountPage();
    await flushPromises();

    dialogs.confirm.mockRejectedValueOnce("cancel");
    await rowButton(wrapper, 1, t("common.delete")).trigger("click");
    await flushPromises();
    expect(calls).toHaveLength(1);

    await rowButton(wrapper, 1, t("common.delete")).trigger("click");
    await flushPromises();
    expect(calls.slice(1).map((call) => `${call.method} ${call.path}`)).toEqual([
      "DELETE /api/analysis-reports/cards/card-b",
      "GET /api/analysis-reports/cards",
    ]);
  });
});
