import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncTheme } from "../preferences";
import { isolateShellPerTest } from "./isolation";

const resetShell = isolateShellPerTest();

const MESSAGE = "ontomato-theme";

function post(data: unknown, source: unknown = window.parent) {
  window.dispatchEvent(new MessageEvent("message", { data, source: source as Window }));
}

/** 同源父页面替身：只有 document.documentElement 被外壳读取与观察。 */
function useParent(dark: boolean) {
  const root = document.createElement("div");
  if (dark) root.classList.add("dark");
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: { document: { documentElement: root } },
  });
  return root;
}

describe("外壳文档主题", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    Object.defineProperty(window, "parent", { configurable: true, value: window });
  });

  it("地址参数优先，并写入 html.dark 与本地偏好", () => {
    localStorage.setItem("theme-preference", "light");
    window.history.replaceState({}, "", "/?theme=dark");
    expect(syncTheme(MESSAGE).value).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme-preference")).toBe("dark");
  });

  it("无参数时取本地偏好，非法值回落 light", () => {
    localStorage.setItem("theme-preference", "dark");
    expect(syncTheme(MESSAGE).value).toBe("dark");
    resetShell();
    localStorage.setItem("theme-preference", "blue");
    expect(syncTheme(MESSAGE).value).toBe("light");
  });

  it("同源父页面为暗色时取暗色；父页面浅色不覆盖本地暗色偏好", () => {
    useParent(true);
    localStorage.setItem("theme-preference", "light");
    expect(syncTheme(MESSAGE).value).toBe("dark");
    resetShell();
    useParent(false);
    localStorage.setItem("theme-preference", "dark");
    expect(syncTheme(MESSAGE).value).toBe("dark");
  });

  it("跟随同源父页面类名变化", async () => {
    const root = useParent(false);
    const theme = syncTheme(MESSAGE);
    root.classList.add("dark");
    await new Promise((resolve) => setTimeout(resolve));
    expect(theme.value).toBe("dark");
    root.classList.remove("dark");
    await new Promise((resolve) => setTimeout(resolve));
    expect(theme.value).toBe("light");
  });

  it("跨源父页面不可读时不影响启动", () => {
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: {
        get document(): Document {
          throw new DOMException("cross origin", "SecurityError");
        },
      },
    });
    localStorage.setItem("theme-preference", "dark");
    expect(syncTheme(MESSAGE).value).toBe("dark");
  });

  it("只接受父页面发来的本应用消息名与合法主题", () => {
    const theme = syncTheme(MESSAGE);
    post({ type: "data-agent-theme", theme: "dark" });
    post({ type: MESSAGE, theme: "blue" });
    post({ type: MESSAGE, theme: "dark" }, {});
    post(null);
    expect(theme.value).toBe("light");
    post({ type: MESSAGE, theme: "dark" });
    expect(theme.value).toBe("dark");
    expect(localStorage.getItem("theme-preference")).toBe("dark");
  });

  it("跟随其他标签页的主题偏好", () => {
    const theme = syncTheme(MESSAGE);
    window.dispatchEvent(new StorageEvent("storage", { key: "theme-preference", newValue: "dark" }));
    expect(theme.value).toBe("dark");
    window.dispatchEvent(new StorageEvent("storage", { key: "other", newValue: "light" }));
    expect(theme.value).toBe("dark");
  });
});
