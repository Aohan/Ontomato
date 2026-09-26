import { ref } from "vue";
import type { WorkbenchSelectionMode } from "@ontomato/workbench-ui/features/workbench";

export function useWorkbenchLayoutState() {
  // 开源欢迎态原为静态标志图（原 WorkbenchWelcomeState 的 img alt="Ontomato"）。
  const welcomeAnimation = {
    kind: "image",
    src: `${import.meta.env.BASE_URL}ontomato-mark-green.svg`,
    alt: "Ontomato",
  } as const;
  const timerDropdownOpen = ref(false);
  const showUserMenu = ref(false);
  const selectionMode = ref<WorkbenchSelectionMode>("qa");
  const currentView = ref<"chat" | "report">("chat");
  const rightPanelResetKey = ref(0);
  return {
    welcomeAnimation,
    timerDropdownOpen,
    showUserMenu,
    selectionMode,
    currentView,
    rightPanelResetKey,
  };
}
