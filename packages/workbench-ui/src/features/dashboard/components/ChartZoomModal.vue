<template>
  <teleport to="body">
    <div v-if="open" class="ai-dashboard-chart-zoom-modal" data-open="1" @click="handleMaskClick">
      <div class="ai-zoom-card" role="dialog" aria-modal="true">
        <div class="ai-zoom-header">
          <div class="ai-zoom-title">{{ title }}</div>
          <button
            class="ai-zoom-close"
            type="button"
            aria-:label="t('common.close')"
            @click="emit('close')"
          >
            ×
          </button>
        </div>
        <div class="ai-zoom-body">
          <div v-show="mode === 'chart'" ref="chartRef" class="ai-zoom-chart"></div>
          <div v-show="mode === 'table'" class="ai-zoom-table" @click.stop>
            <ChartDataTable :tabular="tabular" :max-rows="maxRows" />
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import * as echarts from "echarts";
import ChartDataTable from "./ChartDataTable.vue";
import { safeCloneOption } from "./utils/chartTabular";
import { getEchartsTheme } from "./utils/echartsTheme";
import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../content";

useI18n();

const props = defineProps({
  open: { type: Boolean, default: false },
  mode: { type: String, default: "chart" },
  title: { type: String, default: "" },
  option: { type: Object, default: null },
  tabular: { type: Object, default: null },
  maxRows: { type: Number, default: 500 },
});

const emit = defineEmits(["close"]);

const chartRef = ref(null);
let modalChart = null;
let resizeObs = null;

function disposeChart() {
  if (resizeObs) {
    resizeObs.disconnect();
    resizeObs = null;
  }
  if (modalChart) {
    modalChart.dispose();
    modalChart = null;
  }
}

function getModalOption() {
  const opt = safeCloneOption(props.option) || {};
  if (opt && typeof opt === "object") {
    opt.backgroundColor = "transparent";
    if (opt.title) opt.title = undefined;
  }
  return opt;
}

async function ensureChartReady() {
  await nextTick();
  const el = chartRef.value;
  if (!el) return;
  if (!modalChart) {
    const visuals = workbenchContent().dashboard;
    if (visuals.zoomChartTheme === "dashboard") {
      echarts.registerTheme(visuals.themeName, getEchartsTheme());
      modalChart = echarts.init(el, visuals.themeName);
    } else {
      modalChart = echarts.init(el);
    }
    if (typeof ResizeObserver !== "undefined") {
      resizeObs = new ResizeObserver(() => {
        try {
          modalChart?.resize?.();
        } catch {
          // Ignore resize errors
        }
      });
      resizeObs.observe(el);
    }
  }
}

async function applyChart() {
  if (!props.open || props.mode !== "chart") return;
  if (!props.option) return;
  await ensureChartReady();
  if (!modalChart) return;
  try {
    modalChart.setOption(getModalOption(), { notMerge: true, lazyUpdate: false });
  } catch {
    disposeChart();
  }
}

function handleMaskClick(e) {
  if (e.target?.classList?.contains("ai-dashboard-chart-zoom-modal")) emit("close");
}

let keydownHandler = null;
watch(
  () => props.open,
  (open) => {
    if (open) {
      keydownHandler = (e) => {
        if (e.key === "Escape") emit("close");
      };
      window.addEventListener("keydown", keydownHandler);
      void applyChart();
      return;
    }
    if (keydownHandler) window.removeEventListener("keydown", keydownHandler);
    keydownHandler = null;
    disposeChart();
  }
);

watch(
  () => props.mode,
  () => {
    if (!props.open) return;
    if (props.mode === "chart") {
      void applyChart();
      return;
    }
    disposeChart();
  }
);

watch(
  () => props.option,
  () => {
    if (!props.open || props.mode !== "chart") return;
    void applyChart();
  }
);

onBeforeUnmount(() => {
  if (keydownHandler) window.removeEventListener("keydown", keydownHandler);
  keydownHandler = null;
  disposeChart();
});
</script>

<style scoped>
.ai-dashboard-chart-zoom-modal {
  position: fixed;
  inset: 0;
  z-index: 999999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}

.ai-zoom-card {
  width: min(1100px, 92vw);
  height: min(720px, 92vh);
  background: var(--el-bg-color);
  border-radius: 12px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ai-zoom-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color);
}

.ai-zoom-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-zoom-close {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: var(--el-fill-color);
  cursor: pointer;
  color: var(--el-text-color-secondary);
  font-size: 16px;
  line-height: 28px;
}

.ai-zoom-close:hover {
  background: var(--el-fill-color-dark);
  color: var(--el-text-color-primary);
}

.ai-zoom-body {
  position: relative;
  flex: 1 1 auto;
}

.ai-zoom-chart {
  position: absolute;
  inset: 0;
}

.ai-zoom-table {
  position: absolute;
  inset: 0;
  overflow: auto;
  padding: 0 10px 10px;
  box-sizing: border-box;
  background: var(--el-bg-color);
}
</style>
