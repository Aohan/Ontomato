<script setup lang="ts">
/**
 * The name, row count, and actions of one result dataset: data/DSL download, the dashboard entry,
 * and the on-demand-expanded DSL view, post-calculation program, and field lineage details.
 *
 * Download and detail dialogs belong to this component itself; both the standalone body card and
 * the shared execution view that use it get the full set of actions, and the caller only needs to
 * provide the dataset and forward the dashboard event. Details that have no output do not render
 * buttons, and the expanded state is the component's internal display state.
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileJson,
  FileText,
  LayoutDashboard,
  List,
} from "lucide-vue-next";
import ResultDetailDialogs from "./ResultDetailDialogs.vue";
import { downloadCsvFromData, downloadDsl } from "../../utils/downloadUtils";
import type { ResultDataset, ResultDetailRequest } from "./types";

const props = defineProps<{
  dataset: ResultDataset;
  showDashboardAction: boolean;
}>();

const emit = defineEmits<{ addToDashboard: [] }>();

const { t } = useI18n();

const expanded = ref(false);
const detailRequest = ref<ResultDetailRequest | null>(null);

const hasRows = computed(() => props.dataset.rows.length > 0);
const hasDetails = computed(
  () => !!props.dataset.dsl || !!props.dataset.code || (props.dataset.outKeyRefs?.length || 0) > 0
);

function sanitizeFilename(name: string) {
  const clean = String(name || "")
    .replace(/[\r\n]/g, " ")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .slice(0, 60);
  return clean || "data";
}

function downloadData() {
  downloadCsvFromData(
    props.dataset.rows,
    sanitizeFilename(props.dataset.subQuestion || props.dataset.title)
  );
}

function downloadDatasetDsl() {
  downloadDsl(
    props.dataset.dsl,
    sanitizeFilename(props.dataset.subQuestion || props.dataset.title)
  );
}

function openDetail(kind: ResultDetailRequest["kind"]) {
  detailRequest.value = {
    kind,
    title: props.dataset.title,
    dsl: props.dataset.dsl,
    code: props.dataset.code,
    outKeyRefs: props.dataset.outKeyRefs,
  };
}
</script>

<template>
  <div class="result-dataset">
    <div class="result-dataset-head">
      <span class="result-dataset-title">{{ dataset.title }}</span>
      <span class="result-dataset-count">
        {{ t("analysis.rowCountHint", { n: dataset.rows.length }) }}
      </span>
    </div>
    <div class="result-dataset-buttons">
      <button
        v-if="hasRows"
        type="button"
        class="ui-btn ui-btn-secondary result-dataset-btn"
        @click="downloadData"
      >
        <Download :size="14" />
        <span>{{ t("chat.downloadData") }}</span>
      </button>
      <button
        v-if="hasRows && dataset.dsl"
        type="button"
        class="ui-btn ui-btn-secondary result-dataset-btn"
        @click="downloadDatasetDsl"
      >
        <FileJson :size="14" />
        <span>{{ t("chat.downloadDsl") }}</span>
      </button>
      <button
        v-if="hasRows && showDashboardAction"
        type="button"
        class="ui-btn ui-btn-secondary result-dataset-btn"
        @click="emit('addToDashboard')"
      >
        <LayoutDashboard :size="14" />
        <span>{{ t("chat.addToDashboard") }}</span>
      </button>
      <button
        v-if="hasDetails"
        type="button"
        class="ui-btn ui-btn-secondary result-dataset-btn"
        @click="expanded = !expanded"
      >
        <component :is="expanded ? ChevronDown : ChevronRight" :size="14" />
        <span>{{ expanded ? t("common.collapse") : t("common.detail") }}</span>
      </button>
    </div>
    <div v-if="expanded && hasDetails" class="result-dataset-details">
      <button
        v-if="dataset.dsl"
        type="button"
        class="ui-btn ui-btn-secondary result-dataset-btn"
        @click="openDetail('dsl')"
      >
        <FileText :size="14" />
        <span>{{ t("common.viewDsl") }}</span>
      </button>
      <button
        v-if="dataset.code"
        type="button"
        class="ui-btn ui-btn-secondary result-dataset-btn"
        @click="openDetail('code')"
      >
        <Copy :size="14" />
        <span>{{ t("common.code") }}</span>
      </button>
      <button
        v-if="(dataset.outKeyRefs?.length || 0) > 0"
        type="button"
        class="ui-btn ui-btn-secondary result-dataset-btn"
        @click="openDetail('lineage')"
      >
        <List :size="14" />
        <span>{{ t("common.lineage") }}</span>
      </button>
    </div>

    <ResultDetailDialogs :request="detailRequest" @close="detailRequest = null" />
  </div>
</template>

<style scoped>
.result-dataset {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-lg);
  background: var(--el-fill-color-extra-light);
  border: 1px solid var(--el-border-color-lighter);
}
.result-dataset-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
}
.result-dataset-title {
  color: var(--el-text-color-primary);
  font-weight: 600;
  word-break: break-word;
}
.result-dataset-count {
  color: var(--el-text-color-secondary);
}
.result-dataset-buttons,
.result-dataset-details {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.result-dataset-details {
  padding-top: 8px;
  border-top: 1px dashed var(--el-border-color-lighter);
}
.result-dataset-btn {
  font-size: 12px;
}
</style>
