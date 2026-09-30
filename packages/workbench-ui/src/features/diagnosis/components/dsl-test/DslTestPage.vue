<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from "vue";
import { ElMessage } from "element-plus";
import CodeMirrorEditor from "../../../../components/CodeMirrorEditor.vue";
import { diagnosisApi } from "../../api";
import { useI18n } from "vue-i18n";
import type { DslTestPageSlots } from "../layout/types";

const { t } = useI18n();

/* ------------------------------------------------------------------ */
/*  DSL draft (localStorage — ontomato has no viewState store)       */
/* ------------------------------------------------------------------ */

const DRAFT_KEY = "observe-dsl-draft";
const DSL_DEFAULT_TEXT = `{
  "problem": "",
  "answer": {
    "steps": []
  }
}`;

const dslText = ref<string>(localStorage.getItem(DRAFT_KEY) || DSL_DEFAULT_TEXT);

function saveDraft(val: string) {
  try {
    localStorage.setItem(DRAFT_KEY, val ?? "");
  } catch {
    // ignore quota / private-mode errors
  }
}

watch(dslText, (val) => saveDraft(val));
onBeforeUnmount(() => saveDraft(dslText.value));

/* ------------------------------------------------------------------ */
/*  Execution state                                                    */
/* ------------------------------------------------------------------ */

type ExecuteState = "idle" | "loading" | "success" | "error";
const executeState = ref<ExecuteState>("idle");

const resultTab = ref<string>("table");
const resultData = ref<any>(null);

/* ------------------------------------------------------------------ */
/*  Resizable split (same pattern as LiveLogsPage)                     */
/* ------------------------------------------------------------------ */

const splitContainer = ref<HTMLElement | null>(null);
const leftPercent = ref(42);
const isDragging = ref(false);

function onDragStart(e: MouseEvent) {
  e.preventDefault();
  isDragging.value = true;
  const startX = e.clientX;
  const startPercent = leftPercent.value;

  function onMove(ev: MouseEvent) {
    const containerW = splitContainer.value?.clientWidth || 800;
    const delta = ev.clientX - startX;
    const deltaPercent = (delta / containerW) * 100;
    leftPercent.value = Math.max(25, Math.min(70, startPercent + deltaPercent));
  }

  function onUp() {
    isDragging.value = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

/* ------------------------------------------------------------------ */
/*  Derived result views                                               */
/*  Java executeV1 returns the platform payload directly:              */
/*  { data:[{ problem, answer[] }], ... }                               */
/* ------------------------------------------------------------------ */

function normalizeDslPayload(payload: any) {
  if (payload?.success === true && payload?.data && !Array.isArray(payload.data)) {
    return payload.data;
  }
  return payload;
}

const answerRows = computed<any[]>(
  () => normalizeDslPayload(resultData.value)?.data?.[0]?.answer ?? []
);

const tableColumns = computed(() => {
  const first = answerRows.value[0];
  if (!first || typeof first !== "object") return [];
  return Object.keys(first).map((key) => ({ prop: key, label: key }));
});

const tableData = computed(() =>
  answerRows.value.map((row, idx) => {
    const flat: Record<string, any> = {};
    for (const [k, v] of Object.entries(row ?? {})) {
      flat[k] = v !== null && typeof v === "object" ? JSON.stringify(v) : v;
    }
    flat._idx = idx;
    return flat;
  })
);

defineSlots<DslTestPageSlots>();

const rawText = computed(() => (resultData.value ? JSON.stringify(resultData.value, null, 2) : ""));

function setExecutionError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error || t("admin.executeFailed"));
  executeState.value = "error";
  resultData.value = {
    success: false,
    error: message,
    executedAt: new Date().toISOString(),
  };
  resultTab.value = "raw";
  ElMessage.error(t("admin.executeFailed"));
}

/* ------------------------------------------------------------------ */
/*  Execute                                                            */
/* ------------------------------------------------------------------ */

async function executeDsl() {
  let dslJson: any;
  try {
    const parsed = JSON.parse(dslText.value || "");
    dslJson = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (error) {
    setExecutionError(error instanceof Error ? error.message : t("diagnosis.dslJsonFormatError"));
    return;
  }
  if (!dslJson || typeof dslJson !== "object" || Array.isArray(dslJson)) {
    setExecutionError(t("diagnosis.jsonMustBeObject"));
    return;
  }

  executeState.value = "loading";
  resultData.value = null;
  try {
    const res = await diagnosisApi.executeDsl(dslJson);
    resultData.value = normalizeDslPayload(res) ?? null;
    resultTab.value = "table";
    if (!resultData.value) {
      setExecutionError(t("hotData.dslExecNoData"));
      return;
    }
    // Platform business exceptions are echoed in data as { error, dsl } (HTTP still 2xx).
    if (resultData.value?.error) {
      executeState.value = "error";
      resultTab.value = "raw";
      ElMessage.error(t("admin.executeFailed"));
    } else {
      executeState.value = "success";
      ElMessage.success(t("admin.executeSuccess"));
    }
  } catch (e: any) {
    setExecutionError(e?.message || t("admin.executeFailed"));
  }
}
</script>

<template>
  <div ref="splitContainer" class="dsl-test-page" :class="{ dragging: isDragging }">
    <!-- Left: DSL editor -->
    <section class="dsl-panel left" :style="{ width: leftPercent + '%' }">
      <div class="panel-header">
        <span class="panel-title">{{ t("nav.dslTest") }}</span>
        <span class="panel-subtitle">{{ t("dsl.executeDescription") }}</span>
        <span style="flex: 1" />
        <el-button
          type="primary"
          size="small"
          :loading="executeState === 'loading'"
          @click="executeDsl"
        >
          {{ t("dsl.executeDsl") }}
        </el-button>
      </div>

      <div class="dsl-editor-wrap">
        <CodeMirrorEditor v-model="dslText" language="json" :min-height="240" />
      </div>
    </section>

    <!-- Drag handle -->
    <div class="drag-handle" @mousedown="onDragStart" />

    <!-- Right: result -->
    <section class="dsl-panel right">
      <el-tabs v-model="resultTab" class="result-tabs">
        <el-tab-pane :label="t('dsl.dataTable')" name="table">
          <el-empty v-if="!tableData.length" :description="t('common.noData')" />
          <el-table v-else :data="tableData" border stripe height="100%" class="result-table">
            <el-table-column
              v-for="col in tableColumns"
              :key="col.prop"
              :prop="col.prop"
              :label="col.label"
              min-width="140"
              show-overflow-tooltip
            />
          </el-table>
        </el-tab-pane>

        <slot name="result-tabs" :payload="normalizeDslPayload(resultData)" :active-tab="resultTab" />

        <el-tab-pane :label="t('dsl.rawResponse')" name="raw">
          <template v-if="resultTab === 'raw'">
            <el-empty v-if="!rawText" :description="t('dsl.noResponse')" />
            <CodeMirrorEditor
              v-else
              :model-value="rawText"
              language="json"
              readonly
              :min-height="240"
            />
          </template>
        </el-tab-pane>
      </el-tabs>
    </section>
  </div>
</template>

<style scoped>
.dsl-test-page {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.dsl-test-page.dragging {
  cursor: col-resize;
  user-select: none;
}

/* ---- Panels ---- */
.dsl-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--observe-border, var(--el-border-color-light));
  border-radius: 8px;
  overflow: hidden;
  background: var(--observe-bg-card, #f6f8fa);
  margin: 4px;
}

html.dark .dsl-panel {
  background: var(--observe-bg-card, #1a1d23);
  border-color: var(--observe-border, #2d3139);
}

.dsl-panel.right {
  flex: 1;
}

/* ---- Header ---- */
.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--observe-bg-sidebar, #eef1f5);
  border-bottom: 1px solid var(--observe-border, var(--el-border-color-lighter));
  flex-shrink: 0;
}

html.dark .panel-header {
  background: var(--observe-bg-sidebar, #20242c);
  border-color: var(--observe-border, #2d3139);
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.panel-subtitle {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

/* ---- Editor ---- */
.dsl-editor-wrap {
  flex: 1;
  min-height: 0;
  padding: 8px;
  overflow: hidden;
  display: flex;
}

.dsl-editor-wrap :deep(.codemirror-editor) {
  flex: 1;
  min-height: 0;
}

/* ---- Drag handle ---- */
.drag-handle {
  width: 5px;
  cursor: col-resize;
  background: var(--el-border-color-lighter);
  flex-shrink: 0;
  transition: background 0.15s;
  margin: 4px 0;
}

.drag-handle:hover,
.dragging .drag-handle {
  background: var(--el-color-primary-light-5);
}

/* ---- Result ---- */
.result-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 12px 8px;
}

.result-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.result-tabs :deep(.el-tab-pane) {
  height: 100%;
}

.result-table {
  width: 100%;
}

.result-tabs :deep(.codemirror-editor) {
  height: 100%;
}
</style>
