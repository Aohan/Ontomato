import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ElementPlus, { ElSelect } from "element-plus";
import AgentCreateDialog from "../AgentCreateDialog.vue";
import en from "../../../../locales/en";

vi.mock("../../../mcp/api", () => ({ listMcpServiceNames: vi.fn(async () => []) }));
vi.mock("../../api", () => ({
  analysisAgentApi: {},
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
  apiGet: vi.fn(async () => ({ data: [] })),
  apiPost: vi.fn(async () => ({ data: { classDef: [] } })),
}));
vi.mock("../../../../composables/useTheme", async () => {
  const { ref } = await import("vue");
  return { useTheme: () => ({ isDark: ref(false) }) };
});

async function dialog(extra: Record<string, unknown>) {
  const wrapper = mount(AgentCreateDialog, {
    props: { visible: false, editingAgent: null, ...extra },
    global: {
      plugins: [createI18n({ legacy: false, locale: "en", messages: { en } }), ElementPlus],
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

describe("display inputs of the new agent dialog under both layouts", () => {
  it("when omitted: left-column asterisk on the left, dropdown not as wide as the input, labels not wrapped", async () => {
    const wrapper = await dialog({});
    const items = wrapper.findAll(".form-left .el-form-item");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.classes()).toContain("asterisk-left");
    expect(wrapper.findAllComponents(ElSelect).map((select) => select.props("fitInputWidth"))).not.toContain(true);
    expect(wrapper.find(".agent-form-layout").classes()).toContain("agent-form-layout--label-nowrap");
  });

  it("open-source input: left-column asterisk on the right, MCP dropdown as wide as the input, labels wrapped", async () => {
    const wrapper = await dialog({ requireAsteriskPosition: "right", fitInputWidth: true, labelWrap: true });
    const items = wrapper.findAll(".form-left .el-form-item");
    for (const item of items) expect(item.classes()).toContain("asterisk-right");
    expect(wrapper.findAllComponents(ElSelect).map((select) => select.props("fitInputWidth"))).toContain(true);
    expect(wrapper.find(".agent-form-layout").classes()).toContain("agent-form-layout--label-wrap");
  });
});
