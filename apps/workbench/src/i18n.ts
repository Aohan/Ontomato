import { appTextEn } from "@ontomato/workbench-server/i18n/app-text-en";
import { en, enLocaleMeta } from "@ontomato/workbench-server/i18n/locales/en";
import { configureI18n } from "@ontomato/workbench-server";

export function configureOssI18n(): void {
  configureI18n({
    defaultLocale: "en",
    languageSwitchEnabled: false,
    appTextLocale: "en",
    packs: {
      en: {
        messages: { ...en, ...appTextEn },
        ...enLocaleMeta,
      },
    },
  });
}
