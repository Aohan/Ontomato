import { computed, type WritableComputedRef } from "vue";
import { useI18n, type ComposerTranslation } from "vue-i18n";
import { workbenchLanguage, type SupportedLocale } from "../i18n";

export function useLocale(): {
  currentLocale: WritableComputedRef<SupportedLocale>;
  t: ComposerTranslation;
} {
  const { locale, t } = useI18n();
  const language = workbenchLanguage();

  const currentLocale = computed({
    get: () => locale.value as SupportedLocale,
    set: (val: SupportedLocale) => {
      const nextLocale = language.supported.includes(val) ? val : language.defaultLocale;
      locale.value = nextLocale;
      language.save?.(nextLocale);
    },
  });

  return { currentLocale, t };
}
