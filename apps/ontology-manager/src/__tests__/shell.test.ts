import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

/** 组件替身：记录外壳交给组件的 props，并能代组件发出事件。 */
const host = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  emit: null as ((event: string, ...args: unknown[]) => void) | null,
}));

// 组件整体替身：组件自身已有测试，这里只核对外壳交给组件的 props、组件事件的承接与所用状态词条。
vi.mock("@ontomato/ontology-manager", async () => {
  const { defineComponent, h } = await import("vue");
  const OntologyManager = defineComponent({
    props: {
      apiBase: { type: String, required: true },
      credential: { type: Object, required: true },
      locale: { type: String, required: true },
      theme: { type: String, required: true },
      view: { type: String, required: true },
      dataFallbacks: { type: Object, required: true },
      presentation: { type: Object, required: true },
      knowledgeTagValues: { type: Object, required: true },
      embedded: { type: Boolean, required: true },
      knowledgeGovernanceUrl: { type: String, default: null },
    },
    emits: ["update:view", "auth-failure"],
    setup(props, { emit }) {
      host.props = props;
      host.emit = emit as typeof host.emit;
      return () => h("div", { class: "manager-double" });
    },
  });
  const ontologyText = (locale: string, key: string, params?: object) =>
    `${locale}:${key}${params ? JSON.stringify(params) : ""}`;
  return { OntologyManager, ontologyText };
});

const { isolateShellPerTest } = await import("./isolation");
const { ossProfile } = await import("../profile");
const { ossPresentation } = await import("../presentation");
const { startManagerShell } = await import("../shell");

const resetShell = isolateShellPerTest();

function start(url: string) {
  host.props = null;
  resetShell();
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState({}, "", url);
  startManagerShell(ossProfile);
}

describe("开源独立外壳", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.documentElement.lang = "en";
    window.__ONTOLOGY_MANAGER_CONFIG__ = { API_BASE: "/custom-base/api/", INITIAL_ROUTE: "" };
  });

  it("无参数时显式匿名，固定 en 与开源数据默认值，apiBase 取 config.js", () => {
    start("/?view=assets");
    expect(host.props).toMatchObject({
      apiBase: "/custom-base/api",
      credential: { type: "anonymous" },
      locale: "en",
      theme: "light",
      view: "/assets/metrics",
      dataFallbacks: {
        noBusinessDescription: "No business description provided",
        unnamedAsset: "Unnamed asset",
      },
    });
    expect(host.props?.knowledgeTagValues).toEqual({
      general: "General",
      business: "Business",
      tech: "Tech",
    });
    expect(host.props?.embedded).toBe(false);
    expect(host.props?.knowledgeGovernanceUrl).toBeNull();
    // 开源展示原值（b6437c86）：同一静态对象交给组件。
    expect(host.props?.presentation).toBe(ossPresentation);
    expect(ossPresentation).toMatchObject({
      nodePalette: ["#639c2d", "#8bbf4a", "#d79b3b", "#58a968", "#d46b57", "#84956f"],
      edgeLabel: { labelPlacement: "center", labelAutoRotate: false },
      maxFitZoom: 1,
      compactDialogs: true,
    });
    expect(ossPresentation.dataBrowserDescription("Order")).toBe(
      "Browse and inspect data records for the current object type."
    );
  });

  it("宿主嵌入参数：embedded=1 与 http(s) 治理地址交给组件，其他协议的地址当作没有", () => {
    start("/?embedded=1&knowledgeGovernanceUrl=http%3A%2F%2Fhost.test%2Fadmin%2Fknowledge-governance");
    expect(host.props?.embedded).toBe(true);
    expect(host.props?.knowledgeGovernanceUrl).toBe("http://host.test/admin/knowledge-governance");
    start("/?embedded=1&knowledgeGovernanceUrl=javascript%3Aalert(1)");
    expect(host.props?.knowledgeGovernanceUrl).toBeNull();
  });

  it("显式 tk / apiKey 启动时使用该凭据并从地址移除", () => {
    start("/?tk=t1#/data");
    expect(host.props?.credential).toEqual({ type: "token", token: "t1" });
    expect(window.location.search).toBe("");
    expect(host.props?.view).toBe("/data");
    start("/?apiKey=k1");
    expect(host.props?.credential).toEqual({ type: "apiKey", apiKey: "k1" });
  });

  it("语言固定 en：地址参数、本地偏好与语言消息都不改变，也不写偏好", async () => {
    localStorage.setItem("app-locale", "zh-CN");
    start("/?locale=zh-CN");
    for (const type of ["data-agent-locale", "ontomato-locale"]) {
      window.dispatchEvent(
        new MessageEvent("message", { data: { type, locale: "zh-CN" }, source: window })
      );
    }
    window.dispatchEvent(new StorageEvent("storage", { key: "app-locale", newValue: "ja" }));
    await nextTick();
    expect(host.props?.locale).toBe("en");
    expect(localStorage.getItem("app-locale")).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("en");
  });

  it("主题消息使用 ontomato-theme", async () => {
    start("/");
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "ontomato-theme", theme: "dark" }, source: window })
    );
    await nextTick();
    expect(host.props?.theme).toBe("dark");
  });

  it("组件导航以替换写回 hash", async () => {
    start("/");
    const length = window.history.length;
    host.emit?.("update:view", "/objects/Order");
    await nextTick();
    expect(host.props?.view).toBe("/objects/Order");
    expect(window.location.hash).toBe("#/objects/Order");
    expect(window.history.length).toBe(length);
  });

  it("401：清除本标签页凭据，停止渲染组件并提示认证失败；刷新后回到匿名默认", async () => {
    start("/?tk=t1");
    host.emit?.("auth-failure", 401);
    await nextTick();
    expect(sessionStorage.length).toBe(0);
    expect(document.querySelector(".manager-double")).toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('en:requestFailedStatus{"status":401}');
    start("/");
    expect(host.props?.credential).toEqual({ type: "anonymous" });
  });

  it("402：保留凭据与组件，不转登录", async () => {
    start("/?tk=t1");
    host.emit?.("auth-failure", 402);
    await nextTick();
    expect(host.props?.credential).toEqual({ type: "token", token: "t1" });
    expect(sessionStorage.getItem("ontology_manager_token")).toBe("t1");
    expect(document.querySelector(".manager-double")).not.toBeNull();
  });
});
