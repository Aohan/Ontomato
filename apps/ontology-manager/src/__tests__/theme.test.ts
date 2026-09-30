import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncTheme } from "../preferences";
import { isolateShellPerTest } from "./isolation";

const resetShell = isolateShellPerTest();

const MESSAGE = "ontomato-theme";

function post(data: unknown, source: unknown = window.parent) {
  window.dispatchEvent(new MessageEvent("message", { data, source: source as Window }));
}

/** Same-origin parent page double: the shell only reads and observes document.documentElement. */
function useParent(dark: boolean) {
  const root = document.createElement("div");
  if (dark) root.classList.add("dark");
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: { document: { documentElement: root } },
  });
  return root;
}

describe("shell document theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    Object.defineProperty(window, "parent", { configurable: true, value: window });
  });

  it("the URL parameter wins and is written to html.dark and the stored preference", () => {
    localStorage.setItem("theme-preference", "light");
    window.history.replaceState({}, "", "/?theme=dark");
    expect(syncTheme(MESSAGE).value).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme-preference")).toBe("dark");
  });

  it("without a parameter the stored preference is used; invalid values fall back to light", () => {
    localStorage.setItem("theme-preference", "dark");
    expect(syncTheme(MESSAGE).value).toBe("dark");
    resetShell();
    localStorage.setItem("theme-preference", "blue");
    expect(syncTheme(MESSAGE).value).toBe("light");
  });

  it("a dark same-origin parent gives dark; a light parent does not override a stored dark preference", () => {
    useParent(true);
    localStorage.setItem("theme-preference", "light");
    expect(syncTheme(MESSAGE).value).toBe("dark");
    resetShell();
    useParent(false);
    localStorage.setItem("theme-preference", "dark");
    expect(syncTheme(MESSAGE).value).toBe("dark");
  });

  it("follows class changes on the same-origin parent", async () => {
    const root = useParent(false);
    const theme = syncTheme(MESSAGE);
    root.classList.add("dark");
    await new Promise((resolve) => setTimeout(resolve));
    expect(theme.value).toBe("dark");
    root.classList.remove("dark");
    await new Promise((resolve) => setTimeout(resolve));
    expect(theme.value).toBe("light");
  });

  it("an unreadable cross-origin parent does not affect startup", () => {
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

  it("accepts only this app's message type with a valid theme from the parent", () => {
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

  it("follows the theme preference from other tabs", () => {
    const theme = syncTheme(MESSAGE);
    window.dispatchEvent(new StorageEvent("storage", { key: "theme-preference", newValue: "dark" }));
    expect(theme.value).toBe("dark");
    window.dispatchEvent(new StorageEvent("storage", { key: "other", newValue: "light" }));
    expect(theme.value).toBe("dark");
  });
});
