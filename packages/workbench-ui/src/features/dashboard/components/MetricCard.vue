<template>
  <el-card
    class="metric-card"
    shadow="never"
    :body-style="{ padding: '0', height: '100%', overflow: 'hidden' }"
  >
    <div ref="rootRef" class="metric-container">
      <div class="title-row">
        <h3 class="title" :title="name">{{ name }}</h3>
        <DropdownMenu
          scene="metric"
          trigger-class="metric-more"
          @command="(cmd) => emit('command', cmd)"
        />
      </div>
      <div
        v-loading="loading"
        :class="['value-container', { 'value-container--transparent-loading': transparentLoading }]"
        element-loading-text=""
      >
        <div class="value" :title="formattedValue">{{ formattedValue }}</div>
        <div v-if="unit" class="unit">{{ unit }}</div>
      </div>
      <span class="resize-handle" :title="t('dashboard.dragToResize')" />
    </div>
  </el-card>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import interact from "interactjs";
import DropdownMenu from "./DropdownMenu.vue";
import { clamp, parseGridColumns } from "./utils/dashboardHelper";
import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../content";

/** Loading mask background follows the app's original value (open source: transparent). */
const transparentLoading = workbenchContent().dashboard.loadingMask === "transparent";

const { t } = useI18n();

const props = defineProps({
  metric: {
    type: Object,
    default: () => ({
      name: "",
      value: 0,
      unit: "",
      layout: { colSpan: 1, rowSpan: 1 },
    }),
  },
});

const emit = defineEmits(["command", "layout-change", "resize-active"]);

function formatValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;

  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);

  if (num % 1 !== 0) {
    return num.toFixed(2);
  }
  return num.toLocaleString();
}

const name = computed(() => String(props.metric?.name || ""));
const unit = computed(() => String(props.metric?.unit || "").trim());
const loading = computed(() => String(props.metric?.state || "").trim() === "loading");
const formattedValue = computed(() => formatValue(props.metric?.value));

/* ======================== resize logic ======================== */
const rootRef = ref(null);
let interactable = null;

function setupResize() {
  const el = rootRef.value;
  if (!el) return;

  interactable = interact(el).resizable({
    allowFrom: ".resize-handle",
    edges: { right: true, bottom: false, left: false, top: false },
    listeners: {
      start() {
        emit("resize-active", true);
      },
      move(event) {
        const target = event.target;
        const parent = target?.parentElement; // .el-card__body
        const grid = parent?.parentElement; // the grid container of metrics-section (usually two levels)
        // Find the nearest grid container
        const gridEl = target.closest(".metrics-section") || grid;

        const { colCount, colWidth, gap } = parseGridColumns(gridEl);
        const w = event.rect.width;
        const h = event.rect.height;

        const colSpan = clamp(Math.round((w + gap) / (colWidth + gap)), 1, Math.max(1, colCount));
        // Metric height is fixed around 102px: rowSpan 1 is usually enough. It also supports stretching to 2/3.
        const baseRow = 102;
        const rowGap = 16;
        const rowSpan = clamp(Math.round((h + rowGap) / (baseRow + rowGap)), 1, 6);

        emit("layout-change", { colSpan, rowSpan });
      },
      end() {
        emit("resize-active", false);
      },
    },
    modifiers: [
      // Limit the minimum size to avoid dragging it into an unusable state
      interact.modifiers.restrictSize({
        min: { width: 200, height: 90 },
      }),
    ],
    inertia: true,
  });
}

onMounted(() => setupResize());

onBeforeUnmount(() => {
  if (interactable) {
    interactable.unset();
    interactable = null;
  }
});
</script>

<style scoped>
.metric-card {
  grid-column: span var(--col-span, 1);
  grid-row: span var(--row-span, 1);
  display: block;
  border-radius: var(--radius-2xl);
  border: 1px solid var(--el-border-color);
  box-shadow: var(--shadow-card);
  height: 102px;
  position: relative;
  transition:
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}

.metric-card:hover {
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-1px);
}

.metric-container {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  background: var(--el-bg-color);
  text-align: center;
  padding: 16px;
  height: 100%;
  border-radius: var(--radius-2xl);
}

.title-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.title {
  flex: 1;
  min-width: 0;
  margin: 0;
  text-align: left;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.metric-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--el-text-color-tertiary);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.metric-card:hover .metric-more {
  opacity: 1;
  pointer-events: auto;
}

.metric-more:hover {
  background: var(--el-fill-color-dark);
  color: var(--el-color-primary);
}

.value-container {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  width: 100%;
}

.value-container--transparent-loading :deep(.el-loading-mask) {
  background-color: transparent;
}

.value {
  display: flex;
  font-size: 32px;
  font-weight: var(--font-bold);
  color: var(--el-text-color-primary);
  line-height: 1;
  min-width: 0;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.unit {
  margin-bottom: 2px;
  font-size: var(--text-xs);
  color: var(--el-text-color-tertiary);
  font-weight: var(--font-normal);
}

.metric-card:hover .resize-handle {
  opacity: 1;
}
</style>
