import { ref } from "vue";
import type { ManagerTheme } from "@ontomato/ontology-manager";

const THEME_KEY = "theme-preference";
const LOCALE_KEY = "app-locale";

/** Locale sync for apps that follow the main system's language: the main system's locale message type. */
export interface LocaleSync {
  messageType: string;
}

function normalizeTheme(value: string | null): ManagerTheme | null {
  return value === "dark" || value === "light" ? value : null;
}

// The URL parameter wins; when embedded in a same-origin parent, dark is taken only if the parent is dark, otherwise the stored preference.
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
    // A cross-origin parent is unreadable; theme messages take over.
  }
  return normalizeTheme(window.localStorage.getItem(THEME_KEY)) || "light";
}

/** Document theme owned by the shell: from the URL parameter, parent page or stored preference, then following parent messages, same-origin parent classes and other tabs' preference. */
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
    // Cross-origin embedding relies on the URL parameter and theme messages.
  }
  return theme;
}

/** UI locale owned by the shell: URL parameter → stored preference → app default, accepting only supported locales, then following parent messages and other tabs' preference. */
export function syncLocale(defaultLocale: string, supported: readonly string[], sync: LocaleSync) {
  const normalize = (value: string | null) => (value && supported.includes(value) ? value : null);
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
