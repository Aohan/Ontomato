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

describe("应用语言档", () => {
  it("启动时写文档语言并按应用保存；切到不支持的语言回到默认语言", async () => {
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

  it("没有持久化的应用（开源）切换语言时不写存储", async () => {
    localStorage.clear();
    const locale = await mountWithLocale("en", null);
    locale().value = "zh-CN";
    await nextTick();
    expect(localStorage.length).toBe(0);
  });
});
