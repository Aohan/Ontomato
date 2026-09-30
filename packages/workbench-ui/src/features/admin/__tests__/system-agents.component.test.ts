import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { createMemoryHistory, createRouter } from "vue-router";
import SystemAgents from "../components/SystemAgents.vue";
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
      { path: "/admin/system-agents", component: page },
      { path: "/admin/knowledge-governance/:sessionId?", name: "KnowledgeGovernance", component: page },
      { path: "/observe/diagnosis", name: "ObserveDiagnosis", component: page },
    ],
  });
  await router.push("/admin/system-agents");
  const wrapper = mount(SystemAgents, {
    global: {
      plugins: [i18n, ElementPlus, router],
      provide: { [adminAccessKey as symbol]: { ready: true, can: (p: string) => granted.includes(p) } },
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  const cards = () => wrapper.findAll(".system-agent-card h3").map((item) => item.text());
  return { wrapper, router, cards };
}

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
});

describe("system agents page", () => {
  it("each entry card shows by its own permission", async () => {
    expect((await mountPage(["observer", "business-knowledge"])).cards()).toEqual([
      t("admin.opsAgent"),
      t("governance.title"),
    ]);
    expect((await mountPage(["observer"])).cards()).toEqual([t("admin.opsAgent")]);
    expect((await mountPage(["business-knowledge"])).cards()).toEqual([t("governance.title")]);
  });

  it("the operations agent opens the observability diagnosis page in a new window; knowledge governance opens inside the admin console with this page as its return target", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { wrapper, router } = await mountPage(["observer", "business-knowledge"]);
    const [ops, governance] = wrapper.findAll(".system-agent-card");
    await ops!.find("button").trigger("click");
    expect(open).toHaveBeenCalledWith("/observe/diagnosis", "_blank");
    await governance!.find("button").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/admin/knowledge-governance");
    expect(router.currentRoute.value.query.from).toBe("/admin/system-agents");
  });
});
