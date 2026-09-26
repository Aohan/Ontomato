import { ref } from "vue";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function useTestcasePanelResize() {
  const layoutRef = ref<HTMLElement | null>(null);
  const leftPanelWidth = ref(340);
  const rightPanelWidth = ref(480);
  const jsonCollapsed = ref(false);
  const activeResize = ref<"left" | "right" | null>(null);

  let stopResizeHandler: (() => void) | null = null;

  function stopResize() {
    stopResizeHandler?.();
  }

  function startResize(which: "left" | "right", e: MouseEvent) {
    e.preventDefault();
    stopResize();

    activeResize.value = which;
    const startX = e.clientX;
    const startLeft = leftPanelWidth.value;
    const startRight = rightPanelWidth.value;

    const onMove = (ev: MouseEvent) => {
      const containerWidth = layoutRef.value?.clientWidth || 1200;
      if (which === "left") {
        const reserved = jsonCollapsed.value ? 260 : rightPanelWidth.value + 220;
        const maxLeft = Math.min(560, Math.max(180, containerWidth - reserved));
        leftPanelWidth.value = clamp(startLeft + ev.clientX - startX, 180, maxLeft);
        return;
      }

      const maxRight = Math.min(760, Math.max(220, containerWidth - leftPanelWidth.value - 220));
      rightPanelWidth.value = clamp(startRight - (ev.clientX - startX), 220, maxRight);
    };

    const onUp = () => {
      activeResize.value = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      stopResizeHandler = null;
    };

    stopResizeHandler = onUp;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return {
    layoutRef,
    leftPanelWidth,
    rightPanelWidth,
    jsonCollapsed,
    activeResize,
    startResize,
    stopResize,
  };
}
