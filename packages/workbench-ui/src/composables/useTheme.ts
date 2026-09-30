import { ref } from "vue";

const THEME_KEY = "theme-preference";

const isDark = ref(false);
const isInitialized = ref(false);

type ThemeWindowLike = {
  localStorage: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
  };
};

type ThemeDocumentLike = {
  documentElement: {
    classList: {
      add: (...tokens: string[]) => void;
      remove: (...tokens: string[]) => void;
    };
  };
};

const hasWindow = () => typeof globalThis !== "undefined" && "window" in globalThis;
const hasDocument = () => typeof globalThis !== "undefined" && "document" in globalThis;

const getWindow = (): ThemeWindowLike | null => {
  if (!hasWindow()) return null;
  return globalThis.window as unknown as ThemeWindowLike;
};

const getDocument = (): ThemeDocumentLike | null => {
  if (!hasDocument()) return null;
  return globalThis.document as unknown as ThemeDocumentLike;
};

const applyTheme = () => {
  const doc = getDocument();
  const win = getWindow();

  if (!doc || !win) return;

  if (isDark.value) {
    doc.documentElement.classList.add("dark");
  } else {
    doc.documentElement.classList.remove("dark");
  }

  win.localStorage.setItem(THEME_KEY, isDark.value ? "dark" : "light");
};

const initTheme = () => {
  const win = getWindow();
  if (!win || isInitialized.value) return;

  const savedTheme = win.localStorage.getItem(THEME_KEY);

  isDark.value = savedTheme === "dark";

  applyTheme();
  isInitialized.value = true;
};

const toggleTheme = () => {
  isDark.value = !isDark.value;
  applyTheme();
};

const setTheme = (theme: "light" | "dark") => {
  isDark.value = theme === "dark";
  applyTheme();
};

export function useTheme() {
  initTheme();

  return {
    isDark,
    toggleTheme,
    initTheme,
    setTheme,
  };
}
