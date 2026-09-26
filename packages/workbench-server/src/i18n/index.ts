export type Locale = "zh-CN" | "en" | "ja" | "ar" | "zh-TW" | "fr" | "de" | "it";

export type TranslationValue = string | ((params?: Record<string, any>) => string);

export interface TranslationMessages {
  [key: string]: TranslationValue;
}

export interface LocalePack {
  messages: TranslationMessages;
  languageName: string;
  outputInstruction: string;
  conclusionPrefix: string;
}

const packs = new Map<Locale, LocalePack>();
let defaultLocale: Locale = "en";
let currentLocale: Locale = "en";
let appTextLocale: Locale;
let switchEnabled = false;
let configured = false;

export function configureI18n(input: {
  defaultLocale: Locale;
  packs: Partial<Record<Locale, LocalePack>>;
  /** 企业允许用户切换语言，调用方给出的语言原样转给 DataRAG；开源固定英文。 */
  languageSwitchEnabled: boolean;
  /** 产物、匹配词和既有错误子串使用的固定语言。不随请求 setLocale 或 APP_DEFAULT_LOCALE 变化。 */
  appTextLocale: Locale;
}): void {
  const selected = input.packs[input.defaultLocale];
  if (!selected) throw new Error(`Default locale ${input.defaultLocale} has no pack`);
  const appPack = input.packs[input.appTextLocale];
  if (!appPack) throw new Error(`App text locale ${input.appTextLocale} has no pack`);
  packs.clear();
  for (const [locale, pack] of Object.entries(input.packs) as Array<[Locale, LocalePack | undefined]>) {
    if (pack) packs.set(locale, pack);
  }
  defaultLocale = input.defaultLocale;
  currentLocale = input.defaultLocale;
  appTextLocale = input.appTextLocale;
  switchEnabled = input.languageSwitchEnabled;
  configured = true;
}

function assertConfigured(): void {
  if (!configured) throw new Error("Workbench i18n is not configured");
}

export function languageSwitchEnabled(): boolean {
  assertConfigured();
  return switchEnabled;
}

export function getDefaultLocale(): Locale {
  assertConfigured();
  return defaultLocale;
}

/** 已注册的语言才接受；否则用应用安装的默认语言，不再经过第三种语言。 */
export function resolveLocale(locale: string | undefined): Locale {
  assertConfigured();
  const trimmed = locale?.trim();
  if (trimmed && packs.has(trimmed as Locale)) return trimmed as Locale;
  return defaultLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = resolveLocale(locale);
}

export function getLocale(): Locale {
  assertConfigured();
  return currentLocale;
}

export function getLanguageName(locale?: string): string {
  const target = locale ? resolveLocale(locale) : getLocale();
  return packs.get(target)?.languageName || packs.get(defaultLocale)?.languageName || target;
}

export function getOutputLanguageInstruction(locale?: string): string {
  const target = locale ? resolveLocale(locale) : getLocale();
  return packs.get(target)?.outputInstruction || packs.get(defaultLocale)?.outputInstruction || target;
}

export function getConclusionPrefix(locale?: string): string {
  const target = locale ? resolveLocale(locale) : getLocale();
  return packs.get(target)?.conclusionPrefix || packs.get(defaultLocale)?.conclusionPrefix || target;
}

function translate(locale: Locale, key: string, params?: Record<string, any>): string {
  assertConfigured();
  const message = packs.get(locale)?.messages[key] || packs.get(defaultLocale)?.messages[key];
  if (!message) {
    console.warn(`[i18n] Missing translation key: ${key}`);
    return key;
  }
  if (typeof message === "function") return message(params);
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (_, paramKey) => {
    return params[paramKey] !== undefined ? String(params[paramKey]) : `{${paramKey}}`;
  });
}

export function t(key: string, params?: Record<string, any>): string {
  return translate(getLocale(), key, params);
}

/** 固定应用文字。读 configureI18n 安装的 appTextLocale，不读当前请求语言。 */
export function tApp(key: string, params?: Record<string, any>): string {
  return translate(appTextLocale, key, params);
}

export function tForLocale(
  locale: string | undefined,
  key: string,
  params?: Record<string, any>
): string {
  return translate(locale ? resolveLocale(locale) : getLocale(), key, params);
}
