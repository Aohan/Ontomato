import { createApp } from "vue";
import { createPinia, type Pinia } from "pinia";
import ElementPlus from "element-plus";
import { createRouter, createWebHashHistory, type Router, type RouteRecordRaw } from "vue-router";
import App from "../App.vue";
import { installWorkbenchI18n, type WorkbenchLanguage } from "../i18n";
import { installAuthHost, type WorkbenchAuthHost } from "../utils/auth";
import { installErrorPunctuation, type ErrorPunctuation } from "../utils/error-punctuation";
import { installWorkbenchContent, type WorkbenchContent } from "../content";
import { turnDiagnosisAccessKey, type TurnDiagnosisAccess } from "../features/diagnosis/access";
import {
  installOntologyManagerEntry,
  type OntologyManagerEntryConfig,
} from "../views/admin/manager-entry-config";

export interface WorkbenchWebOptions {
  language: WorkbenchLanguage;
  auth: WorkbenchAuthHost;
  errorPunctuation: ErrorPunctuation;
  ontologyManagerEntry: OntologyManagerEntryConfig;
  /** 工作台静态内容（原匹配规则、原句与配色，模块级代码在调用时读取）。 */
  content: WorkbenchContent;
  /** 聊天回合诊断入口的可见性（组件经 inject 读取）。 */
  turnDiagnosis: TurnDiagnosisAccess;
  routes: RouteRecordRaw[];
  /** 企业的导航守卫；Pinia 实例显式传入，守卫里的 store 不依赖挂载时机。 */
  installGuards?: (router: Router, pinia: Pinia) => void;
  /** 挂载前的应用级启动（企业会话监视，原在 App setup 中启动一次）。 */
  beforeMount?: () => void;
}

/**
 * 网页启动的唯一顺序：宿主/标点/入口配置/工作台内容与语言先装配（模块级代码在调用时读取），
 * 再建 Pinia、router 并装应用守卫，最后装入 app 并挂载；router 的首次导航发生在 Pinia 已装入之后。
 */
export function startWorkbenchWeb(options: WorkbenchWebOptions): void {
  installAuthHost(options.auth);
  installErrorPunctuation(options.errorPunctuation);
  installOntologyManagerEntry(options.ontologyManagerEntry);
  installWorkbenchContent(options.content);
  const i18n = installWorkbenchI18n(options.language);
  const pinia = createPinia();
  const router = createRouter({ history: createWebHashHistory(), routes: options.routes });
  options.installGuards?.(router, pinia);

  const app = createApp(App);
  app.provide(turnDiagnosisAccessKey, options.turnDiagnosis);
  app.use(i18n);
  app.use(ElementPlus);
  app.use(pinia);
  app.use(router);
  options.beforeMount?.();
  app.mount("#app");
}
