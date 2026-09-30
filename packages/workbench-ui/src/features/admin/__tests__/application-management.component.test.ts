import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { createMemoryHistory, createRouter } from "vue-router";
import ApplicationManagement from "../components/ApplicationManagement.vue";
import { adminAccessKey } from "../navigation";
import { workbenchI18n } from "../../../i18n";

const i18n = workbenchI18n();
const t = i18n.global.t;

const page = { template: "<div />" };
const wrappers: ReturnType<typeof mount>[] = [];

async function mountPage(granted: readonly string[]) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/admin/analysis", component: page },
      { path: "/admin/knowledge-governance/:sessionId?", name: "KnowledgeGovernance", component: page },
      { path: "/observe/diagnosis", name: "ObserveDiagnosis", component: page },
    ],
  });
  await router.push("/admin/analysis?section=system-agents");
  const wrapper = mount(ApplicationManagement, {
    global: {
      plugins: [i18n, ElementPlus, router],
      provide: { [adminAccessKey as symbol]: { ready: true, can: (p: string) => granted.includes(p) } },
      stubs: { AnalysisAgentManager: true, HotReportManager: true },
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  const tabs = () => wrapper.findAll(".el-tabs__item").map((item) => item.text());
  const cards = () => wrapper.findAll(".system-agent-card h3").map((item) => item.text());
  return { wrapper, router, tabs, cards };
}

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
});

describe("分析智能体页的系统智能体页签", () => {
  it("两张入口卡各按自己的权限显示；都没有权限时不显示页签", async () => {
    const all = await mountPage(["observer", "business-knowledge"]);
    expect(all.tabs()).toContain(t("admin.systemAgents"));
    expect(all.cards()).toEqual([t("admin.opsAgent"), t("governance.title")]);

    const opsOnly = await mountPage(["observer"]);
    expect(opsOnly.cards()).toEqual([t("admin.opsAgent")]);

    const governanceOnly = await mountPage(["business-knowledge"]);
    expect(governanceOnly.cards()).toEqual([t("governance.title")]);

    const none = await mountPage([]);
    expect(none.tabs()).not.toContain(t("admin.systemAgents"));
    expect(none.wrapper.find(".system-agent-card").exists()).toBe(false);
  });

  it("运维智能体在新窗口打开可观测性的诊断页；业务知识治理在后台内打开", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { wrapper, router } = await mountPage(["observer", "business-knowledge"]);
    const [ops, governance] = wrapper.findAll(".system-agent-card");
    await ops!.find("button").trigger("click");
    expect(open).toHaveBeenCalledWith("/observe/diagnosis", "_blank");
    await governance!.find("button").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/admin/knowledge-governance");
  });
});
