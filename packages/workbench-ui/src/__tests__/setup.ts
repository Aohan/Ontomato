/**
 * 共享用例的装配前提：与开源入口 startWorkbenchWeb 相同，先装认证宿主、错误标点、工作台内容与语言，
 * 模块级代码才可在调用时读取。取开源应用的原值（匿名宿主、正式 en 词包、开源工作台内容）；
 * 用例需要另一版原值时在各自文件里覆盖对应项。
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
