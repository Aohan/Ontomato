export { default as OntologyManager } from "./OntologyManager.vue";
export type { ManagerAuthFailureStatus, ManagerCredential, ManagerDataFallbacks } from "./api";
export type { ManagerHostContext, ManagerPresentation, ManagerTheme } from "./context";
/** 独立外壳在组件不渲染时（无凭据、认证失效）用组件已有词条显示状态。 */
export { ontologyText } from "./i18n";
