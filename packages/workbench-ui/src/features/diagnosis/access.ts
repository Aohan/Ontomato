import type { InjectionKey } from "vue";

/**
 * Visibility of the turn diagnosis entry, supplied by the app: an app may gate it on a permission and load menu
 * permissions when the button mounts; the open-source /observe has no permission gate, so the entry is visible to all users.
 */
export interface TurnDiagnosisAccess {
  /** Called when the button mounts (the original onMounted timing). */
  prepare(): void;
  /** Read during render; updates reactively with the app's permission state. */
  visible(): boolean;
}

export const turnDiagnosisAccessKey: InjectionKey<TurnDiagnosisAccess> = Symbol("turnDiagnosisAccess");
