import { createI18n } from "vue-i18n";
import type { Language as ElementLocale } from "element-plus/es/locale";

/** Message tree (vue-i18n 10 does not export LocaleMessage from the package entry). */
type Messages = { [key: string]: string | Messages };

export type SupportedLocale = "zh-CN" | "en" | "ja" | "ar" | "zh-TW" | "fr" | "de" | "it";

/**
 * The app's language profile (installed once at startup). Open source has only en, saves nothing and shows no switch;
 * other apps supply their locales, messages, default, saved locale and switch setting from their own entry.
 */
export interface WorkbenchLanguage {
  supported: readonly SupportedLocale[];
  defaultLocale: SupportedLocale;
  initialLocale: SupportedLocale;
  switchEnabled: boolean;
  /** Persistence of the locale choice; null in open source, which does not save it. */
  save: ((locale: SupportedLocale) => void) | null;
  messages: Partial<Record<SupportedLocale, Messages>>;
  /** Element Plus locale for a UI locale; always en in open source. */
  elementLocale(locale: string): ElementLocale;
}

function createWorkbenchI18n(language: WorkbenchLanguage) {
  return createI18n({
    legacy: false,
    locale: language.initialLocale,
    fallbackLocale: language.defaultLocale,
    messages: language.messages,
  });
}

export type WorkbenchI18n = ReturnType<typeof createWorkbenchI18n>;

let installed: { i18n: WorkbenchI18n; language: WorkbenchLanguage } | null = null;

export function installWorkbenchI18n(language: WorkbenchLanguage): WorkbenchI18n {
  const i18n = createWorkbenchI18n(language);
  installed = { i18n, language };
  return i18n;
}

function installedLanguage() {
  if (!installed) throw new Error("Workbench language is not installed");
  return installed;
}

/** Module-level code (api client, stores) gets the instance at call time; global is never destructured before installation. */
export function workbenchI18n(): WorkbenchI18n {
  return installedLanguage().i18n;
}

/**
 * Translation for module-level code (stores, utilities): the installed instance is fetched on each call, replacing the
 * original module-evaluation-time `const { t } = i18n.global`, so it still works when a module is evaluated before the language is installed.
 */
export const t = ((...args: unknown[]) =>
  (workbenchI18n().global.t as (...params: unknown[]) => string)(...args)) as WorkbenchI18n["global"]["t"];

export function workbenchLanguage(): WorkbenchLanguage {
  return installedLanguage().language;
}
