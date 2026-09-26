import { beforeEach, describe, expect, it } from "vitest";
import { createApp, h, nextTick } from "vue";
import ElementPlus from "element-plus";
import en from "element-plus/es/locale/lang/en";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { installWorkbenchI18n } from "../i18n";
import { installAuthHost } from "../utils/auth";
import {
  installOntologyManagerEntry,
  type OntologyManagerEntryConfig,
} from "../views/admin/manager-entry-config";
import { adminRoutes } from "../router/admin-routes";

// config/app.ts 在导入时读取运行配置。
window.__APP_CONFIG__ = { ONTOLOGY_MANAGER_URL: "http://manager.test/" };

const enterpriseEntry: OntologyManagerEntryConfig = {
  themeMessage: "data-agent-theme",
  localeMessage: "data-agent-locale",
  frameTitle: "本体管理器",
  missingUrlTitle: "",
  missingUrlDescription: "",
};
const ossEntry: OntologyManagerEntryConfig = { ...enterpriseEntry, themeMessage: "ontomato-theme", localeMessage: null };

async function managerFrameUrl(path: string, entry: OntologyManagerEntryConfig, token: string | null, apiKey: string | null) {
  installOntologyManagerEntry(entry);
  installAuthHost({
    getToken: () => token,
    getApiKey: () => apiKey,
    responseStatusError: () => null,
    getUserInfo: () => null,
    verifySessionOnce: () => Promise.resolve("valid"),
    handleAuthExpired: () => {},
  });
  const i18n = installWorkbenchI18n({
    supported: ["zh-CN", "en"],
    defaultLocale: "zh-CN",
    initialLocale: "en",
    switchEnabled: true,
    save: null,
    messages: {},
    elementLocale: () => en,
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/admin", component: RouterView, children: [adminRoutes.ontologyManager, adminRoutes.visualModeling] }],
  });
  await router.push(path);
  const el = document.createElement("div");
  document.body.append(el);
  const app = createApp({ render: () => h(RouterView) }).use(i18n).use(ElementPlus).use(router);
  app.mount(el);
  await router.isReady();
  await new Promise((resolve) => setTimeout(resolve));
  await nextTick();
  const src = el.querySelector("iframe")?.getAttribute("src");
  // 卸载最后一个应用时路由器把 currentRoute 复位为起点，须在卸载前读取。
  const route = router.currentRoute.value;
  app.unmount();
  return { url: new URL(src!), route };
}

describe("Manager 入口", () => {
  beforeEach(() => localStorage.clear());

  it("旧可视化建模路由带 focus/id/back 进入 Manager 入口，其余 query 不带入", async () => {
    const { url, route } = await managerFrameUrl(
      "/admin/ontology/visual-modeling?focus=object&id=Order&back=playground&tk=leak&keep=1",
      enterpriseEntry,
      "tok",
      null
    );
    expect(route.path).toBe("/admin/ontology-manager");
    expect(route.query).toEqual({ focus: "object", id: "Order", back: "playground", view: "visual-modeling" });
    expect(Object.fromEntries(url.searchParams)).toEqual({
      view: "visual-modeling",
      focus: "object",
      id: "Order",
      back: "playground",
      theme: "light",
      locale: "en",
      tk: "tok",
    });
    expect(url.hash).toBe("");
  });

  it("企业：token 优先，无 token 时带 apiKey；开源不带 locale，无凭据时不带凭据参数", async () => {
    const withKey = await managerFrameUrl("/admin/ontology-manager?view=assets", enterpriseEntry, null, "key");
    expect(withKey.url.searchParams.get("apiKey")).toBe("key");
    expect(withKey.url.searchParams.get("tk")).toBeNull();

    const oss = await managerFrameUrl("/admin/ontology-manager?view=data-browser", ossEntry, null, null);
    expect(Object.fromEntries(oss.url.searchParams)).toEqual({ view: "data-browser", theme: "light" });
  });
});
