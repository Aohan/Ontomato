import { ref } from "vue";
import type { ManagerTheme } from "@ontomato/ontology-manager";

const THEME_KEY = "theme-preference";
const LOCALE_KEY = "app-locale";

/** 带语言同步的应用（企业）：受支持的语言与主系统语言消息名。 */
export interface LocaleSync {
  supported: readonly string[];
  messageType: string;
}

function normalizeTheme(value: string | null): ManagerTheme | null {
  return value === "dark" || value === "light" ? value : null;
}

// 地址参数优先；嵌入同源父页面时只有父页面为暗色才取暗色，否则继续取本地偏好。
function initialTheme(): ManagerTheme {
  const urlTheme = normalizeTheme(new URLSearchParams(window.location.search).get("theme"));
  if (urlTheme) return urlTheme;
  try {
    if (
      window.parent !== window &&
      window.parent.document.documentElement.classList.contains("dark")
    ) {
      return "dark";
    }
  } catch {
    // 跨源父页面不可读，由主题消息承接。
  }
  return normalizeTheme(window.localStorage.getItem(THEME_KEY)) || "light";
}

/** 外壳拥有的文档主题：来源为地址参数、父页面、本地偏好，并跟随父页面消息、同源父页面类名与其他标签页偏好。 */
export function syncTheme(messageType: string) {
  const theme = ref<ManagerTheme>("light");
  const apply = (value: ManagerTheme) => {
    theme.value = value;
    document.documentElement.classList.toggle("dark", value === "dark");
    window.localStorage.setItem(THEME_KEY, value);
  };
  apply(initialTheme());

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data as { type?: string; theme?: string } | null;
    const value = normalizeTheme(data?.theme || null);
    if (data?.type === messageType && value) apply(value);
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_KEY) return;
    const value = normalizeTheme(event.newValue);
    if (value) apply(value);
  });
  try {
    if (window.parent !== window) {
      const parentRoot = window.parent.document.documentElement;
      new MutationObserver(() =>
        apply(parentRoot.classList.contains("dark") ? "dark" : "light")
      ).observe(parentRoot, { attributes: true, attributeFilter: ["class"] });
    }
  } catch {
    // 跨源嵌入由地址参数与主题消息承接。
  }
  return theme;
}

/** 外壳拥有的界面语言：地址参数 → 本地偏好 → 应用默认，只接受受支持的语言，并跟随父页面消息与其他标签页偏好。 */
export function syncLocale(defaultLocale: string, sync: LocaleSync) {
  const normalize = (value: string | null) =>
    value && sync.supported.includes(value) ? value : null;
  const locale = ref(defaultLocale);
  const apply = (value: string) => {
    locale.value = value;
    window.localStorage.setItem(LOCALE_KEY, value);
    document.documentElement.lang = value;
    document.documentElement.dir = value === "ar" ? "rtl" : "ltr";
  };
  apply(
    normalize(new URLSearchParams(window.location.search).get("locale")) ||
      normalize(window.localStorage.getItem(LOCALE_KEY)) ||
      defaultLocale
  );

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data as { type?: string; locale?: string } | null;
    const value = normalize(data?.locale || null);
    if (data?.type === sync.messageType && value) apply(value);
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== LOCALE_KEY) return;
    const value = normalize(event.newValue);
    if (value) apply(value);
  });
  return locale;
}
