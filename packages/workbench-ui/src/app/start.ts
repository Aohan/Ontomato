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
  /** Static workbench content (original matching rules, sentences and colours; module-level code reads it at call time). */
  content: WorkbenchContent;
  /** Visibility of the chat turn diagnosis entry (components read it via inject). */
  turnDiagnosis: TurnDiagnosisAccess;
  routes: RouteRecordRaw[];
  /** App navigation guards; the Pinia instance is passed explicitly so stores in guards do not depend on mount timing. */
  installGuards?: (router: Router, pinia: Pinia) => void;
  /** App-level startup before mounting (e.g. a session watcher, originally started once in App setup). */
  beforeMount?: () => void;
}

/**
 * The single web startup order: install the host, punctuation, entry config, workbench content and language first
 * (module-level code reads them at call time), then create Pinia and the router and install app guards, and finally
 * install everything into the app and mount; the router's first navigation happens after Pinia is installed.
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
