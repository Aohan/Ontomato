<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import {
  ElButton,
  ElDialog,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElRadio,
  ElRadioGroup,
  ElSelect,
  ElTable,
  ElTableColumn,
  ElTag,
  vLoading,
} from "element-plus";
import { Pencil, Plus, Trash2 } from "lucide-vue-next";
import { useManagerClient, useOntologyText } from "../context";

interface KnowledgeItem {
  knowledgeID: string;
  knowledgeTitle: string;
  knowledgeText: string;
  knowledgeTags: string[];
  status: number;
}

const client = useManagerClient();
const { ot } = useOntologyText();

const loading = ref(false);
const list = ref<KnowledgeItem[]>([]);

const dialogVisible = ref(false);
const editing = reactive({
  knowledgeID: "",
  knowledgeTitle: "",
  knowledgeText: "",
  knowledgeTags: [] as string[],
  status: 1,
});

function normalizeList(response: unknown): KnowledgeItem[] {
  const data = (response as { data?: unknown })?.data ?? response;
  if (Array.isArray(data)) return data as KnowledgeItem[];
  return data && typeof data === "object"
    ? (Object.values(data) as KnowledgeItem[])
    : [];
}

async function load() {
  loading.value = true;
  try {
    const res = await client.listKnowledge();
    list.value = normalizeList(res);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : ot("knowledgeLoadFailed"));
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editing.knowledgeID = "";
  editing.knowledgeTitle = "";
  editing.knowledgeText = "";
  editing.knowledgeTags = [];
  editing.status = 1;
  dialogVisible.value = true;
}

function openEdit(row: KnowledgeItem) {
  editing.knowledgeID = row.knowledgeID;
  editing.knowledgeTitle = row.knowledgeTitle;
  editing.knowledgeText = row.knowledgeText;
  editing.knowledgeTags = Array.isArray(row.knowledgeTags) ? [...row.knowledgeTags] : [];
  editing.status = row.status;
  dialogVisible.value = true;
}

async function handleSave() {
  if (!editing.knowledgeTitle.trim()) {
    ElMessage.warning(ot("knowledgeTitleRequired"));
    return;
  }
  const payload = {
    knowledgeID: editing.knowledgeID,
    knowledgeTitle: editing.knowledgeTitle,
    knowledgeText: editing.knowledgeText,
    knowledgeTags: editing.knowledgeTags,
    status: editing.status,
  };
  try {
    const res = editing.knowledgeID
      ? await client.editKnowledge(payload)
      : await client.addKnowledge(payload);
    if ((res as { success?: boolean })?.success) {
      ElMessage.success(ot("knowledgeSaved"));
      dialogVisible.value = false;
      await load();
    } else {
      ElMessage.error(
        ((res as { message?: string })?.message) || ot("knowledgeSaveFailed")
      );
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : ot("knowledgeSaveFailed"));
  }
}

async function handleDelete(row: KnowledgeItem) {
  try {
    await ElMessageBox.confirm(
      ot("knowledgeDeleteConfirm", { name: row.knowledgeTitle }),
      ot("deleteConfirmTitle"),
      { type: "warning" }
    );
    await client.deleteKnowledge(row.knowledgeID);
    ElMessage.success(ot("knowledgeDeleted"));
    await load();
  } catch (error) {
    if (error !== "cancel") {
      ElMessage.error(error instanceof Error ? error.message : ot("knowledgeDeleteFailed"));
    }
  }
}

onMounted(load);
</script>

<template>
  <div class="business-knowledge">
    <div class="knowledge-toolbar">
      <el-button type="primary" :icon="Plus" @click="openCreate">
        {{ ot("knowledgeAdd") }}
      </el-button>
    </div>

    <el-table
      v-loading="loading"
      :data="list"
      border
      stripe
      class="knowledge-table"
      style="width: 100%"
    >
      <el-table-column prop="knowledgeTitle" :label="ot('knowledgeTitle')" min-width="180" />
      <el-table-column :label="ot('knowledgeContent')" min-width="260">
        <template #default="{ row }">
          <span class="knowledge-text">{{ row.knowledgeText }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="ot('knowledgeTags')" min-width="150">
        <template #default="{ row }">
          <el-tag
            v-for="tag in Array.isArray(row.knowledgeTags) ? row.knowledgeTags : []"
            :key="tag"
            size="small"
            class="knowledge-tag"
          >
            {{ tag }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="ot('knowledgeStatus')" width="110">
        <template #default="{ row }">
          <el-tag v-if="row.status === 1" type="success" size="small">
            {{ ot("knowledgeApproved") }}
          </el-tag>
          <el-tag v-else type="info" size="small">{{ ot("knowledgePendingReview") }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="ot('operation')" width="160" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link size="small" :icon="Pencil" @click="openEdit(row)">
            {{ ot("edit") }}
          </el-button>
          <el-button type="danger" link size="small" :icon="Trash2" @click="handleDelete(row)">
            {{ ot("delete") }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="!loading && list.length === 0" :description="ot('knowledgeNoData')" />

    <el-dialog
      v-model="dialogVisible"
      :title="ot('knowledgeEdit')"
      width="640px"
      destroy-on-close
    >
      <el-form :model="editing" label-width="120px">
        <el-form-item :label="ot('knowledgeTitle')">
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
            default-first-option
            :placeholder="ot('knowledgeTags')"
            style="width: 100%"
          >
            <el-option v-for="tag in editing.knowledgeTags" :key="tag" :label="tag" :value="tag" />
          </el-select>
        </el-form-item>
        <el-form-item :label="ot('knowledgeStatus')">
          <el-radio-group v-model="editing.status">
            <el-radio :value="0">{{ ot("knowledgePendingReview") }}</el-radio>
            <el-radio :value="1">{{ ot("knowledgeApproved") }}</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ ot("cancel") }}</el-button>
        <el-button type="primary" @click="handleSave">{{ ot("save") }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.business-knowledge {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-xl) var(--spacing-2xl);
  background: var(--el-bg-color);
}
.knowledge-toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
}
.knowledge-tag {
  margin-right: var(--spacing-xs);
}
.knowledge-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
</style>
