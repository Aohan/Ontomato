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
  /** The host decides whether users may switch languages; the language given by the caller is passed through to DataRAG as-is. The OSS build is fixed to English. */
  languageSwitchEnabled: boolean;
  /** Fixed language for artifacts, matcher terms, and existing error substrings. Does not follow request setLocale or APP_DEFAULT_LOCALE. */
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

/** Only registered locales are accepted; otherwise fall back to the locale installed by the app, never through a third language. */
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

/** Fixed app text. Reads the appTextLocale installed by configureI18n, not the current request locale. */
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
