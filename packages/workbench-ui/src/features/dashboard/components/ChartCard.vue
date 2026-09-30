<template>
  <div ref="rootRef" class="chart-container">
    <div class="chart-header">
      <h3 :title="title">{{ title }}</h3>
    </div>
    <div
      v-loading="loading"
      :class="['chart-wrapper', { 'chart-wrapper--transparent-loading': transparentLoading }]"
      :element-loading-text="t('common.loading')"
    >
      <div ref="elRef" class="chart-echarts"></div>
      <ChartDataOverlay :open="dataOpen" :tabular="tabular" @view-dsl="handleViewDsl" />
      <div v-if="state === 'empty'" class="chart-mask">{{ t("common.noData") }}</div>
      <div v-else-if="state === 'error' && !dataOpen" class="chart-mask">
        {{ t("analysis.cannotGenerateChart") }}
      </div>
    </div>
    <ChartToolbar
      :data-open="dataOpen"
      :disabled-types="disabledChartTypes"
      :conditions="conditions"
      :attr-show-name-map="props.attrShowNameMap"
      @open-zoom="openZoom"
      @toggle-data="toggleData"
      @command="handleCommand"
      @conditions-change="handleConditionsChange"
      @open-ai="() => emit('ai-request', props.chart)"
    />
    <ChartZoomModal
      :open="modalOpen"
      :mode="modalMode"
      :title="title"
      :option="zoomOption"
      :tabular="tabular"
      @close="closeZoom"
    />
    <!-- Bottom-right resize handle -->
    <span class="resize-handle" :title="t('dashboard.dragToResize')" />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as echarts from "echarts";
import interact from "interactjs";
import { ElMessage, ElMessageBox } from "element-plus";
import ChartDataOverlay from "./ChartDataOverlay.vue";
import ChartToolbar from "./ChartToolbar.vue";
import ChartZoomModal from "./ChartZoomModal.vue";
import { extractTabularDataFromOption, safeCloneOption } from "./utils/chartTabular";
import { modifyResultSetName, deleteResultSet } from "../api";
import { clamp, parseGridColumns } from "./utils/dashboardHelper";
import { getEchartsTheme } from "./utils/echartsTheme";
import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../content";

/** Loading mask background follows the app's original value (open source: transparent). */
const transparentLoading = workbenchContent().dashboard.loadingMask === "transparent";

const { t } = useI18n();

const props = defineProps({
  chart: { type: Object, required: true },
  dashboardId: { type: String, default: "" },
  conditions: { type: Array, default: () => [] },
  attrShowNameMap: { type: Object, default: () => ({}) },
});
const loading = computed(() => state.value === "loading");

const emit = defineEmits([
  "chart-renamed",
  "chart-deleted",
  "chart-conditions-changed",
  "ai-request",
  "view-dsl",
  "layout-change",
  "resize-active",
]);

const rootRef = ref(null);
const elRef = ref(null);
let instance = null;
let resizeObs = null;
let interactable = null;
const dataOpen = ref(false);
const tabular = ref(null);

const modalOpen = ref(false);
const modalMode = ref("chart");
const zoomOption = ref(null);

const title = computed(() => props.chart?.title || "");

function handleViewDsl() {
  emit("view-dsl", { title: title.value, dsl: props.chart?.dsl ?? null });
}

const ALL_CHART_TYPES = ["pie", "bar", "line", "scatter", "radar", "heatmap"];

const disabledChartTypes = computed(() => {
  const rows = props.chart?.rows || [];
  if (!rows || !Array.isArray(rows) || rows.length === 0) return ALL_CHART_TYPES.slice();
  return [];
});

const state = computed(() => {
  const opt = props.chart?.option;
  if (opt === null || opt === undefined) return "empty";
  const raw = opt && typeof opt === "object" ? opt.__ragchatState : null;
  return raw === "loading" || raw === "empty" || raw === "error" ? raw : null;
});

async function handleCommand(cmd) {
  const dashboardId = String(props.dashboardId || "").trim();
  const chartId = String(props.chart?.id || "").trim();

  if (cmd === "rename") {
    try {
      const ret = await ElMessageBox.prompt(
        t("analysis.enterChartName"),
        t("analysis.renameChart"),
        {
          confirmButtonText: t("common.ok"),
          cancelButtonText: t("common.cancel"),
          inputValue: title.value,
        }
      );
      const nextName = String(ret?.value || "").trim();
      if (!nextName || nextName === title.value) return;
      const ok = await modifyResultSetName(dashboardId, chartId, nextName);
      if (!ok) throw new Error(t("common.renameFailed"));
      emit("chart-renamed", { chartId, title: nextName });
      ElMessage.success(t("common.renamed"));
    } catch (e) {
      if (e === "cancel") return;
      ElMessage.error(e instanceof Error ? e.message : t("common.renameFailed"));
    }
    return;
  }

  if (cmd === "delete") {
    try {
      await ElMessageBox.confirm(
        t("analysis.deleteChartConfirm", { name: title.value || chartId }),
        t("common.deleteConfirm"),
        {
          confirmButtonText: t("common.delete"),
          cancelButtonText: t("common.cancel"),
          type: "warning",
          confirmButtonClass: "el-button--danger",
        }
      );
      const ok = await deleteResultSet(dashboardId, chartId);
      if (!ok) throw new Error(t("admin.deleteFailed"));
      emit("chart-deleted", { chartId });
      ElMessage.success(t("common.deleted"));
    } catch (e) {
      if (e === "cancel") return;
      ElMessage.error(e instanceof Error ? e.message : t("admin.deleteFailed"));
    }
  }
}

let canvasCheckTimer = null;

function clearCanvasCheck() {
  if (canvasCheckTimer) clearTimeout(canvasCheckTimer);
  canvasCheckTimer = null;
}

function hasRenderRoot(el) {
  if (!el) return false;
  // echarts uses canvas by default; it may also have an svg renderer
  return !!el.querySelector("canvas");
}

function fallbackToTableNow() {
  if (state.value === "loading" || state.value === "empty") return;
  if (dataOpen.value) return;
  refreshTabular();
  dataOpen.value = true;
}

function fallbackIfNoCanvasSoon() {
  const el = elRef.value;
  if (!el) return;

  clearCanvasCheck();

  // echarts has a very short render window (to avoid false positives from sync checks)
  canvasCheckTimer = setTimeout(() => {
    const curEl = elRef.value;
    if (!curEl) return;

    // No canvas/svg => fall back directly
    if (!hasRenderRoot(curEl)) {
      fallbackToTableNow();
    }
  }, 100);
}

let applyRetryRaf = 0;
function cancelApplyRetry() {
  if (applyRetryRaf) cancelAnimationFrame(applyRetryRaf);
  applyRetryRaf = 0;
}

function applyOption(option) {
  const el = elRef.value;
  if (!el) return;

  const { width, height } = el.getBoundingClientRect();
  if (width < 50 || height < 50) {
    cancelApplyRetry();
    applyRetryRaf = requestAnimationFrame(() => applyOption(option));
    return;
  }

  if (!instance) {
    const { themeName } = workbenchContent().dashboard;
    echarts.registerTheme(themeName, getEchartsTheme());
    instance = echarts.init(el, themeName);
  }

  clearCanvasCheck();

  if (option && typeof option === "object") {
    try {
      instance.setOption(option, { notMerge: true, lazyUpdate: true });
    } catch {
      // Fall back to the table directly after catching an exception
      fallbackToTableNow();
      return;
    }
  } else {
    instance.clear();
  }

  requestAnimationFrame(() => {
    if (!instance) return;

    try {
      instance.resize();
    } catch {
      // Fall back to the table directly after catching an exception
      fallbackToTableNow();
      return;
    }

    // Fall back to the table directly on first failure
    fallbackIfNoCanvasSoon();
  });
}

function refreshTabular() {
  const rows = props.chart?.rows || [];
  tabular.value = extractTabularDataFromOption(rows);
}

function toggleData() {
  if (!dataOpen.value) {
    refreshTabular();
    dataOpen.value = true;
  } else {
    dataOpen.value = false;
  }
}

function openZoom() {
  if (dataOpen.value) {
    refreshTabular();
    modalMode.value = "table";
    modalOpen.value = true;
    return;
  }

  modalMode.value = "chart";
  zoomOption.value = safeCloneOption(props.chart?.option);
  modalOpen.value = true;
}

function closeZoom() {
  modalOpen.value = false;
}

function handleConditionsChange(f) {
  const dashboardId = String(props.dashboardId || "").trim();
  const chartId = String(props.chart?.id || "").trim();
  const chartTitle = String(props.chart?.title || "").trim();
  const dataPlan = props.chart?.dataPlan;

  emit("chart-conditions-changed", {
    chartId,
    chartTitle,
    dataPlan,
    conditions: f,
    chartType: String(props.chart?.chartType || "").trim(),
    fields: props.chart?.fields,
    dashboardId,
    dsl: props.chart?.dsl,
    abcProgram: props.chart?.abcProgram,
    source: props.chart?.source,
  });
}

watch(
  () => props.chart && props.chart.option,
  (next) => {
    applyOption(next);
  },
  { deep: true, immediate: true }
);

watch(
  () => props.chart?.rows,
  () => {
    if (!dataOpen.value) return;
    refreshTabular();
  }
);

watch(
  () => state.value,
  (nextState) => {
    if (nextState !== "error") return;
    refreshTabular();
    dataOpen.value = true;
  },
  { immediate: true }
);

/* ======================== resize (grid layout) ========================= */
function setupResize() {
  const el = rootRef.value;
  if (!el) return;

  interactable = interact(el).resizable({
    allowFrom: ".resize-handle",
    edges: { right: true, bottom: true, left: false, top: false },
    listeners: {
      start() {
        emit("resize-active", true);
      },
      move(event) {
        const target = event.target;
        const gridEl = target.closest(".charts-section");
        const { colCount, colWidth, gap } = parseGridColumns(gridEl);

        const w = event.rect.width;
        const h = event.rect.height;

        const colSpan = clamp(Math.round((w + gap) / (colWidth + gap)), 1, Math.max(1, colCount));

        // rowSpan: roughly converted from the chart-wrapper base height 280 + header/toolbars
        const baseRowPx = 360;
        const rowGap = 16;
        const rowSpan = clamp(Math.round((h + rowGap) / (baseRowPx + rowGap)), 1, 6);

        emit("layout-change", { colSpan, rowSpan });

        // Make echarts more responsive during dragging (optional)
        requestAnimationFrame(() => {
          try {
            instance && instance.resize();
          } catch {
            return;
          }
        });
      },
      end() {
        emit("resize-active", false);
      },
    },
    modifiers: [
      interact.modifiers.restrictSize({
        min: { width: 360, height: 260 },
      }),
    ],
    inertia: true,
  });
}

onMounted(() => {
  const el = elRef.value;
  if (!el) return;
  resizeObs = new ResizeObserver(() => requestAnimationFrame(() => instance && instance.resize()));
  resizeObs.observe(el);
  applyOption(props.chart?.option);
  setupResize();
});

onBeforeUnmount(() => {
  cancelApplyRetry();
  clearCanvasCheck();
  if (resizeObs) resizeObs.disconnect();
  resizeObs = null;
  if (instance) instance.dispose();
  instance = null;
  if (interactable) {
    interactable.unset();
    interactable = null;
  }
});
</script>

<style scoped>
.chart-container {
  grid-column: span var(--col-span, 1);
  grid-row: span var(--row-span, 1);
  height: 100%;
  padding: 18px;
  background-color: var(--el-bg-color);
  border-radius: var(--radius-2xl);
  border: 1px solid var(--el-border-color);
  box-shadow: var(--shadow-card);
  position: relative;
  display: flex;
  flex-direction: column;
  transition:
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}

.chart-container:hover {
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-1px);
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 12px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--el-border-color);
}

.chart-header h3 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.chart-wrapper {
  width: 100%;
  flex: 1;
  min-height: 280px;
  position: relative;
}

.chart-wrapper--transparent-loading :deep(.el-loading-mask) {
  background-color: transparent;
}

.chart-echarts {
  width: 100%;
  height: 100%;
}

.chart-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-tertiary);
  font-size: var(--text-xs);
  background: color-mix(in srgb, var(--el-bg-color) 72%, transparent);
  border-radius: var(--radius-lg);
}

:deep(.el-loading-spinner .el-loading-text) {
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}

:deep(.ai-chart-toolbar) {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: var(--radius-xl);
  background: color-mix(in srgb, var(--el-bg-color) 92%, transparent);
  border: 1px solid var(--el-border-color);
  box-shadow: var(--shadow-card);
  opacity: 0;
  transform: translateX(10px);
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
  pointer-events: none;
  user-select: none;
}

.chart-container:hover :deep(.ai-chart-toolbar),
:deep(.ai-chart-toolbar[data-open="1"]) {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
  user-select: auto;
}

:deep(button.ai-chart-tool-btn) {
  width: 26px;
  height: 26px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  border-radius: var(--radius-sm);
  color: var(--el-text-color-secondary);
  transition: all var(--transition-fast);
}

:deep(button.ai-chart-tool-btn:hover) {
  background: var(--el-fill-color);
  border-color: var(--el-border-color);
  color: var(--el-color-primary);
}

:deep(button.ai-chart-tool-btn:disabled),
:deep(button.ai-chart-tool-btn:disabled:hover) {
  cursor: not-allowed;
  opacity: 0.3;
  transform: none;
  color: var(--el-text-color-tertiary);
}

:deep(button.ai-chart-tool-btn img) {
  width: 15px;
  height: 15px;
}

.chart-container:hover .resize-handle {
  opacity: 1;
}
</style>
