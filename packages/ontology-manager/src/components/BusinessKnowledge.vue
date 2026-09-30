<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElOption,
  ElRadio,
  ElRadioGroup,
  ElSelect,
  ElTable,
  ElTableColumn,
  ElTag,
  vLoading,
} from "element-plus";
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-vue-next";
import type { BusinessKnowledge } from "../api";
import { useManagerClient, useManagerContext, useOntologyText, useSharedText } from "../context";
import { useManagerFeedback } from "../feedback";

const context = useManagerContext();
const client = useManagerClient();
const { ot } = useOntologyText();
const { t } = useSharedText();
const { message, confirm } = useManagerFeedback();

const loading = ref(false);
const saving = ref(false);
const list = ref<BusinessKnowledge[]>([]);
const selection = ref<BusinessKnowledge[]>([]);

const dialogVisible = ref(false);
const editing = reactive<BusinessKnowledge>(emptyKnowledge());
const dialogTitle = computed(() => ot(editing.knowledgeID ? "knowledgeEdit" : "knowledgeAdd"));

// Offers this edition's three stored tag values (labels come from Manager messages) and also accepts custom tags, as the page did before migration.
const tagOptions = computed(() => [
  { value: context.knowledgeTagValues.general, label: ot("knowledgeTagGeneral") },
  { value: context.knowledgeTagValues.business, label: ot("knowledgeTagBusiness") },
  { value: context.knowledgeTagValues.tech, label: ot("knowledgeTagTech") },
]);

function emptyKnowledge(): BusinessKnowledge {
  return { knowledgeID: "", knowledgeTitle: "", knowledgeText: "", knowledgeTags: [], status: 1 };
}

async function load() {
  loading.value = true;
  try {
    list.value = await client.listKnowledge();
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("knowledgeLoadFailed"));
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  Object.assign(editing, emptyKnowledge());
  dialogVisible.value = true;
}

function openEdit(row: BusinessKnowledge) {
  Object.assign(editing, { ...row, knowledgeTags: [...row.knowledgeTags] });
  dialogVisible.value = true;
}

async function save() {
  if (!editing.knowledgeTitle.trim()) {
    message.warning(ot("knowledgeTitleRequired"));
    return;
  }
  saving.value = true;
  try {
    await client.saveKnowledge({ ...editing });
    message.success(ot("knowledgeSaved"));
    dialogVisible.value = false;
    await load();
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("knowledgeSaveFailed"));
  } finally {
    saving.value = false;
  }
}

async function remove(row: BusinessKnowledge) {
  try {
    await confirm(ot("knowledgeDeleteConfirm", { name: row.knowledgeTitle }), ot("deleteConfirmTitle"));
    await client.deleteKnowledge(row.knowledgeID);
    message.success(ot("knowledgeDeleted"));
    await load();
  } catch (error) {
    if (error !== "cancel")
      message.error(error instanceof Error ? error.message : ot("knowledgeDeleteFailed"));
  }
}

async function removeSelected() {
  const targets = selection.value;
  try {
    await confirm(ot("knowledgeBatchDeleteConfirm", { n: targets.length }), ot("deleteConfirmTitle"));
  } catch {
    return;
  }
  const results = await Promise.allSettled(
    targets.map((item) => client.deleteKnowledge(item.knowledgeID))
  );
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed > 0) {
    message.warning(ot("knowledgeBatchDeleteFailed", { failed, total: results.length }));
  } else {
    message.success(ot("knowledgeBatchDeleted"));
  }
  await load();
}
onMounted(load);
</script>

<template>
  <section class="business-knowledge">
    <header class="knowledge-titlebar">
      <h1>{{ t("nav.businessKnowledge") }}</h1>
      <div class="knowledge-actions">
        <el-button
          v-if="context.knowledgeGovernanceUrl"
          tag="a"
          :href="context.knowledgeGovernanceUrl"
          target="_top"
        >
          <BookOpen :size="16" />
          {{ ot("knowledgeGovernance") }}
        </el-button>
        <el-button type="primary" @click="openCreate">
          <Plus :size="16" />
          {{ ot("knowledgeAdd") }}
        </el-button>
      </div>
    </header>

    <div class="knowledge-toolbar">
      <el-button :disabled="!selection.length" @click="removeSelected">
        <Trash2 :size="16" />
        {{ ot("knowledgeBatchDelete") }}
      </el-button>
      <span class="knowledge-count">{{ list.length }} {{ ot("items") }}</span>
    </div>

    <el-table
      v-loading="loading"
      :data="list"
      :empty-text="ot('knowledgeNoData')"
      row-key="knowledgeID"
      class="knowledge-table"
      @selection-change="selection = $event"
    >
      <el-table-column type="selection" width="48" />
      <el-table-column prop="knowledgeTitle" :label="ot('knowledgeTitle')" min-width="180" />
      <el-table-column :label="ot('knowledgeContent')" min-width="280">
        <template #default="{ row }">
          <span class="knowledge-text">{{ row.knowledgeText }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="ot('knowledgeTags')" min-width="150">
        <template #default="{ row }">
          <el-tag v-for="tag in row.knowledgeTags" :key="tag" size="small" class="knowledge-tag">
            {{ tag }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="ot('status')" width="110">
        <template #default="{ row }">
          <el-tag v-if="row.status === 1" type="success" size="small">
            {{ ot("knowledgeApproved") }}
          </el-tag>
          <el-tag v-else type="info" size="small">{{ ot("pendingReview") }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="ot('operation')" width="160" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link size="small" @click="openEdit(row)">
            <Pencil :size="14" />
            {{ t("common.edit") }}
          </el-button>
          <el-button type="danger" link size="small" @click="remove(row)">
            <Trash2 :size="14" />
            {{ ot("delete") }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="640px" :lock-scroll="false">
      <el-form :model="editing" label-width="120px">
        <el-form-item :label="ot('knowledgeTitle')" required>
          <el-input v-model="editing.knowledgeTitle" :placeholder="ot('knowledgeTitlePlaceholder')" />
        </el-form-item>
        <el-form-item :label="ot('knowledgeContent')">
          <el-input
            v-model="editing.knowledgeText"
            type="textarea"
            :rows="8"
            :placeholder="ot('knowledgeContentPlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="ot('knowledgeTags')">
          <el-select
            v-model="editing.knowledgeTags"
            multiple
            filterable
            allow-create
            :placeholder="ot('knowledgeTagsPlaceholder')"
            class="knowledge-tag-select"
          >
            <el-option
              v-for="option in tagOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="ot('status')">
          <el-radio-group v-model="editing.status">
            <el-radio :value="0">{{ ot("pendingReview") }}</el-radio>
            <el-radio :value="1">{{ ot("knowledgeApproved") }}</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ ot("cancel") }}</el-button>
        <el-button type="primary" :loading="saving" @click="save">{{ ot("save") }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.business-knowledge {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  padding: var(--spacing-xl) var(--spacing-2xl);
  background: var(--el-bg-color);
}
.knowledge-titlebar {
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-lg);
}
.knowledge-titlebar h1 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-2xl);
  font-weight: var(--font-semibold);
}
.knowledge-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}
.business-knowledge :deep(.el-button) {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
}
.knowledge-toolbar {
  display: flex;
  min-height: 54px;
  align-items: center;
  gap: var(--spacing-md);
  margin: var(--spacing-lg) 0;
  padding: 9px var(--spacing-md);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
}
.knowledge-count {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.knowledge-table {
  width: 100%;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
}
.knowledge-tag {
  margin-right: var(--spacing-xs);
}
.knowledge-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.knowledge-tag-select {
  width: 100%;
}
</style>
