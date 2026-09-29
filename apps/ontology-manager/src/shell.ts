import { createApp, h, ref } from "vue";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import {
  OntologyManager,
  ontologyText,
  type ManagerAuthFailureStatus,
  type ManagerCredential,
  type ManagerDataFallbacks,
  type ManagerKnowledgeTagValues,
  type ManagerPresentation,
} from "@ontomato/ontology-manager";
import { readRuntimeConfig } from "./config";
import { clearSessionCredential, consumeLaunchCredential, sessionCredential } from "./credential";
import { syncLocale, syncTheme, type LocaleSync } from "./preferences";
import { syncView } from "./view";
import "./style.css";

export type { LocaleSync };

/** 两个产品独立运行时的全部静态差异。 */
export interface ManagerShellProfile {
  /** 本标签页没有凭据时交给组件的值：开源显式匿名，企业 null（停止请求并提示缺少凭据）。 */
  noCredential: ManagerCredential | null;
  /** 主系统主题消息名。 */
  themeMessage: string;
  /** 界面语言：无同步时即固定语言，有同步时为默认语言。 */
  locale: string;
  localeSync: LocaleSync | null;
  /** 固定的数据默认值，与界面语言无关。 */
  dataFallbacks: ManagerDataFallbacks;
  /** 本产品 Manager 的展示原值（主题取值、节点色板、图谱交互与窄屏对话框等）。 */
  presentation: ManagerPresentation;
  /** 本产品业务知识标签的存储值。 */
  knowledgeTagValues: ManagerKnowledgeTagValues;
}

/**
 * 宿主嵌入时经启动地址给出的信息：embedded=1 表示嵌在宿主页面里；knowledgeGovernanceUrl 是宿主的业务知识治理页，
 * 地址来自 URL 参数，只接受 http/https，其余当作没有。
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
    ? syncLocale(profile.locale, profile.localeSync)
    : ref(profile.locale);
  const { apiBase, initialRoute } = readRuntimeConfig();
  const { view, replaceView } = syncView(initialRoute);

  const { embedded, knowledgeGovernanceUrl } = readHostLaunch();

  // 401 认证失效：清除本标签页凭据并停止请求；402 License 失败保留凭据，错误由组件显示。
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
              ? ontologyText(locale.value, "requestFailedStatus", { status: 401 })
              : ontologyText(locale.value, "credentialMissing")
          ),
  }).mount("#app");
}
