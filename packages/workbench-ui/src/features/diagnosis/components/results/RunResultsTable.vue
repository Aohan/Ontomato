<script setup lang="ts">
import type { RunCaseResult as CaseResult } from "@ontomato/contracts/autotest";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  getAutotestVerdict,
  getAutotestVerdictLabel,
  getAutotestVerdictReason,
  getAutotestVerdictTagType,
  type AutotestVerdict,
} from "../../utils/autotest-result";
import {
  formatDuration,
  getExecutionStatusLabel,
  getExecutionStatusTagType,
} from "../../utils/autotest-display";

const props = defineProps<{
  results: CaseResult[];
}>();

const emit = defineEmits<{
  "row-click": [row: CaseResult];
}>();

const { t } = useI18n();

const statusFilter = ref<"all" | AutotestVerdict>("all");

const filteredResults = computed(() => {
  if (statusFilter.value === "all") return props.results;
  return props.results.filter((result) => getAutotestVerdict(result) === statusFilter.value);
});

function resultVerdictLabel(row: CaseResult): string {
  return getAutotestVerdictLabel(getAutotestVerdict(row));
}

function resultVerdictTagType(row: CaseResult) {
  return getAutotestVerdictTagType(getAutotestVerdict(row));
}

function resultReason(row: CaseResult): string {
  return getAutotestVerdictReason(row) || "-";
}

function resultRowClassName({ row }: { row: CaseResult }): string {
  const verdict = getAutotestVerdict(row);
  if (verdict === "wrong") return "row-wrong";
  if (verdict === "abnormal") return "row-abnormal";
  return "";
}
</script>

<template>
  <div class="run-results-table">
    <div class="filter-bar">
      <el-radio-group v-model="statusFilter" size="small">
        <el-radio-button value="all">{{ t("common.all") }}</el-radio-button>
        <el-radio-button value="correct">{{ t("autotest.correct") }}</el-radio-button>
        <el-radio-button value="wrong">{{ t("autotest.wrong") }}</el-radio-button>
        <el-radio-button value="abnormal">{{ t("autotest.abnormal") }}</el-radio-button>
      </el-radio-group>
    </div>

    <div class="table-area">
      <el-table
        :data="filteredResults"
        stripe
        size="small"
        style="width: 100%"
        :row-class-name="resultRowClassName"
        class="clickable-table"
        @row-click="(row: CaseResult) => emit('row-click', row)"
      >
        <el-table-column prop="caseId" :label="t('hotData.caseId')" width="100" />
        <el-table-column
          prop="question"
          :label="t('hotData.question')"
          min-width="240"
          show-overflow-tooltip
        />
        <el-table-column prop="status" :label="t('autotest.executionStatus')" width="112">
          <template #default="{ row }">
            <el-tag :type="getExecutionStatusTagType(row.status)" size="small" effect="plain">
              {{ getExecutionStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('autotest.evalConclusion')" width="100">
          <template #default="{ row }">
            <el-tag :type="resultVerdictTagType(row)" size="small">
              {{ resultVerdictLabel(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('autotest.errorReason')" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="result-reason">{{ resultReason(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.duration')" width="90">
          <template #default="{ row }">
            {{ formatDuration(row.durationMs) }}
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.run-results-table {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.filter-bar {
  padding: 8px 16px;
  flex-shrink: 0;
}

.table-area {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 16px;
  min-height: 0;
}

:deep(.row-wrong) {
  background-color: var(--el-color-danger-light-9) !important;
}

:deep(.row-abnormal) {
  background-color: var(--el-color-warning-light-9) !important;
}

.result-reason {
  color: var(--el-text-color-secondary);
}

:deep(.clickable-table .el-table__body tr) {
  cursor: pointer;
}

:deep(.clickable-table .el-table__body tr:hover > td) {
  background-color: var(--el-color-primary-light-9) !important;
}
</style>
