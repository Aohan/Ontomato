import type { InjectionKey } from "vue";

/**
 * 回合诊断入口的可见性，由应用装配：企业按 observer 权限显示，并在按钮挂载时按需加载菜单权限；
 * 开源的 /observe 没有权限门，入口对所有用户可见。
 */
export interface TurnDiagnosisAccess {
  /** 按钮挂载时调用（原 onMounted 时机）。 */
  prepare(): void;
  /** 渲染时读取；随应用权限状态的响应式变化更新。 */
  visible(): boolean;
}

export const turnDiagnosisAccessKey: InjectionKey<TurnDiagnosisAccess> = Symbol("turnDiagnosisAccess");
