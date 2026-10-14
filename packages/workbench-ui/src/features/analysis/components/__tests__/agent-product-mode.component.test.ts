import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ElementPlus, { ElInputNumber, ElSelect, ElOption } from "element-plus";
import AgentCreateDialog from "../AgentCreateDialog.vue";
import en from "../../../../locales/en";
import type { AnalysisAgent } from "@ontomato/contracts/analysis-agent";

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  listMcpServiceNames: vi.fn(),
}));
vi.mock("../../../mcp/api", () => ({ listMcpServiceNames: mocks.listMcpServiceNames }));
vi.mock("../../api", () => ({
  analysisAgentApi: mocks,
  analysisTaskApi: {},
  analysisReportApi: {},
  streamDeepAnalysis: vi.fn(),
  streamFollowUp: vi.fn(),
  streamFollowUpRun: vi.fn(),
  streamTaskExecution: vi.fn(),
  cancelDeepAnalysisRun: vi.fn(),
  cancelFollowUpRun: vi.fn(),
}));
vi.mock("../../../../utils/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../utils/api")>()),
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
}));
vi.mock("../../../../composables/useTheme", async () => {
  const { ref } = await import("vue");
  return { useTheme: () => ({ isDark: ref(false) }) };
});
const plugins = () => [createI18n({ legacy: false, locale: "en", messages: { en } }), ElementPlus];
const dimensionAgent: AnalysisAgent = {
  id: "dimension",
  name: "Business analysis",
  description: "",
  executionMode: "dimension",
  reportDeliverableEnabled: true,
  summarizerPrompt: "Dimension report",
  conclusionMakerPrompt: "Summary",
  enabledMcpServiceNames: ["orders"],
  graphScope: { mode: "panorama" },
  isEnabled: true,
  createdAt: 1,
  updatedAt: 1,
};
async function dialog(editingAgent: AnalysisAgent | null = null) {
  const wrapper = mount(AgentCreateDialog, {
    props: { visible: false, editingAgent },
    global: {
      plugins: plugins(),
      stubs: {
        ElDialog: { template: "<div><slot/><slot name='footer'/></div>" },
        SkillSelector: true,
      },
    },
  });
  await wrapper.setProps({ visible: true });
  await flushPromises();
  return wrapper;
}
function choose(wrapper: Awaited<ReturnType<typeof dialog>>, label: string) {
  return wrapper
    .findAll(".el-radio")
    .find((radio) => radio.text() === label)!
    .find("input")
    .setValue(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiGet.mockResolvedValue({ data: [] });
  mocks.listMcpServiceNames.mockResolvedValue(["orders"]);
  mocks.apiPost.mockResolvedValue({ data: { classDef: [] } });
  mocks.createAgent.mockResolvedValue({ id: "new" });
  mocks.updateAgent.mockResolvedValue(dimensionAgent);
});

describe("agent product and execution modes", () => {
  it("defaults to analysis + loop and persists the selected product with one flag", async () => {
    const wrapper = await dialog();
    expect(wrapper.findAll(".el-radio.is-checked").map((item) => item.text())).toEqual([
      "Analysis",
      "Loop Execution",
      "Panorama",
    ]);
    await choose(wrapper, "Dimension Orchestration");
    expect(wrapper.text()).toContain("Dimension Report");
    await choose(wrapper, "General agent");
    expect(
      wrapper.findAll(".el-radio").some((item) => item.text() === "Dimension Orchestration")
    ).toBe(false);
    expect(wrapper.text()).toContain("General agents always use loop execution.");
    await wrapper.find("input.el-input__inner").setValue("Operations");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Save")!
      .trigger("click");
    await flushPromises();
    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Operations",
        reportDeliverableEnabled: false,
        executionMode: "loop",
        enabledMcpServiceNames: [],
      })
    );
    expect(mocks.createAgent.mock.calls[0][0]).not.toHaveProperty("productMode");
    wrapper.unmount();
  });

  it("preserves a stored dimension agent, and MCP list failure only disables MCP selection", async () => {
    mocks.listMcpServiceNames.mockRejectedValue(new Error("MCP unavailable"));
    const wrapper = await dialog(dimensionAgent);
    expect(wrapper.findAll(".el-radio.is-checked").map((item) => item.text())).toEqual([
      "Analysis",
      "Dimension Orchestration",
      "Panorama",
    ]);
    await choose(wrapper, "Loop Execution");
    await flushPromises();
    expect(wrapper.text()).toContain("The external MCP service list could not be loaded");
    expect(
      wrapper.findAll(".el-select").some((select) => select.find(".is-disabled").exists())
    ).toBe(true);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Save")!
      .trigger("click");
    await flushPromises();
    expect(mocks.updateAgent).toHaveBeenCalledWith(
      "dimension",
      expect.objectContaining({
        reportDeliverableEnabled: true,
        executionMode: "loop",
        enabledMcpServiceNames: ["orders"],
      })
    );
    wrapper.unmount();
  });

  it("defaults historical agents to Panorama without changing related classes", async () => {
    const { graphScope: _scope, ...historicalAgent } = dimensionAgent;
    const wrapper = await dialog({ ...historicalAgent, classNames: ["Invoice"] } as AnalysisAgent);
    expect(wrapper.findComponent(ElInputNumber).exists()).toBe(false);
    await wrapper.findAll("button").find((button) => button.text() === "Save")!.trigger("click");
    await flushPromises();
    expect(mocks.updateAgent).toHaveBeenCalledWith("dimension", expect.objectContaining({
      graphScope: { mode: "panorama" },
      classNames: ["Invoice"],
    }));
    const payload = mocks.updateAgent.mock.calls[0][1];
    expect(payload).not.toHaveProperty("graphScopeMode");
    expect(payload).not.toHaveProperty("graphScopeRootClassNames");
    expect(payload).not.toHaveProperty("graphScopeMaxDepth");
    wrapper.unmount();
  });

  it("uses objectClasses for roots, validates Subgraph, and saves depth zero independently of classNames", async () => {
    mocks.apiPost.mockResolvedValue({ data: { classDef: [
      { className: "Order", showName: "Orders" },
      { className: "Invoice", classDesc: "Invoices" },
    ] } });
    const wrapper = await dialog();
    await wrapper.find("input.el-input__inner").setValue("Scoped agent");
    await choose(wrapper, "Subgraph");
    const depth = wrapper.findComponent(ElInputNumber);
    expect(depth.props()).toMatchObject({ modelValue: 1, min: 0, max: 10, step: 1, stepStrictly: true });
    const roots = wrapper.findAllComponents(ElSelect).find((select) =>
      select.props("ariaLabel") === "Root Classes"
    )!;
    expect(roots.props("multiple")).toBe(true);
    expect(roots.findAllComponents(ElOption).map((option) => [option.props("label"), option.props("value")])).toEqual([
      ["Orders (Order)", "Order"], ["Invoices (Invoice)", "Invoice"],
    ]);
    const save = () => wrapper.findAll("button").find((button) => button.text() === "Save")!.trigger("click");
    await save();
    expect(mocks.createAgent).not.toHaveBeenCalled();
    roots.vm.$emit("update:modelValue", ["Order"]);
    depth.vm.$emit("update:modelValue", undefined);
    await save();
    expect(mocks.createAgent).not.toHaveBeenCalled();
    depth.vm.$emit("update:modelValue", 11);
    await save();
    expect(mocks.createAgent).not.toHaveBeenCalled();
    depth.vm.$emit("update:modelValue", 0);
    await save();
    await flushPromises();
    expect(mocks.createAgent).toHaveBeenCalledWith(expect.objectContaining({
      graphScope: { mode: "subgraph", rootClassNames: ["Order"], maxDepth: 0 },
      classNames: [],
    }));
    wrapper.unmount();
  });

  it("loads and copies a stored Subgraph, preserves it across mode switches, and resets on reopen", async () => {
    const agent: AnalysisAgent = {
      ...dimensionAgent,
      classNames: ["Invoice"],
      graphScope: { mode: "subgraph", rootClassNames: ["Order"], maxDepth: 10 },
    };
    const wrapper = await dialog(agent);
    expect(wrapper.findComponent(ElInputNumber).props("modelValue")).toBe(10);
    const roots = () => wrapper.findAllComponents(ElSelect).find((select) =>
      select.props("ariaLabel") === "Root Classes"
    )!;
    expect(roots().props("modelValue")).toEqual(["Order"]);
    expect(roots().props("modelValue")).not.toBe(agent.graphScope.mode === "subgraph" && agent.graphScope.rootClassNames);
    await choose(wrapper, "Panorama");
    expect(wrapper.findComponent(ElInputNumber).exists()).toBe(false);
    await choose(wrapper, "Subgraph");
    expect(roots().props("modelValue")).toEqual(["Order"]);
    expect(wrapper.findComponent(ElInputNumber).props("modelValue")).toBe(10);
    await wrapper.findAll("button").find((button) => button.text() === "Save")!.trigger("click");
    await flushPromises();
    expect(mocks.updateAgent).toHaveBeenCalledWith("dimension", expect.objectContaining({
      graphScope: agent.graphScope, classNames: ["Invoice"],
    }));
    await wrapper.setProps({ visible: false, editingAgent: null });
    await wrapper.setProps({ visible: true });
    expect(wrapper.findAll(".el-radio.is-checked").map((item) => item.text())).toContain("Panorama");
    await choose(wrapper, "Subgraph");
    expect(roots().props("modelValue")).toEqual([]);
    expect(wrapper.findComponent(ElInputNumber).props("modelValue")).toBe(1);
    wrapper.unmount();
  });
});
