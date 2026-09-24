import { inject, provide, type InjectionKey } from "vue";
import {
  createManagerClient,
  type ManagerAuthFailureStatus,
  type ManagerClient,
  type ManagerCredential,
} from "./api";

export type ManagerTheme = "light" | "dark";

/** 宿主传入的全部上下文；组件不读取宿主存储、document 主题类或全局路由。 */
export interface ManagerHostContext {
  apiBase: string;
  credential: ManagerCredential | null;
  locale: string;
  theme: ManagerTheme;
  /** 当前视图路径，例如 `/objects/x`、`/visual-modeling?focus=object&id=x`。 */
  view: string;
}

const contextKey: InjectionKey<Readonly<ManagerHostContext>> = Symbol("ontology-manager-context");
const clientKey: InjectionKey<ManagerClient> = Symbol("ontology-manager-client");

/** 由 Manager 根组件在 setup 中调用一次；context 通常是其响应式 props。 */
export function provideManagerContext(
  context: Readonly<ManagerHostContext>,
  onAuthFailure: (status: ManagerAuthFailureStatus) => void
) {
  provide(contextKey, context);
  provide(clientKey, createManagerClient(context, onAuthFailure));
}

function injectFromHost<T>(key: InjectionKey<T>): T {
  const value = inject(key);
  if (!value) throw new Error("Ontology Manager 组件必须挂载在 provideManagerContext 的根组件内");
  return value;
}

export function useManagerContext() {
  return injectFromHost(contextKey);
}

export function useManagerClient() {
  return injectFromHost(clientKey);
}
