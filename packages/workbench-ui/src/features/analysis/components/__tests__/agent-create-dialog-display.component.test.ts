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

describe("新建智能体弹窗在两版布局下的展示输入", () => {
  it("企业不传：左栏表单星号在左、下拉不随输入框宽、标签不换行", async () => {
    const wrapper = await dialog({});
    const items = wrapper.findAll(".form-left .el-form-item");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.classes()).toContain("asterisk-left");
    expect(wrapper.findAllComponents(ElSelect).map((select) => select.props("fitInputWidth"))).not.toContain(true);
    expect(wrapper.find(".agent-form-layout").classes()).toContain("agent-form-layout--label-nowrap");
  });

  it("开源传入：左栏表单星号在右、MCP 下拉随输入框宽、标签换行", async () => {
    const wrapper = await dialog({ requireAsteriskPosition: "right", fitInputWidth: true, labelWrap: true });
    const items = wrapper.findAll(".form-left .el-form-item");
    for (const item of items) expect(item.classes()).toContain("asterisk-right");
    expect(wrapper.findAllComponents(ElSelect).map((select) => select.props("fitInputWidth"))).toContain(true);
    expect(wrapper.find(".agent-form-layout").classes()).toContain("agent-form-layout--label-wrap");
  });
});
