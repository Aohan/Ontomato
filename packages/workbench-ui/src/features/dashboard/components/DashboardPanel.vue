<template>
  <!-- Outer gate: hide the UI only while the first-screen is pending -->
  <div ref="dashRootRef" class="dash-root" :class="{ 'is-layout-pending': !layoutReady }">
    <!-- Empty state: dashboard with no dimensions (vertically centered) -->
    <div
      v-if="
        normalizeId(props.dashboardId) && Array.isArray(chartGroups) && chartGroups.length === 0
      "
      class="empty-state"
    >
      <div class="empty-state__content">
        <div class="empty-state__icon">📊</div>
        <div class="empty-state__title">{{ t("hotData.noDimensionInDashboard") }}</div>
        <div class="empty-state__desc">{{ t("hotData.createDimensionFirstHint") }}</div>
        <el-button type="primary" size="large" @click="handleCreateDimension">
          <el-icon class="btn-icon"><Plus /></el-icon>
          {{ t("analysis.createDimension") }}
        </el-button>
      </div>
    </div>

    <!-- Main body: group dragging -->
    <Draggable
      v-else-if="Array.isArray(chartGroups)"
      v-model="chartGroups"
      class="bi-dashboard"
      item-key="id"
      handle=".group-drag-handle"
      :animation="180"
      :force-fallback="true"
      :fallback-tolerance="3"
      :group="{ name: 'dashboard-groups', pull: true, put: false }"
      :ghost-class="'drag-ghost'"
      :drag-class="'drag-dragging'"
      @end="() => persistLayoutDebounced()"
    >
      <template #item="{ element: g }">
        <div class="block" :data-group-id="g.id">
          <div class="group-header">
            <span class="group-drag-handle" :title="t('dashboard.dragToMoveGroup')">
              <el-icon :size="16"><GripVertical /></el-icon>
            </span>

            <div class="group-title" :title="g.title || ''">
              {{ g.title || t("hotData.unnamedDimension") }}
            </div>

            <DropdownMenu
              scene="dimension"
              trigger-class="group-more"
              @command="(cmd) => handleDimensionCommand(cmd, g)"
            />
          </div>

          <!-- Metric dragging -->
          <Draggable
            v-if="Array.isArray(g.metrics)"
            v-model="g.metrics"
            item-key="id"
            tag="div"
            :class="['metrics-section', { 'metrics-empty': g.metrics.length === 0 }]"
            :group="{ name: 'dashboard-metrics', pull: true, put: ['dashboard-metrics'] }"
            :animation="180"
            :force-fallback="true"
            :fallback-tolerance="3"
            :filter="'.resize-handle, .metric-more'"
            :prevent-on-filter="false"
            :ghost-class="'drag-ghost'"
            :drag-class="'drag-dragging'"
            :disabled="dragDisabled"
            @end="() => persistLayoutDebounced()"
          >
            <template #item="{ element: m, index: mi }">
              <MetricCard
                :metric="m"
                :style="gridSpanStyle(m?.layout)"
                @command="(cmd) => handleMetricCommand(cmd, g, m, mi)"
                @layout-change="(layout) => handleLayoutChange(g, m, layout)"
                @resize-active="(v) => setDragDisabled(v)"
              />
            </template>
          </Draggable>

          <div v-if="Array.isArray(g.charts)" class="charts-wrapper">
            <Draggable
              v-model="g.charts"
              item-key="id"
              tag="div"
              :class="[
                'charts-section',
                { 'charts-section--empty': g.charts.length === 0 && g.metrics.length === 0 },
              ]"
              :group="{ name: 'dashboard-charts', pull: true, put: ['dashboard-charts'] }"
              :animation="180"
              :force-fallback="true"
              :fallback-tolerance="3"
              :filter="'.resize-handle, .ai-chart-toolbar'"
              :prevent-on-filter="false"
              :empty-insert-threshold="48"
              :ghost-class="'drag-ghost'"
              :drag-class="'drag-dragging'"
              :disabled="dragDisabled"
              @end="() => persistLayoutDebounced()"
            >
              <template #item="{ element: c }">
                <ChartCard
                  :chart="c"
                  :style="gridSpanStyle(c?.layout)"
                  :dashboard-id="normalizeId(props.dashboardId)"
                  :conditions="Array.isArray(c?.conditions) ? c.conditions : []"
                  :attr-show-name-map="attrShowNameMapByClass"
                  @chart-renamed="handleChartRenamed"
                  @chart-deleted="handleChartDeleted"
                  @chart-conditions-changed="handleChartConditionsChanged"
                  @view-dsl="handleViewDsl"
                  @ai-request="(chart) => handleAiRequest(chart)"
                  @layout-change="(layout) => handleLayoutChange(g, c, layout)"
                  @resize-active="(v) => setDragDisabled(v)"
                />
              </template>
            </Draggable>

            <div
              v-if="g.charts.length === 0 && g.metrics.length === 0"
              class="charts-empty-overlay"
            >
              <div class="charts-empty-hint">
                <div class="charts-empty-hint__title">{{ t("hotData.noChartInDim") }}</div>
                <div class="charts-empty-hint__desc">
                  {{ t("hotData.clickInQueryResult") }}
                  <span class="charts-empty-hint__hl">{{ t("analysis.addToDashboard") }}</span>
                  {{ t("hotData.toGenChart") }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </Draggable>

    <!-- Dashboard not loaded -->
    <div v-else class="empty">{{ t("hotData.noDashboardData") }}</div>

    <AiDrawer v-model="aiDrawerOpen" :chart="aiChart" />

    <el-dialog v-model="dslDialogOpen" :title="dslDialogTitle" width="860px" append-to-body>
      <DslViewer :value="dslDialogData" />
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { GripVertical, Plus } from "lucide-vue-next";
import Draggable from "vuedraggable";
import ChartCard from "./ChartCard.vue";
import MetricCard from "./MetricCard.vue";
import AiDrawer from "./AIDrawer.vue";
import DropdownMenu from "./DropdownMenu.vue";
import DslViewer from "./DslViewer.vue";

import {
  normalizeId,
  patchDimensionTitle,
  patchDeleteDimension,
  patchChartTitle,
  patchDeleteChart,
  patchChartOption,
  patchChartConditions,
  patchMetricTitle,
  patchDeleteMetric,
  fetchClassMetas,
  createDashboardLoader,
  clamp,
} from "./utils/dashboardHelper";

import {
  modifyDimensionName,
  deleteDimension,
  modifyMetricName,
  deleteMetric,
  modifyDashboardLayout,
  modifyResultSetConditions,
  getAnswerByDslConditionParam,
  createDimension,
  fetchDashboardLocalDetail,
} from "../api";
import { applyDataPlan } from "./utils/dataPlan";

import echartsGenerator from "./utils/echartsGenerator";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

/* ======================== props & state ======================== */

const props = defineProps({
  dashboardId: { type: String, default: "" },
});

const dragDisabled = ref(false);
const chartGroups = ref(null);
const attrShowNameMapByClass = ref({});
const aiDrawerOpen = ref(false);
const aiChart = ref(null);

const dslDialogOpen = ref(false);
const dslDialogTitle = ref("");
const dslDialogData = ref(null);

const loader = createDashboardLoader();

/* ======================== Layout Gate (allow through once after the first-screen stabilizes, no rollback) ======================== */

const dashRootRef = ref(null);
const layoutReady = ref(false);

let layoutRO = null;
let raf1 = 0;
let raf2 = 0;
let stableTimer = null;
let dashboardLoadToken = 0;

let lastW = 0;
let stableHits = 0;

function clearStableTimer() {
  if (stableTimer) {
    clearTimeout(stableTimer);
    stableTimer = null;
  }
}

function armLayoutFallback() {
  if (layoutReady.value) return;
  clearStableTimer();
  stableTimer = setTimeout(() => {
    layoutReady.value = true;
    stableTimer = null;
  }, 450);
}

function resetLayoutGate() {
  layoutReady.value = false;
  lastW = 0;
  stableHits = 0;
  clearStableTimer();
  cancelAnimationFrame(raf1);
  cancelAnimationFrame(raf2);
  armLayoutFallback();
  // The ResizeObserver doesn't need disconnecting; the ready check returns directly
}

function checkStableWidthOnce() {
  if (layoutReady.value) return;

  const el = dashRootRef.value;
  if (!el) return;

  const w = el.getBoundingClientRect().width || 0;

  // A more aggressive threshold: avoid waiting too long
  if (w < 520) {
    stableHits = 0;
    lastW = w;
    return;
  }

  const delta = Math.abs(w - lastW);
  lastW = w;

  // Allow through as long as one consecutive change is small
  if (delta <= 2) stableHits += 1;
  else stableHits = 0;

  if (stableHits >= 1) {
    layoutReady.value = true;
    if (stableTimer) {
      clearTimeout(stableTimer);
      stableTimer = null;
    }
  }
}

function scheduleStableCheckOnce() {
  if (layoutReady.value) return;
  armLayoutFallback();

  cancelAnimationFrame(raf1);
  cancelAnimationFrame(raf2);

  raf1 = requestAnimationFrame(() => {
    raf2 = requestAnimationFrame(() => {
      checkStableWidthOnce();
    });
  });
}

function ensureLayoutObserver() {
  const el = dashRootRef.value;
  if (!el) return;
  if (!layoutRO && typeof ResizeObserver !== "undefined") {
    layoutRO = new ResizeObserver(() => {
      scheduleStableCheckOnce();
    });
    layoutRO.observe(el);
  }
  scheduleStableCheckOnce();
  armLayoutFallback();
}

/* ======================== utils ======================== */

async function reloadDashboardGroups(id) {
  const detail = await fetchDashboardLocalDetail(id);
  chartGroups.value = Array.isArray(detail?.groups) ? detail.groups : [];
}

function setDragDisabled(v) {
  dragDisabled.value = !!v;
  if (!v) requestAnimationFrame(() => cleanupDragClasses());
}

function cleanupDragClasses() {
  const root = document.querySelector(".bi-dashboard");
  if (!root) return;
  root.querySelectorAll(".drag-ghost, .drag-dragging").forEach((el) => {
    el.classList.remove("drag-ghost", "drag-dragging");
  });
}

/** layout maps to CSS Grid span */
function gridSpanStyle(layout) {
  const colSpan = clamp(layout?.colSpan ?? 1, 1, 24);
  const rowSpan = clamp(layout?.rowSpan ?? 1, 1, 6);
  return {
    "--col-span": String(colSpan),
    "--row-span": String(rowSpan),
    gridColumn: `span ${colSpan}`,
    gridRow: `span ${rowSpan}`,
  };
}

/* ======================== persistence ======================== */

let persistTimer = null;
let persistSaving = false;
let persistDirty = false;
let persistLastWarnAt = 0;

function buildLayoutPersistPayload(groups) {
  const gs = Array.isArray(groups) ? groups : [];

  const pickLayout = (layout) => ({
    colSpan: clamp(layout?.colSpan ?? 1, 1, 24),
    rowSpan: clamp(layout?.rowSpan ?? 1, 1, 6),
  });

  const pickChart = (c) => {
    const { name, title, chartType, dataPlan, id, fields, dsl, abcProgram, source, conditions } = c;
    return {
      name: title || name || "",
      type: chartType,
      chartType,
      dataPlan,
      id,
      layout: pickLayout(c?.layout),
      fields,
      dsl: dsl || {},
      abcProgram,
      source,
      conditions: Array.isArray(conditions) ? conditions : [],
    };
  };

  const pickMetric = (m) => {
    const { name, title, unit, agg, valueField, dataPlan, id, dsl, abcProgram, source } = m;
    return {
      name: name || title || "",
      unit,
      agg,
      valueField,
      dataPlan,
      id,
      layout: pickLayout(m?.layout),
      dsl: dsl || {},
      abcProgram,
      source,
    };
  };

  return gs.map((g) => {
    const charts = Array.isArray(g?.charts) ? g.charts : [];
    const metrics = Array.isArray(g?.metrics) ? g.metrics : [];
    return {
      id: normalizeId(g?.id || ""),
      title: String(g?.title || "").trim(),
      charts: charts.map(pickChart).filter((x) => x.id && (x.dsl || x.abcProgram)),
      metrics: metrics.map(pickMetric).filter((x) => x.id && (x.dsl || x.abcProgram)),
    };
  });
}

async function flushPersistLayout() {
  const id = normalizeId(props.dashboardId);
  if (!id) return;
  if (persistSaving) return;

  persistSaving = true;
  try {
    while (persistDirty) {
      persistDirty = false;
      const payload = buildLayoutPersistPayload(chartGroups.value);
      await modifyDashboardLayout(id, payload);
    }
  } catch {
    persistDirty = true;
    const now = Date.now();
    if (!persistLastWarnAt || now - persistLastWarnAt > 4000) {
      persistLastWarnAt = now;
      ElMessage.warning(t("dashboard.layoutSaveFailedRetry"));
    }
  } finally {
    persistSaving = false;
  }
}

function persistLayoutDebounced() {
  const id = normalizeId(props.dashboardId);
  if (!id) return;
  persistDirty = true;

  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushPersistLayout();
  }, 400);
}

/* ======================== create dimension ======================== */

async function handleCreateDimension(insertIndex) {
  const id = normalizeId(props.dashboardId);
  if (!id) return;

  try {
    const ret = await ElMessageBox.prompt(
      t("analysis.enterDimensionName"),
      t("analysis.createDimension"),
      {
        confirmButtonText: t("common.create"),
        cancelButtonText: t("common.cancel"),
        inputValidator: (v) => {
          const s = String(v || "").trim();
          if (!s) return t("common.nameRequired");
          if (s.length > 50) return t("common.nameTooLong");
          return true;
        },
      }
    );

    const dimensionName = String(ret?.value || "").trim();
    if (!dimensionName) return;

    const ok = await createDimension(id, dimensionName);
    if (!ok) throw new Error(t("analysis.createFailed"));

    // Record the group ids that existed before creation
    const before = Array.isArray(chartGroups.value) ? chartGroups.value : [];
    const beforeIds = new Set(before.map((g) => normalizeId(g?.id)).filter(Boolean));

    // Fetch locally added groups (only append the new ones)
    await reloadAndAppendOnly(id);

    // Find the newly added groups
    const list = Array.isArray(chartGroups.value) ? chartGroups.value : [];
    const addedIndex = list.findIndex((g) => {
      const gid = normalizeId(g?.id);
      return gid && !beforeIds.has(gid);
    });
    if (addedIndex === -1) {
      ElMessage.success(t("dashboard.created"));
      return;
    }

    // Insert the new groups at the specified position (below) and persist the order
    const added = list.splice(addedIndex, 1)[0];

    // When insertIndex is not passed, append to the end by default
    let target = typeof insertIndex === "number" ? insertIndex : list.length;
    target = Math.max(0, Math.min(target, list.length));

    list.splice(target, 0, added);
    chartGroups.value = list;

    // Save the new dimension order (based on modifyDashboardLayout order)
    persistLayoutDebounced();

    requestAnimationFrame(() => {
      const gid = normalizeId(added?.id);
      if (!gid) return;
      document
        .querySelector(`[data-group-id="${gid}"]`)
        ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });

    ElMessage.success(t("dashboard.created"));
  } catch (e) {
    if (e === "cancel") return;
    ElMessage.error(e instanceof Error ? e.message : t("analysis.createFailed"));
  }
}

async function loadDashboardAll(id) {
  // 1) Local detail
  await reloadDashboardGroups(id);

  // 2) Remote merge (restore option/dataRows, etc.)
  await loader.loadDashboardById(id, (updater) => {
    chartGroups.value = typeof updater === "function" ? updater(chartGroups.value || []) : updater;
  });
}

function appendNewGroupsOnly(prevGroups, nextGroupsFromLocal) {
  const prev = Array.isArray(prevGroups) ? prevGroups : [];
  const next = Array.isArray(nextGroupsFromLocal) ? nextGroupsFromLocal : [];

  const existed = new Set(prev.map((g) => normalizeId(g?.id)).filter(Boolean));
  const added = next.filter((g) => {
    const gid = normalizeId(g?.id);
    return gid && !existed.has(gid);
  });

  // Only append the new ones (don't mutate any existing object in prev, ensuring remote fields aren't lost)
  return prev.concat(added);
}

async function reloadAndAppendOnly(id) {
  const detail = await fetchDashboardLocalDetail(id);
  const localGroups = Array.isArray(detail?.groups) ? detail.groups : [];
  chartGroups.value = appendNewGroupsOnly(chartGroups.value, localGroups);
}

/* ======================== watch dashboard ======================== */

watch(
  () => normalizeId(props.dashboardId),
  async (id) => {
    const loadToken = ++dashboardLoadToken;

    // Reset the dashboard reset gate
    resetLayoutGate();

    if (!id) {
      chartGroups.value = null;
      layoutReady.value = true;
      return;
    }

    try {
      await loadDashboardAll(id);
      if (loadToken !== dashboardLoadToken) return;

      // Schedule another check after data arrives (but still only check false->true once)
      await nextTick();
      scheduleStableCheckOnce();
    } catch (e) {
      if (loadToken !== dashboardLoadToken) return;
      layoutReady.value = true;
      ElMessage.error(e instanceof Error ? e.message : t("dashboard.loadDashboardFailed"));
    }
  },
  { immediate: true }
);

/* ======================== lifecycle ======================== */

onMounted(async () => {
  fetchClassMetas().then((cmap) => {
    attrShowNameMapByClass.value = cmap;
  });

  await nextTick();
  ensureLayoutObserver();
});

onBeforeUnmount(() => {
  loader.abort();

  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  if (persistDirty) flushPersistLayout();

  if (layoutRO) {
    layoutRO.disconnect();
    layoutRO = null;
  }
  if (stableTimer) {
    clearTimeout(stableTimer);
    stableTimer = null;
  }
  cancelAnimationFrame(raf1);
  cancelAnimationFrame(raf2);
});

/* ======================== dimension ops ======================== */

async function handleDimensionCommand(cmd, g) {
  const id = normalizeId(props.dashboardId);
  const groupId = normalizeId(g?.id);
  if (!id || !groupId) return;

  // Create above/below the current dimension
  if (cmd === "create_above" || cmd === "create_below") {
    const list = Array.isArray(chartGroups.value) ? chartGroups.value : [];
    const curIndex = list.findIndex((x) => normalizeId(x?.id) === groupId);
    const insertIndex = curIndex < 0 ? undefined : cmd === "create_above" ? curIndex : curIndex + 1;

    return handleCreateDimension(insertIndex);
  }

  if (cmd === "rename") {
    try {
      const ret = await ElMessageBox.prompt(
        t("analysis.enterDimensionName"),
        t("dashboard.renameDimension"),
        {
          confirmButtonText: t("common.ok"),
          cancelButtonText: t("common.cancel"),
          inputValue: String(g?.title || "").trim(),
        }
      );

      const nextName = String(ret?.value || "").trim();
      if (!nextName) return;

      const ok = await modifyDimensionName(id, groupId, nextName);
      if (!ok) throw new Error(t("common.renameFailed"));

      chartGroups.value = patchDimensionTitle(chartGroups.value, groupId, nextName);
      ElMessage.success(t("common.renamed"));
    } catch (e) {
      if (e === "cancel") return;
      ElMessage.error(e instanceof Error ? e.message : t("common.renameFailed"));
    }
  }

  if (cmd === "delete") {
    try {
      await ElMessageBox.confirm(
        t("dashboard.deleteDimensionConfirm", { name: String(g?.title || groupId) }),
        t("common.deleteConfirm"),
        {
          confirmButtonText: t("common.delete"),
          cancelButtonText: t("common.cancel"),
          type: "warning",
          confirmButtonClass: "el-button--danger",
        }
      );

      const ok = await deleteDimension(id, groupId);
      if (!ok) throw new Error(t("admin.deleteFailed"));

      chartGroups.value = patchDeleteDimension(chartGroups.value, groupId);
      ElMessage.success(t("common.deleted"));
    } catch (e) {
      if (e === "cancel") return;
      ElMessage.error(e instanceof Error ? e.message : t("admin.deleteFailed"));
    }
  }
}

/* ======================== metric ops ======================== */

async function handleMetricCommand(cmd, _g, m) {
  const id = normalizeId(props.dashboardId);
  const metricId = normalizeId(m?.id);
  const metricTitle = String(m?.name || "").trim();
  if (!id || !metricId) return;

  if (cmd === "view_dsl") {
    openDslDialog(metricTitle || t("common.viewDsl"), m?.dsl ?? null);
    return;
  }

  if (cmd === "rename") {
    try {
      const ret = await ElMessageBox.prompt(
        t("dashboard.enterMetricName"),
        t("dashboard.renameMetric"),
        {
          confirmButtonText: t("common.ok"),
          cancelButtonText: t("common.cancel"),
          inputValue: metricTitle,
        }
      );

      const nextName = String(ret?.value || "").trim();
      if (!nextName) return;

      const ok = await modifyMetricName(id, metricId, nextName);
      if (!ok) throw new Error(t("common.renameFailed"));

      chartGroups.value = patchMetricTitle(chartGroups.value, metricId, nextName);
      ElMessage.success(t("common.renamed"));
    } catch (e) {
      if (e === "cancel") return;
      ElMessage.error(e instanceof Error ? e.message : t("common.renameFailed"));
    }
  }

  if (cmd === "delete") {
    try {
      await ElMessageBox.confirm(
        t("dashboard.deleteMetricConfirm", { name: String(metricTitle) }),
        t("common.deleteConfirm"),
        {
          confirmButtonText: t("common.delete"),
          cancelButtonText: t("common.cancel"),
          type: "warning",
          confirmButtonClass: "el-button--danger",
        }
      );

      const ok = await deleteMetric(id, metricId);
      if (!ok) throw new Error(t("admin.deleteFailed"));

      chartGroups.value = patchDeleteMetric(chartGroups.value, metricId);
      ElMessage.success(t("common.deleted"));
    } catch (e) {
      if (e === "cancel") return;
      ElMessage.error(e instanceof Error ? e.message : t("admin.deleteFailed"));
    }
  }
}

/* ======================== layout change ======================== */

function handleLayoutChange(group, card, layout) {
  if (!layout || typeof layout !== "object") return;
  card.layout = { ...(card.layout || {}), ...layout };
  persistLayoutDebounced();
}

/* ======================== chart events ======================== */

function handleChartRenamed(payload) {
  chartGroups.value = patchChartTitle(chartGroups.value, payload?.chartId, payload?.title);
}

function handleChartDeleted(payload) {
  chartGroups.value = patchDeleteChart(chartGroups.value, payload?.chartId);
}

/* ======================== conditions changed ======================== */

async function handleChartConditionsChanged(payload) {
  const id = normalizeId(props.dashboardId);
  const chartId = normalizeId(payload?.chartId);
  const chartTitle = String(payload.chartTitle || "").trim();
  const chartType = String(payload?.chartType || "").trim();
  const conditions = Array.isArray(payload?.conditions) ? payload.conditions : null;
  const dataPlan =
    payload?.dataPlan && typeof payload.dataPlan === "object" ? payload.dataPlan : null;
  const dsl = payload?.dsl && typeof payload.dsl === "object" ? payload.dsl : null;
  const abcProgram =
    payload?.abcProgram && typeof payload.abcProgram === "object" ? payload.abcProgram : null;

  if (!id || !chartId || (!dsl && !abcProgram)) return;

  // 1) Optimistic update
  chartGroups.value = patchChartConditions(chartGroups.value, chartId, conditions);

  // 2) Save conditions
  try {
    const ok = await modifyResultSetConditions(id, chartId, conditions);
    if (!ok) ElMessage.warning(t("dashboard.conditionsSaveFailed"));
  } catch {
    ElMessage.warning(t("dashboard.conditionsSaveFailed"));
  }

  // 3) Re-request data and update option
  try {
    // Prefer the getAnswerByDslConditionParam API (supports conditional filtering)
    const {
      data: rows,
      rawData,
      fields: mappedFields,
      dsl: nextDsl,
    } = await getAnswerByDslConditionParam({
      dsl,
      abcProgram,
      conditions,
      chartType,
      chartTitle,
      fields: payload.fields,
      dataPlan,
      timeoutMs: abcProgram ? 300000 : 30000,
    });

    const chartRows = applyDataPlan(rawData, dataPlan);
    const usedFields =
      payload.fields && Object.keys(payload.fields).length > 0 ? payload.fields : mappedFields;
    if (!chartRows.length) {
      chartGroups.value = patchChartOption(
        chartGroups.value,
        chartId,
        { __ragchatState: "empty" },
        chartType,
        [],
        usedFields,
        nextDsl || dsl
      );
      return;
    }
    const { option: genOption, health } = echartsGenerator.generateWithHealth(
      chartType || "bar",
      chartTitle,
      usedFields,
      chartRows
    );
    const option = health.ok ? genOption : { ...genOption, __ragchatState: "error" };
    chartGroups.value = patchChartOption(
      chartGroups.value,
      chartId,
      option,
      chartType,
      rows,
      usedFields,
      nextDsl || dsl
    );
    return;
  } catch {
    chartGroups.value = patchChartOption(
      chartGroups.value,
      chartId,
      { __ragchatState: "error" },
      chartType,
      []
    );
  }
}

/* ======================== AI ======================== */

function handleAiRequest(chart) {
  aiDrawerOpen.value = true;
  aiChart.value = chart;
}

function openDslDialog(title, dsl) {
  if (dsl === null || dsl === undefined) {
    ElMessage.warning(t("dashboard.noDslData"));
    return;
  }
  dslDialogTitle.value = String(title || t("common.viewDsl"));
  dslDialogData.value = dsl;
  dslDialogOpen.value = true;
}

function handleViewDsl(payload) {
  openDslDialog(payload?.title || t("common.viewDsl"), payload?.dsl ?? null);
}
</script>

<style scoped>
.dash-root {
  width: 100%;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  align-self: stretch;
  overflow: auto;
  background: radial-gradient(
    circle at 50% 20%,
    color-mix(in srgb, var(--el-color-primary) 6%, transparent),
    transparent 40%
  );
}

.dash-root.is-layout-pending {
  visibility: hidden;
}

/* Empty state: no dimensions */
.empty-state {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 0 24px;
  margin: 0;
  box-sizing: border-box;
  background: radial-gradient(
    circle at 50% 28%,
    color-mix(in srgb, var(--el-color-primary) 6%, transparent),
    transparent 32%
  );
}

.empty-state__content {
  text-align: center;
  transform: translateY(-24px);
}

.empty-state__icon {
  width: 72px;
  height: 72px;
  border-radius: var(--radius-3xl);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 34px;
  margin: 0 auto 14px;
  background: var(--el-bg-color);
  box-shadow: var(--shadow-card);
}

.empty-state__title {
  font-size: var(--text-xl);
  font-weight: var(--font-bold);
  color: var(--el-text-color-primary);
  margin-bottom: 8px;
}

.empty-state__desc {
  font-size: var(--text-sm);
  color: var(--el-text-color-secondary);
  margin-bottom: 20px;
}

/* Main body */
.bi-dashboard {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  padding: 28px 24px;
  box-sizing: border-box;
  background-color: transparent;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.block {
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-2xl);
  padding: 20px 20px 16px;
  box-shadow: var(--shadow-card);
}

/* ===============================
   group header (icon + title + more)
================================ */
.group-header {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding-right: 2px;
  margin-bottom: 12px;
  box-sizing: border-box;
}

.group-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  cursor: grab;
  color: var(--el-text-color-tertiary);
  flex-shrink: 0;
  transition: all var(--transition-fast);
}
.group-drag-handle:hover {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.group-title {
  flex: 1;
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  color: var(--el-text-color-primary);
  line-height: 1;
  display: flex;
  align-items: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.01em;
}

.group-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--el-text-color-tertiary);
  flex-shrink: 0;
  transition: all var(--transition-fast);
}

.group-more:hover {
  background: var(--el-fill-color-dark);
  color: var(--el-color-primary);
}

.group-header :deep(.el-icon) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  vertical-align: middle;
}

/* ===============================
   metric card
================================ */
.metrics-section {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  grid-auto-rows: 102px;
  gap: 14px;
  margin-bottom: 14px;
}

.metrics-section.metrics-empty {
  margin-bottom: 0;
}

/* ===============================
   chart area
================================ */
.charts-wrapper {
  position: relative;
}

.charts-section {
  display: grid;
  grid-template-columns: repeat(24, 1fr);
  grid-auto-rows: 360px;
  gap: 14px;
}

.charts-section--empty {
  min-height: 200px;
  border: 1.5px dashed var(--el-border-color-dark);
  border-radius: var(--radius-2xl);
  background: var(--el-fill-color-extra-light);
}

.charts-empty-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.charts-empty-hint {
  text-align: center;
  user-select: none;
  padding: 24px;
}

.charts-empty-hint__title {
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}

.charts-empty-hint__desc {
  font-size: var(--text-sm);
  color: var(--el-text-color-tertiary);
  line-height: 1.7;
}

.charts-empty-hint__hl {
  font-weight: var(--font-semibold);
  color: var(--el-color-primary);
}

/* ===============================
   drag effect
================================ */
.drag-ghost {
  opacity: 0.45;
  border-radius: var(--radius-2xl);
}
.drag-dragging {
  cursor: grabbing !important;
  border-radius: var(--radius-2xl);
}

/* Others */
.empty {
  text-align: center;
  margin-top: 20px;
  color: var(--el-text-color-tertiary);
  font-size: var(--text-sm);
}

.btn-icon {
  margin-right: 6px;
}
@media (max-width: 700px) {
  :where(html.workbench-mobile-navigation) .bi-dashboard {
    padding: 12px 10px calc(12px + env(safe-area-inset-bottom));
    gap: 12px;
  }
  :where(html.workbench-mobile-navigation) .block {
    padding: 12px 10px;
    border-radius: 12px;
  }
  :where(html.workbench-mobile-navigation) .group-header {
    margin-bottom: 8px;
  }
  :where(html.workbench-mobile-navigation) .group-title {
    font-size: var(--text-base);
  }
  :where(html.workbench-mobile-navigation) .metrics-section,
  :where(html.workbench-mobile-navigation) .charts-section {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }
  :where(html.workbench-mobile-navigation) .metrics-section > *,
  :where(html.workbench-mobile-navigation) .charts-section > * {
    grid-column: 1 / -1 !important;
  }
  :where(html.workbench-mobile-navigation) .charts-section {
    grid-auto-rows: 300px;
  }
  :where(html.workbench-mobile-navigation) .group-drag-handle {
    display: none;
  }
  :where(html.workbench-mobile-navigation) .empty-state {
    padding: 16px;
  }
  :where(html.workbench-mobile-navigation) .empty-state__content {
    transform: none;
  }
}
</style>
