<script setup lang="ts">
import type { AnalysisReportCardSummary } from "@ontomato/contracts/analysis-report";
import { ref, reactive, onMounted, computed } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Eye, Pencil, RefreshCw, Trash2 } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { analysisReportApi } from "../../../analysis/api";
import ReportPreviewDialog from "./ReportPreviewDialog.vue";

type ReportStatus = AnalysisReportCardSummary["status"];

const { t } = useI18n();

const loading = ref(false);
const reportCards = ref<AnalysisReportCardSummary[]>([]);
const keyword = ref("");
const statusFilter = ref<ReportStatus>();

const previewVisible = ref(false);
const previewLoading = ref(false);
const previewTitle = ref("");
const previewContent = ref("");

const editVisible = ref(false);
const editSaving = ref(false);
const editForm = reactive({
  id: "",
  question: "",
  status: "PENDING_REVIEW" as ReportStatus,
  businessDescription: "",
});

const STATUS_TEXT: Record<ReportStatus, string> = {
  PENDING_REVIEW: t("common.pendingReview"),
  PUBLISHED: t("common.published"),
  UNUSED: t("common.disabled"),
};

const STATUS_TAG_TYPE: Record<ReportStatus, "warning" | "success" | "danger"> = {
  PENDING_REVIEW: "warning",
  PUBLISHED: "success",
  UNUSED: "danger",
};

function statusText(status: ReportStatus) {
  return STATUS_TEXT[status];
}

function statusTagType(status: ReportStatus) {
  return STATUS_TAG_TYPE[status];
}

function formatTime(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function fetchReportCards() {
  loading.value = true;
  try {
    const res = await analysisReportApi.listCards(
      statusFilter.value ? `?status=${statusFilter.value}` : ""
    );
    reportCards.value = res.data;
  } catch {
    reportCards.value = [];
    ElMessage.error(t("admin.getReportFail"));
  } finally {
    loading.value = false;
  }
}

const filteredReportCards = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return reportCards.value;
  return reportCards.value.filter((card) =>
    [card.id, card.question, card.businessDescription, card.agentName]
      .join(" ")
      .toLowerCase()
      .includes(kw)
  );
});

function resetFilters() {
  keyword.value = "";
  statusFilter.value = undefined;
  fetchReportCards();
}

async function openPreview(card: AnalysisReportCardSummary) {
  previewVisible.value = true;
  previewTitle.value = card.question;
  previewContent.value = "";
  previewLoading.value = true;
  try {
    const res = await analysisReportApi.getCard(card.id);
    previewContent.value = res.data.reportContent.trim() || t("common.emptyContent");
  } catch {
    ElMessage.error(t("admin.getReportContentFail"));
    previewContent.value = t("common.loadFailed");
  } finally {
    previewLoading.value = false;
  }
}

function openEdit(card: AnalysisReportCardSummary) {
  editForm.id = card.id;
  editForm.question = card.question;
  editForm.status = card.status;
  editForm.businessDescription = card.businessDescription;
  editVisible.value = true;
}

async function saveEdit() {
  editSaving.value = true;
  try {
    await analysisReportApi.updateCardStatus(editForm.id, editForm.status);
    await analysisReportApi.updateCardBusinessDescription(
      editForm.id,
      editForm.businessDescription
    );
    ElMessage.success(t("admin.saveSuccess"));
    editVisible.value = false;
    fetchReportCards();
  } catch {
    ElMessage.error(t("admin.saveFailed"));
  } finally {
    editSaving.value = false;
  }
}

async function deleteReport(card: AnalysisReportCardSummary) {
  try {
    await ElMessageBox.confirm(t("report.deleteConfirm"), t("common.tip"), { type: "warning" });
    await analysisReportApi.deleteCard(card.id);
    ElMessage.success(t("admin.deletedSuccess"));
    fetchReportCards();
  } catch (e) {
    if (e !== "cancel") ElMessage.error(t("admin.deleteFailed"));
  }
}

onMounted(fetchReportCards);
</script>

<template>
  <div>
    <div class="toolbar">
      <el-input
        v-model="keyword"
        :placeholder="t('common.filterKeyword')"
        clearable
        style="width: 300px"
      />
      <el-select
        v-model="statusFilter"
        clearable
        :placeholder="t('common.filterByStatus')"
        style="width: 160px"
        @change="fetchReportCards"
      >
        <el-option :label="t('common.pendingReview')" value="PENDING_REVIEW" />
        <el-option :label="t('common.published')" value="PUBLISHED" />
      </el-select>
      <el-button @click="resetFilters">{{ t("common.reset") }}</el-button>
      <el-button :icon="RefreshCw" @click="fetchReportCards">{{ t("common.refresh") }}</el-button>
    </div>

    <el-table
      v-loading="loading"
      :data="filteredReportCards"
      border
      stripe
      class="admin-table"
      style="width: 100%"
    >
      <el-table-column :label="t('common.title')" min-width="200">
        <template #default="{ row }">{{ row.question }}</template>
      </el-table-column>
      <el-table-column :label="t('common.status')" width="100">
        <template #default="{ row }">
          <el-tag :type="statusTagType(row.status)" size="small">
            {{ statusText(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('hotData.analysisAgent')" min-width="150">
        <template #default="{ row }">
          <el-tag type="info" size="small" class="agent-chip">{{ row.agentName }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('common.dimensions')" min-width="150">
        <template #default="{ row }">
          <template v-if="row.dimensions.length">
            <el-tag
              v-for="(d, i) in row.dimensions"
              :key="i"
              type="info"
              size="small"
              class="dim-chip"
            >
              {{ d }}
            </el-tag>
          </template>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('hotData.questionCount')" width="100">
        <template #default="{ row }">{{ row.questionTotal || "-" }}</template>
      </el-table-column>
      <el-table-column :label="t('common.createTime')" width="160">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column :label="t('hotData.businessDesc')" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">{{ row.businessDescription || "-" }}</template>
      </el-table-column>
      <el-table-column
        :label="t('common.operation')"
        width="180"
        fixed="right"
        class-name="operation-cell"
      >
        <template #default="{ row }">
          <el-button type="primary" link size="small" :icon="Eye" @click="openPreview(row)">
            {{ t("common.preview") }}
          </el-button>
          <el-button type="primary" link size="small" :icon="Pencil" @click="openEdit(row)">
            {{ t("common.edit") }}
          </el-button>
          <el-button type="danger" link size="small" :icon="Trash2" @click="deleteReport(row)">
            {{ t("common.delete") }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="editVisible" :title="t('report.editReport')" width="560px" destroy-on-close>
      <el-form :model="editForm" label-width="130px">
        <el-form-item :label="t('hotData.originQuestion')">
          <div class="origin-question">{{ editForm.question }}</div>
        </el-form-item>
        <el-form-item :label="t('common.status')">
          <el-select v-model="editForm.status" style="width: 200px">
            <el-option :label="t('common.pendingReview')" value="PENDING_REVIEW" />
            <el-option :label="t('common.published')" value="PUBLISHED" />
            <el-option :label="t('common.disabled')" value="UNUSED" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('hotData.businessDesc')">
          <el-input
            v-model="editForm.businessDescription"
            type="textarea"
            :rows="4"
            :placeholder="t('common.enterBizContext')"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">{{ t("common.cancel") }}</el-button>
        <el-button type="primary" :loading="editSaving" @click="saveEdit">
          {{ t("common.save") }}
        </el-button>
      </template>
    </el-dialog>

    <ReportPreviewDialog
      v-model:visible="previewVisible"
      :loading="previewLoading"
      :title="previewTitle"
      :content="previewContent"
    />
  </div>
</template>

<style scoped>
.dim-chip {
  margin-right: var(--spacing-xs);
}

.agent-chip {
  max-width: 140px;
}

.agent-chip :deep(.el-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Align with the first line of form labels at a 32px line height */
.origin-question {
  padding: 5px 0;
  line-height: 22px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--el-text-color-regular);
}
</style>
