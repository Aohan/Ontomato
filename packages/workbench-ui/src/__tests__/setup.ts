/**
 * Assembly prerequisites of the shared tests: like the open-source entry startWorkbenchWeb, install the auth host, error
 * punctuation, workbench content and language first so module-level code can read them at call time. Uses the
 * open-source app values (anonymous host, the real en messages, open-source workbench content); tests that need other
 * values override the relevant item in their own file.
 */
import en from "element-plus/es/locale/lang/en";
import publicEn from "../locales/en";
import { installWorkbenchI18n } from "../i18n";
import { installAuthHost } from "../utils/auth";
import { installErrorPunctuation } from "../utils/error-punctuation";
import { installWorkbenchContent } from "../content";
import { anonymousAuthHost } from "../../../../apps/workbench/web/src/auth";
import { workbenchContent } from "../../../../apps/workbench/web/src/workbench-content";

installAuthHost(anonymousAuthHost);
installErrorPunctuation({ detailSeparator: ":", listSeparator: ";" });
installWorkbenchContent(workbenchContent);
installWorkbenchI18n({
  supported: ["en"],
  defaultLocale: "en",
  initialLocale: "en",
  switchEnabled: false,
  save: null,
  messages: { en: publicEn },
  elementLocale: () => en,
});
