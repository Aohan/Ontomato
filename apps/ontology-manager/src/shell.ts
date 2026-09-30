import { createApp, h, ref } from "vue";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import {
  OntologyManager,
  type ManagerAuthFailureStatus,
  type ManagerCredential,
  type ManagerDataFallbacks,
  type ManagerKnowledgeTagValues,
  type ManagerPresentation,
} from "@ontomato/ontology-manager";
import { ontologyText, type ManagerMessages } from "@ontomato/ontology-manager/i18n";
import { readRuntimeConfig } from "./config";
import { clearSessionCredential, consumeLaunchCredential, sessionCredential } from "./credential";
import { syncLocale, syncTheme, type LocaleSync } from "./preferences";
import { syncView } from "./view";
import "./style.css";

export type { LocaleSync };

/** Every static difference between the two products' standalone shells. */
export interface ManagerShellProfile {
  /** Value handed to the component when this tab has no credential: explicit anonymous (open source) or null (stop requests and report the missing credential). */
  noCredential: ManagerCredential | null;
  /** Theme message type sent by the main system. */
  themeMessage: string;
  /** UI locale: the fixed locale without sync, otherwise the default locale. */
  locale: string;
  localeSync: LocaleSync | null;
  /** Messages per supported locale; its keys are the locales the shell accepts. */
  messages: Readonly<Record<string, ManagerMessages>>;
  /** Fixed data defaults, independent of the UI locale. */
  dataFallbacks: ManagerDataFallbacks;
  /** This product's Manager presentation values (theme values, node palette, graph interaction, narrow dialogs, etc.). */
  presentation: ManagerPresentation;
  /** This product's stored values for the business knowledge tags. */
  knowledgeTagValues: ManagerKnowledgeTagValues;
}

/**
 * Information the host gives through the launch URL when embedding: embedded=1 means the Manager is embedded in a host
 * page; knowledgeGovernanceUrl is the host's knowledge governance page. The address comes from a URL parameter and only
 * http/https is accepted; anything else counts as absent.
 */
function readHostLaunch() {
  const params = new URLSearchParams(window.location.search);
  return {
    embedded: params.get("embedded") === "1",
    knowledgeGovernanceUrl: httpUrl(params.get("knowledgeGovernanceUrl")),
  };
}

function httpUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function startManagerShell(profile: ManagerShellProfile) {
  consumeLaunchCredential();
  const credential = ref(sessionCredential(profile.noCredential));
  const authExpired = ref(false);
  const theme = syncTheme(profile.themeMessage);
  const locale = profile.localeSync
    ? syncLocale(profile.locale, Object.keys(profile.messages), profile.localeSync)
    : ref(profile.locale);
  const messages = () => profile.messages[locale.value];
  const { apiBase, initialRoute } = readRuntimeConfig();
  const { view, replaceView } = syncView(initialRoute);

  const { embedded, knowledgeGovernanceUrl } = readHostLaunch();

  // 401 means authentication expired: clear this tab's credential and stop requests. 402 (license failure) keeps the credential; the component shows the error.
  function onAuthFailure(status: ManagerAuthFailureStatus) {
    if (status !== 401) return;
    clearSessionCredential();
    credential.value = null;
    authExpired.value = true;
  }

  createApp({
    render: () =>
      credential.value
        ? h(OntologyManager, {
            apiBase,
            credential: credential.value,
            locale: locale.value,
            messages: messages(),
            theme: theme.value,
            view: view.value,
            dataFallbacks: profile.dataFallbacks,
            presentation: profile.presentation,
            knowledgeTagValues: profile.knowledgeTagValues,
            embedded,
            knowledgeGovernanceUrl,
            "onUpdate:view": replaceView,
            onAuthFailure,
          })
        : h(
            "p",
            { class: "manager-shell-status", role: "alert" },
            authExpired.value
              ? ontologyText(messages(), "requestFailedStatus", { status: 401 })
              : ontologyText(messages(), "credentialMissing")
          ),
  }).mount("#app");
}
