<script setup lang="ts">
import type {
  FeedbackRecord,
  FeedbackRating,
  FeedbackSourceType,
} from "@ontomato/contracts/feedback";

import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { Download, RefreshCw, Search } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { feedbackApi } from "../../../../api/feedback";
import { workbenchContent } from "../../../../content";

const { t } = useI18n();
// Fixed text on this page comes from the app-supplied edition sentences (independent of the UI locale); like/dislike share the answer-feedback sentences.
const { feedbackRecords: copy, feedback } = workbenchContent().text;

const loading = ref(false);
const exporting = ref(false);
const records = ref<FeedbackRecord[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const detailVisible = ref(false);
const currentRecord = ref<FeedbackRecord | null>(null);

const filters = reactive<{
  sourceType: FeedbackSourceType | "";
  rating: FeedbackRating | "";
  keyword: string;
}>({
  sourceType: "",
  rating: "",
  keyword: "",
});

const sourceOptions = [
  { label: copy.sourceQa, value: "qa" },
  { label: copy.sourceAnalysisTask, value: "analysis_task" },
] as const;

const ratingOptions = [
  { label: feedback.like, value: "like" },
  { label: feedback.dislike, value: "dislike" },
] as const;

const detailRows = computed(() => {
  const record = currentRecord.value;
  if (!record) return [];
  return [
    { label: copy.user, value: record.userName || record.userId },
    { label: copy.source, value: sourceLabel(record.sourceType) },
    { label: copy.rating, value: ratingLabel(record.rating) },
    { label: "Turn Key", value: getTurnKey(record) },
    { label: copy.feedback, value: record.feedbackText || "-" },
    { label: copy.input, value: record.userInput || "-" },
    { label: copy.output, value: record.assistantOutput || "-" },
    { label: copy.relatedId, value: record.taskId || record.threadId || record.targetId },
  ];
});

function sourceLabel(value: FeedbackSourceType) {
  return value === "analysis_task" ? copy.sourceAnalysisTask : copy.sourceQa;
}

function ratingLabel(value: FeedbackRating) {
  return value === "like" ? feedback.like : feedback.dislike;
}

function getTurnKey(record: FeedbackRecord) {
  const metadata = record.metadata as { turnKey?: unknown } | null | undefined;
  const metadataTurnKey = typeof metadata?.turnKey === "string" ? metadata.turnKey.trim() : "";
  if (metadataTurnKey) return metadataTurnKey;
  if (record.targetId?.startsWith("turn.")) return record.targetId;
  if (record.threadId && Number.isInteger(record.requestSeq)) {
    return `turn.${record.threadId}.${record.requestSeq}`;
  }
  return "-";
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString();
}

function preview(text?: string) {
  const value = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  return value.length > 80 ? `${value.slice(0, 80)}...` : value || "-";
}

function csvCell(value: unknown) {
  const text = String(value ?? "").replace(/\r?\n/g, "\n");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(rows: FeedbackRecord[]) {
  const headers = [
    copy.time,
    copy.source,
    copy.rating,
    copy.user,
    "Turn Key",
    copy.input,
    copy.output,
    copy.feedback,
  ];
  const lines = rows.map((row) =>
    [
      formatTime(row.createdAt),
      sourceLabel(row.sourceType),
      ratingLabel(row.rating),
      row.userName || row.userId,
      getTurnKey(row),
      row.userInput || "",
      row.assistantOutput || "",
      row.feedbackText || "",
    ]
      .map(csvCell)
      .join(",")
  );
  const csv = [headers.map(csvCell).join(","), ...lines].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `feedback_records_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function loadRecords() {
  loading.value = true;
  try {
    const data = await feedbackApi.list({
      sourceType: filters.sourceType,
      rating: filters.rating,
      keyword: filters.keyword.trim(),
      limit: pageSize.value,
      offset: (page.value - 1) * pageSize.value,
    });
    records.value = data.records;
    total.value = data.total;
  } catch (error: any) {
    ElMessage.error(error?.message || copy.loadFailed);
    records.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

async function exportRecords() {
  exporting.value = true;
  try {
    const limit = 500;
    let offset = 0;
    let totalRows = Infinity;
    const rows: FeedbackRecord[] = [];

    while (offset < totalRows) {
      const data = await feedbackApi.list({
        sourceType: filters.sourceType,
        rating: filters.rating,
        keyword: filters.keyword.trim(),
        limit,
        offset,
      });
      rows.push(...data.records);
      totalRows = data.total;
      if (!data.records.length) break;
      offset += data.records.length;
    }

    if (!rows.length) {
      ElMessage.warning(copy.exportEmpty);
      return;
    }

    downloadCsv(rows);
    ElMessage.success(copy.exportSucceeded);
  } catch (error: any) {
    ElMessage.error(error?.message || copy.exportFailed);
  } finally {
    exporting.value = false;
  }
}

function search() {
  page.value = 1;
  loadRecords();
}

function showDetail(record: FeedbackRecord) {
  currentRecord.value = record;
  detailVisible.value = true;
}

function handlePageChange(value: number) {
  page.value = value;
  loadRecords();
}

onMounted(loadRecords);
</script>

<template>
  <div class="feedback-records-page">
    <div class="toolbar">
      <el-select v-model="filters.sourceType" clearable :placeholder="copy.source" style="width: 140px">
        <el-option
          v-for="item in sourceOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      <el-select v-model="filters.rating" clearable :placeholder="copy.rating" style="width: 120px">
        <el-option
          v-for="item in ratingOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      <el-input
        v-model="filters.keyword"
        clearable
        :placeholder="copy.searchPlaceholder"
        style="width: 280px"
        @keyup.enter="search"
      />
      <el-button type="primary" :icon="Search" @click="search">{{ t("common.query") }}</el-button>
      <el-button :icon="RefreshCw" @click="loadRecords">{{ t("common.refresh") }}</el-button>
      <el-button :icon="Download" :loading="exporting" @click="exportRecords">
        {{ t("common.export") }}
      </el-button>
    </div>

    <el-table v-loading="loading" :data="records" border stripe class="admin-table">
      <el-table-column :label="copy.time" width="180">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column :label="copy.source" width="110">
        <template #default="{ row }">
          <el-tag>{{ sourceLabel(row.sourceType) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="copy.rating" width="90">
        <template #default="{ row }">
          <el-tag :type="row.rating === 'like' ? 'success' : 'danger'">
            {{ ratingLabel(row.rating) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="copy.user" width="150" show-overflow-tooltip>
        <template #default="{ row }">{{ row.userName || row.userId }}</template>
      </el-table-column>
      <el-table-column label="Turn Key" min-width="180" show-overflow-tooltip>
        <template #default="{ row }">{{ getTurnKey(row) }}</template>
      </el-table-column>
      <el-table-column :label="copy.input" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">{{ preview(row.userInput) }}</template>
      </el-table-column>
      <el-table-column :label="copy.output" min-width="260" show-overflow-tooltip>
        <template #default="{ row }">{{ preview(row.assistantOutput) }}</template>
      </el-table-column>
      <el-table-column :label="copy.feedback" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">{{ preview(row.feedbackText) }}</template>
      </el-table-column>
      <el-table-column :label="copy.actions" width="100" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link size="small" @click="showDetail(row)">{{
            copy.details
          }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination">
      <el-pagination
        background
        layout="prev, pager, next, jumper, ->, total"
        :total="total"
        :page-size="pageSize"
        :current-page="page"
        @current-change="handlePageChange"
      />
    </div>

    <el-dialog v-model="detailVisible" :title="copy.detailTitle" width="760px">
      <div class="feedback-detail">
        <div v-for="item in detailRows" :key="item.label" class="detail-row">
          <div class="detail-label">{{ item.label }}</div>
          <pre class="detail-value">{{ item.value }}</pre>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.feedback-records-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
}

.admin-table {
  flex: 1;
}

.pagination {
  margin-top: var(--spacing-lg);
  display: flex;
  justify-content: flex-end;
}

.feedback-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-row {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 12px;
}

.detail-label {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding-top: 8px;
}

.detail-value {
  margin: 0;
  max-height: 260px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-primary);
  font-family: inherit;
  line-height: 1.6;
}

@media (max-width: 1024px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar .el-input,
  .toolbar .el-select {
    width: 100%;
  }
}
</style>
