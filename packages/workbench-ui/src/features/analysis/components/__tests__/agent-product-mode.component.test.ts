import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ElementPlus, { ElInputNumber, ElSelect, ElOption, ElMessageBox, ElSwitch } from "element-plus";
import CodeMirrorEditor from "../../../../components/CodeMirrorEditor.vue";
import AgentCreateDialog from "../AgentCreateDialog.vue";
import en from "../../../../locales/en";
import type { AnalysisAgent } from "@ontomato/contracts/analysis-agent";

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  listMcpServiceNames: vi.fn(),
  listHotReports: vi.fn(),
  updateCardStatus: vi.fn(),
}));
vi.mock("../../../mcp/api", () => ({ listMcpServiceNames: mocks.listMcpServiceNames }));
vi.mock("../../api", () => ({
  analysisAgentApi: mocks,
  analysisTaskApi: {},
  analysisReportApi: { updateCardStatus: mocks.updateCardStatus },
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
        ElDrawer: { template: "<div><slot/><slot name='footer'/></div>" },
        SkillSelector: true,
        CodeMirrorEditor: true,
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
    .find((radio) => (radio.find('.mode-title').exists() ? radio.find('.mode-title').text() : radio.text()) === label)!
    .find("input")
    .setValue(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiGet.mockResolvedValue({ data: [] });
  mocks.listMcpServiceNames.mockResolvedValue(["orders"]);
    mocks.apiPost.mockResolvedValue({ data: { classDef: [], relationship_rule: {} } });
  mocks.createAgent.mockResolvedValue({ id: "new" });
  mocks.updateAgent.mockResolvedValue(dimensionAgent);
  mocks.listHotReports.mockResolvedValue([]);
  mocks.updateCardStatus.mockResolvedValue({});
});

describe("agent product and execution modes", () => {
  it("preserves all persisted configuration when editing without changes", async () => {
    const agent = {
      ...dimensionAgent,
      description: "Existing description",
      loopPrompt: "Loop instructions",
      analysisDimensionPrompt: "Dimensions",
      enabledSkillIds: ["analysis-skill"],
      enabledVisualizationSkillIds: ["chart-skill"],
      hotReportEnabled: false,
      summaryPosition: "top" as const,
      classNames: ["Invoice"],
      isEnabled: false,
      sortOrder: 7,
      icon: JSON.stringify({ key: "Brain", color: "#not-a-palette-color" }),
    };
    const wrapper = await dialog(agent);
    await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    await flushPromises();
    const payload = mocks.updateAgent.mock.calls[0][1];
    for (const key of ["name", "description", "executionMode", "loopPrompt", "analysisDimensionPrompt",
      "summarizerPrompt", "conclusionMakerPrompt", "enabledSkillIds", "enabledVisualizationSkillIds",
      "enabledMcpServiceNames", "reportDeliverableEnabled", "hotReportEnabled", "summaryPosition",
      "classNames", "graphScope", "isEnabled", "sortOrder"] as const) {
      expect(payload[key], key).toEqual(agent[key]);
    }
    expect(payload).not.toHaveProperty("activeSection");
    expect(payload).not.toHaveProperty("promptTab");
    wrapper.unmount();
  });

  it("retains drafts on save failure and keeps report publication immediate", async () => {
    mocks.listHotReports.mockResolvedValue([{ id: "report-1", question: "Sales", status: "UNUSED" }]);
    mocks.updateAgent.mockRejectedValueOnce(new Error("Save failed"));
    const wrapper = await dialog(dimensionAgent);
    await wrapper.findAll(".agent-editor-nav button").find(button => button.text() === "Reports & display")!.trigger("click");
    wrapper.find(".hot-report-list").findComponent(ElSwitch).vm.$emit("change", true);
    await flushPromises();
    expect(mocks.updateCardStatus).toHaveBeenCalledWith("report-1", "PUBLISHED");
    expect(mocks.updateAgent).not.toHaveBeenCalled();
    await wrapper.findAll(".agent-editor-nav button").find(button => button.text() === "Basic Info")!.trigger("click");
    await wrapper.find("input.el-input__inner").setValue("Unsaved agent");
    await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    await flushPromises();
    expect(wrapper.emitted("update:visible")).toBeUndefined();
    expect((wrapper.find("input.el-input__inner").element as HTMLInputElement).value).toBe("Unsaved agent");
    wrapper.unmount();
  });
  it("opens editing on prompts, preserves separate prompt drafts and previews Markdown", async () => {
    const wrapper = await dialog(dimensionAgent);
    expect(wrapper.find('.agent-editor-nav button[aria-current="page"]').text()).toBe("Prompt Configuration");
    const editor = () => wrapper.findComponent(CodeMirrorEditor);
    editor().vm.$emit("update:modelValue", "# Evidence\n\nUse source data.");
    await flushPromises();
    await wrapper.findAll(".el-segmented__item").find(item => item.text() === "Dimension Report")!.find("input").setValue(true);
    expect(editor().props("modelValue")).toBe("Dimension report");
    editor().vm.$emit("update:modelValue", "Updated dimension report");
    await flushPromises();
    await wrapper.findAll(".el-segmented__item")[0].find("input").setValue(true);
    expect(editor().props("modelValue")).toBe("# Evidence\n\nUse source data.");
    await wrapper.findAll(".el-radio-button").find(item => item.text() === "Preview")!.find("input").setValue(true);
    expect(wrapper.find(".prompt-preview h1").text()).toBe("Evidence");
    await wrapper.findAll(".agent-editor-nav button").find(button => button.text() === "Skills & tools")!.trigger("click");
    expect(wrapper.findAllComponents(ElSelect).filter(select => select.props("ariaLabel") === "External MCP Services")).toHaveLength(1);
    expect(wrapper.findAllComponents(ElSelect).every(select => select.props("fitInputWidth") === true)).toBe(true);
    await wrapper.findAll("button").find(button => button.text() === "Save")!.trigger("click");
    await flushPromises();
    expect(mocks.updateAgent).toHaveBeenCalledWith("dimension", expect.objectContaining({
      analysisDimensionPrompt: "# Evidence\n\nUse source data.", summarizerPrompt: "Updated dimension report",
    }));
    wrapper.unmount();
  });

  it("keeps drafts when leaving is cancelled and closes only after discarding", async () => {
    const confirm = vi.spyOn(ElMessageBox, "confirm");
    const wrapper = await dialog();
    await wrapper.find("input.el-input__inner").setValue("Draft");
    const back = () => wrapper.findAll("button").find(button => button.text() === "Back")!;
    confirm.mockRejectedValueOnce("cancel");
    await back().trigger("click");
    await flushPromises();
    expect(wrapper.emitted("update:visible")).toBeUndefined();
    confirm.mockResolvedValueOnce("confirm" as Awaited<ReturnType<typeof ElMessageBox.confirm>>);
    await back().trigger("click");
    await flushPromises();
    expect(wrapper.emitted("update:visible")).toEqual([[false]]);
    confirm.mockRestore();
    wrapper.unmount();
  });
  it("defaults to analysis + loop and persists the selected product with one flag", async () => {
    const wrapper = await dialog();
    expect(wrapper.findAll(".el-radio.is-checked").map((item) => item.find('.mode-title').exists() ? item.find('.mode-title').text() : item.text())).toEqual([
      "Analysis",
      "Loop Execution",
      "Panorama",
    ]);
    await choose(wrapper, "Dimension Orchestration");
    await wrapper.findAll(".agent-editor-nav button").find(button => button.text() === "Prompt Configuration")!.trigger("click");
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
    expect(wrapper.findAll(".el-radio.is-checked").map((item) => item.find('.mode-title').exists() ? item.find('.mode-title').text() : item.text())).toEqual([
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

  it("selects subgraph roots from the ontology graph and previews the reachable class range", async () => {
    mocks.apiPost.mockResolvedValue({ data: {
      classDef: [{ className: "Order", showName: "Orders" }, { className: "Invoice", showName: "Invoices" }, { className: "Customer", showName: "Customers" }],
      relationship_rule: { orderInvoice: { fromclass: "Order", toclass: "Invoice" }, invoiceCustomer: { fromclass: "Invoice", toclass: "Customer" } },
    } });
    const wrapper = await dialog();
    await choose(wrapper, "Subgraph");
    expect(wrapper.findAll(".scope-graph-node")).toHaveLength(3);
    await wrapper.find(".scope-graph-node[aria-label='Orders (Order)']").trigger("click");
    expect(wrapper.find(".scope-graph-node[aria-label='Orders (Order)']").attributes("aria-pressed")).toBe("true");
    expect(wrapper.text()).toContain("1 roots · 2 classes in range");
    const roots = wrapper.findAllComponents(ElSelect).find((select) => select.props("ariaLabel") === "Root Classes")!;
    expect(roots.props("modelValue")).toEqual(["Order"]);
    await wrapper.findComponent(ElInputNumber).vm.$emit("update:modelValue", 2);
    expect(wrapper.text()).toContain("1 roots · 3 classes in range");
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
