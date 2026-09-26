import { createI18n } from "vue-i18n";
import type { Language as ElementLocale } from "element-plus/es/locale";

/** 词条树（vue-i18n 10 不从包入口导出 LocaleMessage）。 */
type Messages = { [key: string]: string | Messages };

export type SupportedLocale = "zh-CN" | "en" | "ja" | "ar" | "zh-TW" | "fr" | "de" | "it";

/**
 * 应用的语言档（启动时装配一次）：开源只有 en、不保存、不显示切换；
 * 企业八语，默认值、已保存语言与切换开关由企业入口按原运行配置解析后给出。
 */
export interface WorkbenchLanguage {
  supported: readonly SupportedLocale[];
  defaultLocale: SupportedLocale;
  initialLocale: SupportedLocale;
  switchEnabled: boolean;
  /** 语言选择的持久化；开源原本不保存，为 null。 */
  save: ((locale: SupportedLocale) => void) | null;
  messages: Partial<Record<SupportedLocale, Messages>>;
  /** Element Plus 组件语言：开源恒 en；企业按原映射，未知值用 zh-cn（不随默认语言变化）。 */
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

/** 模块级代码（api client、store）在调用时取实例；不在装配前解构 global。 */
export function workbenchI18n(): WorkbenchI18n {
  return installedLanguage().i18n;
}

/**
 * 模块级代码（store、工具函数）的翻译：每次调用时才取已装配的实例，
 * 取代原模块求值时的 `const { t } = i18n.global`，模块早于语言装配求值也不失效。
 */
export const t = ((...args: unknown[]) =>
  (workbenchI18n().global.t as (...params: unknown[]) => string)(...args)) as WorkbenchI18n["global"]["t"];

export function workbenchLanguage(): WorkbenchLanguage {
  return installedLanguage().language;
}
