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
          agentsAndSkills: "Agents and Skills",
          systemAgents: "System Agents",
          systemManagement: "System Management",
          auditLogs: "Audit Logs",
        },
        navDescription: { auditLogs: "Operation logs" },
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
          { path: "system-agents", component: page, meta: { group: "app-capabilities" } },
          { path: "audit-log", component: page, meta: { group: "platform-management" } },
          { path: "knowledge-governance/:sessionId?", name: "KnowledgeGovernance", component: page },
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
  const activeTab = () => el.querySelector(".tab-item.active")?.textContent?.trim();
  const activeMenu = () => el.querySelector(".admin-menu .is-active .menu-item-title")?.textContent?.trim();
  return { el, router, tabs, menu, activeTab, activeMenu };
}

const base: AdminLayoutConfig = {
  access: { ready: true, can: () => true },
  groups: [adminGroups.dataAssets, adminGroups.platformManagement],
  items: [adminMenuItems.auditLog],
  actionTabs: [],
  account: null,
  navigationHidden: false,
};

describe("shared admin layout", () => {
  it("open-source assembly: all tabs, the current route group's menu and the observe entry; no account and no language switch", async () => {
    const { el, tabs, menu } = await mountLayout(base, "/admin/audit-log");
    expect(tabs()).toEqual(["Ontology Manager", "System Management"]);
    expect(el.querySelector(".tab-item.active")?.textContent?.trim()).toBe("System Management");
    expect(menu()).toEqual(["Audit Logs"]);
    expect(el.querySelector(".icon-btn")).not.toBeNull();
    expect(el.querySelector(".user-name")).toBeNull();
    expect(el.querySelector(".lang-switch-wrapper")).toBeNull();
  });

  it("the home-style tab (Ontology Manager) shows by ontology-modeling and hides the sidebar; the observe entry is hidden without its permission; the language switch follows the app setting", async () => {
    const granted = new Set(["ontology-modeling"]);
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

  it("without ontology-modeling the Ontology Manager tab is hidden (the old group permission intelligence-engine no longer grants it)", async () => {
    const granted = new Set(["intelligence-engine", "audit-logs"]);
    const { tabs } = await mountLayout(
      { ...base, access: { ready: true, can: (p) => granted.has(p) } },
      "/admin/audit-log"
    );
    expect(tabs()).toEqual(["System Management"]);
  });

  it("group landing: a home-style tab opens its home page, a menu tab opens the group's first visible menu item", async () => {
    const { el, router } = await mountLayout(base, "/admin/audit-log");
    const tab = (title: string) =>
      [...el.querySelectorAll<HTMLElement>(".header-tabs .tab-item")].find(
        (item) => item.textContent?.trim() === title
      )!;
    const settle = () => new Promise((resolve) => setTimeout(resolve));
    tab("Ontology Manager").click();
    await settle();
    expect(router.currentRoute.value.path).toBe("/admin/ontology-manager");
    expect(el.querySelector(".admin-aside")).toBeNull();
    tab("System Management").click();
    await settle();
    expect(router.currentRoute.value.path).toBe("/admin/audit-log");
    expect(el.querySelector(".admin-aside")).not.toBeNull();
  });

  it("shows loading until permissions load, then selects the current route's group; shows the empty state without any permission", async () => {
    const access = reactive({ ready: false, can: () => true });
    const { el } = await mountLayout({ ...base, access }, "/admin/audit-log");
    expect(el.querySelector(".permission-loading")?.textContent).toContain("Loading");
    access.ready = true;
    await nextTick();
    expect(el.querySelector(".tab-item.active")?.textContent?.trim()).toBe("System Management");

    const none = await mountLayout({ ...base, access: { ready: true, can: () => false } }, "/admin/audit-log");
    expect(none.el.querySelector(".permission-empty")?.textContent).toContain("No access");
  });

  it("action tabs come before groups and only run their action without becoming current; account display and logout", async () => {
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

  it("a menu item shows with any one of its permissions (system agents: observer or business-knowledge)", async () => {
    const config = (granted: string[]): AdminLayoutConfig => ({
      ...base,
      groups: [adminGroups.appCapabilities],
      items: [adminMenuItems.systemAgents],
      access: { ready: true, can: (p) => granted.includes(p) },
    });
    expect((await mountLayout(config(["observer"]), "/admin/system-agents")).menu()).toEqual(["System Agents"]);
    expect((await mountLayout(config(["business-knowledge"]), "/admin/system-agents")).menu()).toEqual([
      "System Agents",
    ]);
    const none = await mountLayout(config([]), "/admin/system-agents");
    expect(none.el.querySelector(".permission-empty")).not.toBeNull();
  });

  it("menu pages show their title and description above the content; the home-style page does not", async () => {
    const { el } = await mountLayout(base, "/admin/audit-log");
    expect(el.querySelector(".admin-page-heading h1")?.textContent).toBe("Audit Logs");
    expect(el.querySelector(".admin-page-heading p")?.textContent).toBe("Operation logs");
    const home = await mountLayout(base, "/admin/ontology-manager");
    expect(home.el.querySelector(".admin-page-heading")).toBeNull();
  });

  it("knowledge governance highlights the tab and menu of the page it was opened from; without a valid from, system agents", async () => {
    const config: AdminLayoutConfig = {
      ...base,
      groups: [adminGroups.dataAssets, adminGroups.appCapabilities, adminGroups.platformManagement],
      items: [adminMenuItems.systemAgents, adminMenuItems.auditLog],
    };
    const fromManager = await mountLayout(
      config,
      "/admin/knowledge-governance?from=" + encodeURIComponent("/admin/ontology-manager?view=knowledge")
    );
    expect(fromManager.activeTab()).toBe("Ontology Manager");
    expect(fromManager.el.querySelector(".admin-aside")).toBeNull();
    expect(fromManager.el.querySelector(".admin-page-heading")).toBeNull();

    for (const path of [
      "/admin/knowledge-governance?from=/admin/system-agents",
      "/admin/knowledge-governance",
      "/admin/knowledge-governance?from=https://example.com/admin/",
    ]) {
      const layout = await mountLayout(config, path);
      expect(layout.activeTab()).toBe("Agents and Skills");
      expect(layout.activeMenu()).toBe("System Agents");
    }
  });

  it("navigating to a menu page of another group switches the tab and the sidebar menu", async () => {
    const { router, activeTab, menu, activeMenu } = await mountLayout(
      {
        ...base,
        groups: [adminGroups.appCapabilities, adminGroups.platformManagement],
        items: [adminMenuItems.systemAgents, adminMenuItems.auditLog],
      },
      "/admin/audit-log"
    );
    expect([activeTab(), menu(), activeMenu()]).toEqual(["System Management", ["Audit Logs"], "Audit Logs"]);
    await router.push("/admin/system-agents");
    await nextTick();
    expect([activeTab(), menu(), activeMenu()]).toEqual([
      "Agents and Skills",
      ["System Agents"],
      "System Agents",
    ]);
  });

  it("hidden navigation (restricted licensing): only back, title, theme and account, and the page still renders", async () => {
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
