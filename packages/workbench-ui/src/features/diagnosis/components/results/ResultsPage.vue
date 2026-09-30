<script setup lang="ts">
import type {
  RunCaseResult as CaseResult,
  RetainedRunMeta as RunMeta,
} from "@ontomato/contracts/autotest";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { diagnosisApi } from "../../api";
import { authHost } from "../../../../utils/auth";
import { formatAutotestAccuracyRate, summarizeAutotestVerdicts } from "../../utils/autotest-result";
import RunResultsHeader from "./RunResultsHeader.vue";
import RunResultsTable from "./RunResultsTable.vue";

import { useI18n } from "vue-i18n";

const { t } = useI18n();

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

const props = defineProps<{
  runId: string;
  kept?: boolean;
  retentionLoading?: boolean;
}>();

const emit = defineEmits<{
  deleted: [runId: string];
  settled: [runId: string];
  "toggle-retention": [];
}>();

/* ------------------------------------------------------------------ */
/*  API                                                                */
/* ------------------------------------------------------------------ */

const RUN_REFRESH_INTERVAL_MS = 2000;

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

const router = useRouter();

const runDetail = ref<RunMeta | null>(null);
const caseResults = ref<CaseResult[]>([]);
const detailLoading = ref(false);
const settledNotifiedRunId = ref<string | null>(null);
let refreshTimer: number | null = null;

const summary = computed(() => {
  const all = caseResults.value;
  if (all.length === 0) return null;
  const verdictSummary = summarizeAutotestVerdicts(all);
  const durations = all.map((r) => r.durationMs || 0).filter((d) => d > 0);
  const avgMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  return {
    ...verdictSummary,
    accuracyRate: formatAutotestAccuracyRate(verdictSummary),
    avgMs,
  };
});

const deleteDisabled = computed(() => {
  return runDetail.value?.status === "running" || runDetail.value?.status === "stopping";
});

/* ------------------------------------------------------------------ */
/*  Run detail loading                                                 */
/* ------------------------------------------------------------------ */

function isRunActive(status?: string) {
  return status === "running" || status === "stopping";
}

function clearRefreshTimer() {
  if (refreshTimer != null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function scheduleRefresh(id: string) {
  clearRefreshTimer();
  if (!isRunActive(runDetail.value?.status)) return;
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    loadRunDetail(id, { silent: true });
  }, RUN_REFRESH_INTERVAL_MS);
}

function notifySettledOnce(id: string, status?: string) {
  if (!status || isRunActive(status) || settledNotifiedRunId.value === id) return;
  settledNotifiedRunId.value = id;
  emit("settled", id);
}

async function loadRunDetail(id: string, options: { silent?: boolean } = {}) {
  if (!options.silent) {
    detailLoading.value = true;
  }
  try {
    const [metaRes, resultsRes] = await Promise.all([
      diagnosisApi.getRun(id),
      diagnosisApi.getRunResults(id),
    ]);
    runDetail.value = metaRes.data || null;
    caseResults.value = resultsRes.data?.results || [];
    notifySettledOnce(id, runDetail.value?.status);
  } catch {
    runDetail.value = null;
    caseResults.value = [];
  } finally {
    if (!options.silent) {
      detailLoading.value = false;
    }
    if (props.runId === id) {
      scheduleRefresh(id);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Delete run                                                         */
/* ------------------------------------------------------------------ */

async function deleteRun() {
  if (!props.runId) return;
  if (deleteDisabled.value) {
    ElMessage.warning(t("diagnosis.testBatchRunningPleaseStop"));
    return;
  }

  try {
    await ElMessageBox.confirm(
      t("diagnosis.deleteBatchConfirm", { id: props.runId }),
      t("common.deleteConfirm"),
      {
        type: "warning",
        confirmButtonText: t("common.delete"),
        cancelButtonText: t("common.cancel"),
        confirmButtonClass: "el-button--danger",
      }
    );
    await diagnosisApi.deleteRun(props.runId);
    emit("deleted", props.runId);
    ElMessage.success(t("admin.deletedSuccess"));
  } catch (e: any) {
    if (e !== "cancel" && e !== "close" && e?.message !== "cancel") {
      ElMessage.error(e?.message || t("admin.deleteFailed"));
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Navigation                                                         */
/* ------------------------------------------------------------------ */

function goToCaseDetail(row: CaseResult) {
  if (!row.caseId || !props.runId) return;
  router.push({
    path: `/observe/autotest/runs/${encodeURIComponent(props.runId)}/cases/${encodeURIComponent(row.caseId)}`,
  });
}

/* ------------------------------------------------------------------ */
/*  Download                                                           */
/* ------------------------------------------------------------------ */

function downloadResults() {
  if (!props.runId) return;
  window.open(diagnosisApi.downloadRunUrl(props.runId, authHost().getToken() || ""), "_blank");
}

/* ------------------------------------------------------------------ */
/*  Watchers                                                           */
/* ------------------------------------------------------------------ */

watch(
  () => props.runId,
  (id) => {
    clearRefreshTimer();
    settledNotifiedRunId.value = null;
    if (id) loadRunDetail(id);
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  clearRefreshTimer();
});
</script>

<template>
  <div v-loading="detailLoading" class="results-page">
    <template v-if="runDetail">
      <RunResultsHeader
        :run-id="props.runId"
        :run-detail="runDetail"
        :summary="summary"
        :kept="kept"
        :retention-loading="retentionLoading"
        :delete-disabled="deleteDisabled"
        @toggle-retention="emit('toggle-retention')"
        @download-results="downloadResults"
        @delete-run="deleteRun"
      />
      <RunResultsTable :results="caseResults" @row-click="goToCaseDetail" />
    </template>

    <el-empty
      v-else-if="!detailLoading"
      :description="t('common.loading')"
      :image-size="60"
      style="margin-top: 100px"
    />
  </div>
</template>

<style scoped>
.results-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--observe-bg-main, var(--el-bg-color));
  border-radius: 8px;
}
</style>
