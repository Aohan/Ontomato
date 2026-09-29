import { describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, reactive } from "vue";
import ElementPlus from "element-plus";
import en from "element-plus/es/locale/lang/en";
import { Wrench } from "lucide-vue-next";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import AdminLayout from "../features/admin/components/layout/AdminLayout.vue";
import { adminGroups, adminMenuItems, type AdminLayoutConfig } from "../features/admin/navigation";
import { installWorkbenchI18n } from "../i18n";

const page = { render: () => h("div", { class: "page" }) };

async function mountLayout(config: AdminLayoutConfig, path: string, switchEnabled = false) {
  const i18n = installWorkbenchI18n({
    supported: switchEnabled ? ["zh-CN", "en"] : ["en"],
    defaultLocale: "en",
    initialLocale: "en",
    switchEnabled,
    save: null,
    messages: {
      en: {
        nav: {
          ontologyManager: "Ontology Manager",
          systemManagement: "System Management",
          auditLogs: "Audit Logs",
        },
        admin: { loadingMenuPermission: "Loading", noAvailableMenuPermission: "No access" },
        common: { dataGovernance: "Data Governance" },
        user: { logout: "Logout" },
      },
    },
    elementLocale: () => en,
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/admin",
        component: AdminLayout,
        props: config,
        children: [
          { path: "ontology-manager", component: page, meta: { group: "data-assets" } },
          { path: "audit-log", component: page, meta: { group: "platform-management" } },
        ],
      },
    ],
  });
  await router.push(path);
  const el = document.createElement("div");
  document.body.append(el);
  createApp({ render: () => h(RouterView) }).use(i18n).use(ElementPlus).use(router).mount(el);
  await router.isReady();
  await nextTick();
  const tabs = () => [...el.querySelectorAll(".header-tabs .tab-item")].map((t) => t.textContent?.trim());
  const menu = () => [...el.querySelectorAll(".admin-menu .menu-item-title")].map((t) => t.textContent?.trim());
  return { el, router, tabs, menu };
}

const base: AdminLayoutConfig = {
  access: { ready: true, can: () => true },
  groups: [adminGroups.dataAssets, adminGroups.platformManagement],
  items: [adminMenuItems.auditLog],
  actionTabs: [],
  account: null,
  navigationHidden: false,
};

describe("共享管理布局", () => {
  it("开源装配：全部页签、当前路由所在组的菜单、观测入口；无账号、无语言切换", async () => {
    const { el, tabs, menu } = await mountLayout(base, "/admin/audit-log");
    expect(tabs()).toEqual(["Ontology Manager", "System Management"]);
    expect(el.querySelector(".tab-item.active")?.textContent?.trim()).toBe("System Management");
    expect(menu()).toEqual(["Audit Logs"]);
    expect(el.querySelector(".icon-btn")).not.toBeNull();
    expect(el.querySelector(".user-name")).toBeNull();
    expect(el.querySelector(".lang-switch-wrapper")).toBeNull();
  });

  it("首页型页签（Ontology Manager）隐藏左侧栏；无观测权限不显示观测入口；语言切换按应用开关", async () => {
    const granted = new Set(["intelligence-engine"]);
    const { el, tabs, menu } = await mountLayout(
      { ...base, access: { ready: true, can: (p) => granted.has(p) } },
      "/admin/ontology-manager",
      true
    );
    expect(tabs()).toEqual(["Ontology Manager"]);
    expect(menu()).toEqual([]);
    expect(el.querySelector(".admin-aside")).toBeNull();
    expect(el.querySelector(".icon-btn")).toBeNull();
    expect(el.querySelector(".lang-switch-wrapper")).not.toBeNull();
  });

  it("权限未加载显示加载中，就绪后定位到当前路由所在组；全无权限显示空态", async () => {
    const access = reactive({ ready: false, can: () => true });
    const { el } = await mountLayout({ ...base, access }, "/admin/audit-log");
    expect(el.querySelector(".permission-loading")?.textContent).toContain("Loading");
    access.ready = true;
    await nextTick();
    expect(el.querySelector(".tab-item.active")?.textContent?.trim()).toBe("System Management");

    const none = await mountLayout({ ...base, access: { ready: true, can: () => false } }, "/admin/audit-log");
    expect(none.el.querySelector(".permission-empty")?.textContent).toContain("No access");
  });

  it("动作页签排在分组前、只执行动作不成为当前页签；账号显示与退出", async () => {
    const select = vi.fn();
    const logout = vi.fn();
    const { el, tabs } = await mountLayout(
      {
        ...base,
        actionTabs: [{ key: "data-governance", titleKey: "common.dataGovernance", icon: Wrench, select }],
        account: { userName: "alice", logout },
      },
      "/admin/ontology-manager"
    );
    expect(tabs()).toEqual(["Data Governance", "Ontology Manager", "System Management"]);
    (el.querySelector(".header-tabs .tab-item") as HTMLElement).click();
    await nextTick();
    expect(select).toHaveBeenCalledOnce();
    expect(el.querySelector(".tab-item.active")?.textContent?.trim()).toBe("Ontology Manager");
    expect(el.querySelector(".user-name")?.textContent).toBe("alice");
    (el.querySelector(".logout-btn") as HTMLElement).click();
    expect(logout).toHaveBeenCalledOnce();
  });

  it("导航隐藏（企业授权受限）：只有返回、标题、主题与账号，页面照常渲染", async () => {
    const { el } = await mountLayout(
      { ...base, navigationHidden: true, account: { userName: "alice", logout: () => {} } },
      "/admin/audit-log"
    );
    expect(el.querySelector(".header-tabs")).toBeNull();
    expect(el.querySelector(".admin-aside")).toBeNull();
    expect(el.querySelector(".user-name")?.textContent).toBe("alice");
    expect(el.querySelector(".page")).not.toBeNull();
  });
});
