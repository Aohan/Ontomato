<script setup lang="ts">
import { onMounted } from "vue";
import { Plus, Pencil, Trash2, Grid3x3, List } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { useCrudAdmin } from "../../composables/useCrudAdmin";
import { adminApi } from "../../api";
import type { Knowledge, KnowledgeManagerProps } from "./knowledge-manager";

const props = defineProps<KnowledgeManagerProps>();
const { t } = useI18n();

const {
  loading,
  list: knowledgeList,
  viewMode,
  setViewMode,
  multipleSelection,
  dialogVisible,
  editingEntity: editingKnowledge,
  load,
  openCreate,
  openEdit,
  handleSelectionChange,
  handleSave,
  handleDelete,
  handleBatchDelete,
} = useCrudAdmin<Knowledge>({
  list: adminApi.listKnowledge,
  add: adminApi.addKnowledge,
  edit: adminApi.editKnowledge,
  remove: adminApi.deleteKnowledge,
  idField: "knowledgeID",
  nameField: "knowledgeTitle",
  createEmpty: () => ({
    knowledgeID: "",
    knowledgeTitle: "",
    knowledgeText: "",
    knowledgeTags: [] as string[],
    creatorType: 0,
    status: 1,
  }),
  copyEntity: (source, target) => {
    target.knowledgeID = source.knowledgeID;
    target.knowledgeTitle = source.knowledgeTitle;
    target.knowledgeText = source.knowledgeText;
    target.knowledgeTags = source.knowledgeTags || [];
    target.status = source.status;
  },
  buildPayload: (e) => ({
    knowledgeID: e.knowledgeID,
    knowledgeTitle: e.knowledgeTitle,
    knowledgeText: e.knowledgeText,
    knowledgeTags: e.knowledgeTags,
    status: e.status,
  }),
  normalizeResponse: props.normalizeResponse,
  validateRequired: (e) => (!e.knowledgeTitle ? t("admin.knowledgeTitleRequired") : null),
  deleteConfirmKey: "admin.deleteKnowledgeConfirm",
  batchDeleteConfirmKey: "admin.batchDeleteKnowledgeConfirm",
  defaultViewMode: "card",
  viewModeStorageKey: "admin-knowledge-view-mode",
  batchDeleteFailureSuffix: props.batchDeleteFailureSuffix,
});

onMounted(() => {
  load();
});
</script>

<template>
  <div class="knowledge-manager">
    <div class="admin-toolbar">
      <el-button type="primary" :icon="Plus" @click="openCreate">
        {{ t("admin.addKnowledge") }}
      </el-button>
      <el-button :disabled="!multipleSelection.length" :icon="Trash2" @click="handleBatchDelete">
        {{ t("hotData.batchDelete") }}
      </el-button>
      <div class="toolbar-actions">
        <el-button-group>
          <el-button
            :type="viewMode === 'table' ? 'primary' : 'default'"
            :icon="List"
            size="small"
            @click="setViewMode('table')"
          >
            {{ t("common.table") }}
          </el-button>
          <el-button
            :type="viewMode === 'card' ? 'primary' : 'default'"
            :icon="Grid3x3"
            size="small"
            @click="setViewMode('card')"
          >
            {{ t("common.grid") }}
          </el-button>
        </el-button-group>
      </div>
    </div>

    <el-table
      v-if="viewMode === 'table' && (!showEmptyState || loading || knowledgeList.length > 0)"
      v-loading="loading"
      :data="knowledgeList"
      border
      stripe
      class="admin-table"
      style="width: 100%"
      @selection-change="handleSelectionChange"
    >
      <el-table-column type="selection" width="48" />
      <el-table-column prop="knowledgeTitle" :label="t('admin.knowledgeTitle')" min-width="200" />
      <el-table-column :label="t('admin.knowledgeContent')" min-width="250" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="table-text-preview">{{ row.knowledgeText }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('common.tags')" min-width="150">
        <template #default="{ row }">
          <el-space wrap>
            <el-tag
              v-for="tag in Array.isArray(row.knowledgeTags) ? row.knowledgeTags : []"
              :key="tag"
              size="small"
            >
              {{ tag }}
            </el-tag>
          </el-space>
        </template>
      </el-table-column>
      <el-table-column prop="status" :label="t('common.status')" width="100">
        <template #default="{ row }">
          <el-tag v-if="row.status === 1" type="success">{{ t("common.approved") }}</el-tag>
          <el-tag v-else type="info">{{ t("common.pendingReview") }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column
        :label="t('common.operation')"
        width="180"
        fixed="right"
        class-name="operation-cell"
      >
        <template #default="{ row }">
          <el-button type="primary" link size="small" :icon="Pencil" @click="openEdit(row)">
            {{ t("common.edit") }}
          </el-button>
          <el-button type="danger" link size="small" :icon="Trash2" @click="handleDelete(row)">
            {{ t("common.delete") }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div
      v-if="viewMode === 'card' && (!showEmptyState || loading || knowledgeList.length > 0)"
      v-loading="loading"
      class="admin-card-grid"
    >
      <el-card
        v-for="item in knowledgeList"
        :key="item.knowledgeID"
        class="crud-card knowledge-card"
        shadow="hover"
      >
        <template #header>
          <div class="card-header">
            <span class="card-title">{{ item.knowledgeTitle }}</span>
            <el-tag v-if="item.status === 1" type="success" size="small">
              {{ t("common.approved") }}
            </el-tag>
            <el-tag v-else type="info" size="small">{{ t("common.pendingReview") }}</el-tag>
          </div>
        </template>
        <div class="card-body">
          <div class="card-text">{{ item.knowledgeText }}</div>
          <div class="card-tags">
            <el-tag
              v-for="tag in Array.isArray(item.knowledgeTags) ? item.knowledgeTags : []"
              :key="tag"
              size="small"
            >
              {{ tag }}
            </el-tag>
          </div>
        </div>
        <div class="card-footer">
          <el-button type="primary" link size="small" :icon="Pencil" @click="openEdit(item)">
            {{ t("common.edit") }}
          </el-button>
          <el-button type="danger" link size="small" :icon="Trash2" @click="handleDelete(item)">
            {{ t("common.delete") }}
          </el-button>
        </div>
      </el-card>
    </div>
    <el-empty
      v-if="showEmptyState && !loading && knowledgeList.length === 0"
      class="knowledge-empty"
      :description="t('common.noData')"
    />

    <el-dialog
      v-model="dialogVisible"
      :title="t('admin.editKnowledge')"
      width="650px"
      destroy-on-close
    >
      <el-form :model="editingKnowledge" label-width="140px">
        <el-form-item :label="t('admin.knowledgeTitle')">
          <el-input
            v-model="editingKnowledge.knowledgeTitle"
            :placeholder="t('admin.knowledgeTitlePlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="t('admin.knowledgeContent')">
          <el-input
            v-model="editingKnowledge.knowledgeText"
            type="textarea"
            :rows="8"
            :placeholder="t('admin.knowledgeContentPlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="t('admin.objectClassTags')">
          <el-select
            v-model="editingKnowledge.knowledgeTags"
            multiple
            filterable
            allow-create
            :placeholder="t('admin.selectOrEnterTags')"
            class="admin-table"
            style="width: 100%"
            popper-class="admin-select-popper"
          >
            <el-option :label="t('knowledge.general')" :value="tagValues.general" />
            <el-option :label="t('knowledge.business')" :value="tagValues.business" />
            <el-option :label="t('knowledge.tech')" :value="tagValues.tech" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('common.status')">
          <el-radio-group v-model="editingKnowledge.status">
            <el-radio :value="0">{{ t("common.pendingReview") }}</el-radio>
            <el-radio :value="1">{{ t("common.approved") }}</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ t("common.cancel") }}</el-button>
        <el-button type="primary" @click="handleSave">{{ t("common.save") }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.knowledge-manager {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.table-text-preview {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.knowledge-card {
  display: flex;
  flex-direction: column;
  min-height: 180px;
  background: var(--el-bg-color) !important;
  border: 1px solid var(--el-border-color) !important;
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.knowledge-card :deep(.el-card__header) {
  padding: 12px 16px;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.knowledge-card :deep(.el-card__body) {
  padding: 0;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 132px;
}

.knowledge-card .card-body {
  padding: 14px 16px 12px;
  flex: 1;
  overflow: hidden;
}

.knowledge-card .card-text {
  min-height: 72px;
  max-height: 220px;
  overflow-y: auto;
}

.knowledge-card .card-footer {
  flex-shrink: 0;
}

.knowledge-empty {
  flex: 1;
}
</style>
