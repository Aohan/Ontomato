import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import ElementPlus from "element-plus";
import { Browser } from "happy-dom";
import { workbenchI18n } from "../../../i18n";
import { installAuthHost } from "../../../utils/auth";
import SkillManager from "../components/SkillManager.vue";
import { anonymousAuthHost } from "../../../../../../apps/workbench/web/src/auth";
// Auth host: credential and signed-in user are mutable, other methods reuse the verified anonymous host; the anonymous host is restored after each test.
const credentials: { token: string | null; apiKey: string | null } = { token: null, apiKey: null };
let userInfo: { userId: string; domainId: string } | null = null;
const i18n = workbenchI18n();
beforeEach(() => {
  installAuthHost({
    ...anonymousAuthHost,
    getToken: () => credentials.token,
    getApiKey: () => credentials.apiKey,
    getUserInfo: () => userInfo,
  });
});
afterEach(() => {
  installAuthHost(anonymousAuthHost);
  credentials.token = null;
  credentials.apiKey = null;
  userInfo = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
// Public surface: the mounted export action's navigation Request, including its URL and headers.
it.each(["token", "apiKey"])(
  "downloads a skill with only the current %s credential",
  async (credential) => {
    const pageDocument = document;
    userInfo = { userId: "forged-user", domainId: "forged-domain" };
    credentials.apiKey = "key-value";
    if (credential === "token") credentials.token = "token-value";
    let received!: (request: { url: string; headers: Record<string, string> }) => void;
    const download = new Promise<{ url: string; headers: Record<string, string> }>((resolve) => {
      received = resolve;
    });
    const browser = new Browser({
      settings: {
        fetch: {
          interceptor: {
            beforeAsyncRequest: async ({ request, window: target }) => {
              received({
                url: request.url,
                headers: Object.fromEntries(request.headers.entries()),
              });
              return new target.Response("", { status: 204 });
            },
          },
        },
      },
    });
    const page = browser.newPage();
    page.url = "http://localhost:3000/";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            skills: [
              {
                id: "analysis-skill",
                type: "knowledge",
                category: "analysis",
                tags: [],
                enabled: true,
                version: "1",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } }
        )
    );
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: SkillManager }],
    });
    await router.push("/");
    const wrapper = mount(SkillManager, {
      attachTo: document.body,
      global: { plugins: [i18n, ElementPlus, router] },
    });
    try {
      await flushPromises();
      await wrapper.get(".more-btn").trigger("click");
      await flushPromises();
      const item = [...document.querySelectorAll(".el-dropdown-menu__item")].find(
        (element) => element.textContent?.trim() === i18n.global.t("common.export")
      )!;
      // A Browser page can navigate; Vitest's detached window only updates location.
      const anchor = page.mainFrame.window.HTMLAnchorElement.prototype;
      const click = anchor.click;
      vi.spyOn(anchor, "click").mockImplementation(function (this: typeof anchor) {
        queueMicrotask(() => click.call(this));
      });
      vi.stubGlobal("document", page.mainFrame.document);
      (item as HTMLElement).click();
      vi.stubGlobal("document", pageDocument);
      const request = await download;
      await browser.waitUntilComplete();
      const url = new URL(request.url);
      expect(url.pathname).toBe("/api/skills/analysis-skill/export");
      expect(Object.fromEntries(url.searchParams)).toEqual(
        credential === "token" ? { tk: "token-value" } : { apiKey: "key-value" }
      );
      expect(JSON.stringify(request.headers)).not.toMatch(
        /domain.?id|user.?id|forged-domain|forged-user/i
      );
    } finally {
      wrapper.unmount();
      await browser.close();
    }
  }
);
