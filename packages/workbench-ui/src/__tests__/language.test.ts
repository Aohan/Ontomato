import { describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick } from "vue";
import ElementPlus from "element-plus";
import en from "element-plus/es/locale/lang/en";
import { createMemoryHistory, createRouter } from "vue-router";
import App from "../App.vue";
import { useLocale } from "../composables/useLocale";
import { installWorkbenchI18n, type SupportedLocale } from "../i18n";

async function mountWithLocale(initialLocale: SupportedLocale, save: ((l: SupportedLocale) => void) | null) {
  const i18n = installWorkbenchI18n({
    supported: ["zh-CN", "en"],
    defaultLocale: "zh-CN",
    initialLocale,
    switchEnabled: true,
    save,
    messages: {},
    elementLocale: () => en,
  });
  let locale!: ReturnType<typeof useLocale>["currentLocale"];
  const Probe = defineComponent({
    setup() {
      locale = useLocale().currentLocale;
      return () => h("div");
    },
  });
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: Probe }] });
  await router.push("/");
  createApp(App).use(i18n).use(ElementPlus).use(router).mount(document.createElement("div"));
  await router.isReady();
  await nextTick();
  return () => locale;
}

describe("app language profile", () => {
  it("writes the document language at startup and saves it through the app; switching to an unsupported locale returns to the default", async () => {
    const save = vi.fn();
    const locale = await mountWithLocale("en", save);
    expect(document.documentElement.lang).toBe("en");
    expect(save).toHaveBeenLastCalledWith("en");
    locale().value = "ja";
    await nextTick();
    expect(locale().value).toBe("zh-CN");
    expect(save).toHaveBeenLastCalledWith("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("an app without persistence (open source) writes no storage when switching locale", async () => {
    localStorage.clear();
    const locale = await mountWithLocale("en", null);
    locale().value = "zh-CN";
    await nextTick();
    expect(localStorage.length).toBe(0);
  });
});
