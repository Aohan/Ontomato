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
import { adminAccessKey } from "../features/admin/navigation";

// config/app.ts reads the runtime config on import.
window.__APP_CONFIG__ = { ONTOLOGY_MANAGER_URL: "http://manager.test/" };

const enterpriseEntry: OntologyManagerEntryConfig = {
  themeMessage: "data-agent-theme",
  localeMessage: "data-agent-locale",
  frameTitle: "Ontology Manager",
  missingUrlTitle: "",
  missingUrlDescription: "",
};
const ossEntry: OntologyManagerEntryConfig = { ...enterpriseEntry, themeMessage: "ontomato-theme", localeMessage: null };

async function managerFrameUrl(
  path: string,
  entry: OntologyManagerEntryConfig,
  token: string | null,
  apiKey: string | null,
  granted: readonly string[] = []
) {
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
    routes: [
      {
        path: "/admin",
        component: RouterView,
        children: [adminRoutes.ontologyManager, adminRoutes.visualModeling, adminRoutes.knowledgeGovernance],
      },
    ],
  });
  await router.push(path);
  const el = document.createElement("div");
  document.body.append(el);
  const app = createApp({ render: () => h(RouterView) }).use(i18n).use(ElementPlus).use(router);
  app.provide(adminAccessKey, { ready: true, can: (permission) => granted.includes(permission) });
  app.mount(el);
  await router.isReady();
  await new Promise((resolve) => setTimeout(resolve));
  await nextTick();
  const src = el.querySelector("iframe")?.getAttribute("src");
  // Unmounting the last app resets the router's currentRoute to the start, so read it before unmounting.
  const route = router.currentRoute.value;
  app.unmount();
  return { url: new URL(src!), route };
}

describe("Manager entry", () => {
  beforeEach(() => localStorage.clear());

  it("the old visual modeling route enters the Manager entry with focus/id/back and drops the rest of the query", async () => {
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
      embedded: "1",
      tk: "tok",
    });
    expect(url.hash).toBe("");
  });

  it("with locale sync: token first, apiKey without a token; open source sends no locale and no credential parameter without a credential", async () => {
    const withKey = await managerFrameUrl("/admin/ontology-manager?view=assets", enterpriseEntry, null, "key");
    expect(withKey.url.searchParams.get("apiKey")).toBe("key");
    expect(withKey.url.searchParams.get("tk")).toBeNull();

    const oss = await managerFrameUrl("/admin/ontology-manager?view=data-browser", ossEntry, null, null);
    expect(Object.fromEntries(oss.url.searchParams)).toEqual({ view: "data-browser", theme: "light", embedded: "1" });
  });

  it("passes the absolute knowledge governance URL (returning to the Manager's knowledge page) with business-knowledge permission and omits it without", async () => {
    const granted = await managerFrameUrl("/admin/ontology-manager", ossEntry, null, null, ["business-knowledge"]);
    const governance = new URL(granted.url.searchParams.get("knowledgeGovernanceUrl")!);
    expect(governance.origin + governance.pathname).toBe(`${window.location.origin}/admin/knowledge-governance`);
    expect(governance.searchParams.get("from")).toBe("/admin/ontology-manager?view=knowledge");
    const denied = await managerFrameUrl("/admin/ontology-manager", ossEntry, null, null, ["ontology-modeling"]);
    expect(denied.url.searchParams.has("knowledgeGovernanceUrl")).toBe(false);
  });
});
