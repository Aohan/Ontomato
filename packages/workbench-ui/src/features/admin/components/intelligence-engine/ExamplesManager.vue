<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus, Pencil, Trash2, Grid3x3, List } from "lucide-vue-next";
import { queryViewApi } from "../../../query-view/api";
import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../../content";

const { t } = useI18n();
const { batchDeleteFailureSuffix, exampleFieldSeparator } = workbenchContent().text;

interface Example {
  exampleID: string;
  exampleQuestion: string;
  exampleA: string;
  exampleB: string;
  exampleC: string;
  exampleImportant: string;
  status: number;
}

interface QuestionSplitter {
  id: string;
  question: string;
  content: string;
  status: number;
  createTimestamp: number;
}

const activeTab = ref("dsl");
const viewMode = ref<"table" | "card">("table");
const dslSelection = ref<Example[]>([]);
const spliterSelection = ref<QuestionSplitter[]>([]);

const loading = ref(false);
const examples = ref<Example[]>([]);

const dialogVisible = ref(false);
const editingExample = reactive({
  exampleID: "",
  exampleQuestion: "",
  exampleA: "",
  exampleB: "",
  exampleC: "",
  exampleImportant: "",
  status: 1,
});

async function loadExamples() {
  loading.value = true;
  try {
    const res = await queryViewApi.listBusinessExamples();
    examples.value = res.data || res || [];
  } catch (e: any) {
    ElMessage.error(e.message || t("example.loadFailed"));
  } finally {
    loading.value = false;
  }
}

function openCreateDialog() {
  editingExample.exampleID = "";
  editingExample.exampleQuestion = "";
  editingExample.exampleA = "";
  editingExample.exampleB = "";
  editingExample.exampleC = "";
  editingExample.exampleImportant = "";
  editingExample.status = 1;
  dialogVisible.value = true;
}

function openEditDialog(row: Example) {
  editingExample.exampleID = row.exampleID;
  editingExample.exampleQuestion = row.exampleQuestion;
  editingExample.exampleA = row.exampleA || "";
  editingExample.exampleB = row.exampleB || "";
  editingExample.exampleC = row.exampleC || "";
  editingExample.exampleImportant = row.exampleImportant || "";
  editingExample.status = row.status;
  dialogVisible.value = true;
}

async function handleSave() {
  if (!editingExample.exampleQuestion) {
    ElMessage.warning(t("example.enterQuestion"));
    return;
  }
  try {
    const payload = {
      exampleID: editingExample.exampleID,
      exampleQuestion: editingExample.exampleQuestion,
      exampleA: editingExample.exampleA,
      exampleB: editingExample.exampleB,
      exampleC: editingExample.exampleC,
      exampleImportant: editingExample.exampleImportant,
      status: editingExample.status,
    };
    const res = editingExample.exampleID
      ? await queryViewApi.editBusinessExample(payload)
      : await queryViewApi.addBusinessExample(payload);
    if (res.success) {
      ElMessage.success(t("admin.saveSuccess"));
      dialogVisible.value = false;
      loadExamples();
    } else {
      ElMessage.error(res.message || t("admin.saveFailed"));
    }
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  }
}

async function handleDelete(row: Example) {
  try {
    await ElMessageBox.confirm(
      t("admin.deleteExampleConfirm", { name: row.exampleQuestion }),
      t("common.tip"),
      {
        type: "warning",
      }
    );
    await queryViewApi.deleteBusinessExample(row.exampleID);
    ElMessage.success(t("admin.deletedSuccess"));
    loadExamples();
  } catch (e: any) {
    if (e !== "cancel") ElMessage.error(e.message || t("admin.deleteFailed"));
  }
}

function handleDslSelectionChange(selection: Example[]) {
  dslSelection.value = selection;
}

async function handleDslBatchDelete() {
  if (!dslSelection.value.length) return;
  try {
    await ElMessageBox.confirm(
      t("admin.batchDeleteExampleConfirm", { n: dslSelection.value.length }),
      t("common.tip"),
      { type: "warning" }
    );
    const results = await Promise.allSettled(
      dslSelection.value.map((item) => queryViewApi.deleteBusinessExample(item.exampleID))
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      ElMessage.warning(
        t("hotData.batchDeleteFailed") + batchDeleteFailureSuffix(failed, results.length)
      );
    } else {
      ElMessage.success(t("hotData.batchDeleteSuccess"));
    }
    loadExamples();
  } catch (e: any) {
    if (e !== "cancel") ElMessage.error(e.message || t("admin.deleteFailed"));
  }
}

const spliterLoading = ref(false);
const splitters = ref<QuestionSplitter[]>([]);

const spliterDialogVisible = ref(false);
const editingSpliter = reactive({
  id: "",
  question: "",
  content: "",
  status: 1,
  createTimestamp: 0,
});

async function loadSplitters() {
  spliterLoading.value = true;
  try {
    const res = await queryViewApi.listQuestionSplitterExamples();
    splitters.value = res.data || res || [];
  } catch (e: any) {
    ElMessage.error(e.message || t("example.spliterLoadFailed"));
  } finally {
    spliterLoading.value = false;
  }
}

function openCreateSpliterDialog() {
  editingSpliter.id = "";
  editingSpliter.question = "";
  editingSpliter.content = "";
  editingSpliter.status = 1;
  editingSpliter.createTimestamp = 0;
  spliterDialogVisible.value = true;
}

function openEditSpliterDialog(row: QuestionSplitter) {
  editingSpliter.id = row.id;
  editingSpliter.question = row.question || "";
  editingSpliter.content = row.content || "";
  editingSpliter.status = row.status;
  editingSpliter.createTimestamp = row.createTimestamp || 0;
  spliterDialogVisible.value = true;
}

async function handleSpliterSave() {
  if (!editingSpliter.question) {
    ElMessage.warning(t("example.spliterEnterQuestion"));
    return;
  }
  try {
    const payload: any = {
      question: editingSpliter.question,
      content: editingSpliter.content,
      status: editingSpliter.status,
    };
    if (editingSpliter.id) {
      payload.id = editingSpliter.id;
      payload.createTimestamp = editingSpliter.createTimestamp;
    }
    const res = editingSpliter.id
      ? await queryViewApi.editQuestionSplitterExample(payload)
      : await queryViewApi.addQuestionSplitterExample(payload);
    if (res.success) {
      ElMessage.success(t("admin.saveSuccess"));
      spliterDialogVisible.value = false;
      loadSplitters();
    } else {
      ElMessage.error(res.message || t("admin.saveFailed"));
    }
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  }
}

async function handleSpliterDelete(row: QuestionSplitter) {
  try {
    await ElMessageBox.confirm(
      t("example.spliterDeleteConfirm", { name: row.question }),
      t("common.tip"),
      {
        type: "warning",
      }
    );
    await queryViewApi.deleteQuestionSplitterExample(row.id);
    ElMessage.success(t("admin.deletedSuccess"));
    loadSplitters();
  } catch (e: any) {
    if (e !== "cancel") ElMessage.error(e.message || t("admin.deleteFailed"));
  }
}

function handleSpliterSelectionChange(selection: QuestionSplitter[]) {
  spliterSelection.value = selection;
}

async function handleSpliterBatchDelete() {
  if (!spliterSelection.value.length) return;
  try {
    await ElMessageBox.confirm(
      t("admin.batchDeleteSpliterConfirm", { n: spliterSelection.value.length }),
      t("common.tip"),
      { type: "warning" }
    );
    const results = await Promise.allSettled(
      spliterSelection.value.map((item) => queryViewApi.deleteQuestionSplitterExample(item.id))
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      ElMessage.warning(
        t("hotData.batchDeleteFailed") + batchDeleteFailureSuffix(failed, results.length)
      );
    } else {
      ElMessage.success(t("hotData.batchDeleteSuccess"));
    }
    loadSplitters();
  } catch (e: any) {
    if (e !== "cancel") ElMessage.error(e.message || t("admin.deleteFailed"));
  }
}

const dslFixedContent = ref("");
const spliterFixedContent = ref("");
const loadingFixedDsl = ref(false);
const loadingFixedSpliter = ref(false);
const savingFixedDsl = ref(false);
const savingFixedSpliter = ref(false);

function getFixedExampleContent(res: any): string {
  if (typeof res?.data === "string") return res.data;
  return "";
}

async function loadFixedDslExample() {
  loadingFixedDsl.value = true;
  try {
    const res = await queryViewApi.getDslCookerExample();
    dslFixedContent.value = getFixedExampleContent(res);
  } catch {
    // silent
  } finally {
    loadingFixedDsl.value = false;
  }
}

async function saveFixedDslExample() {
  savingFixedDsl.value = true;
  try {
    await queryViewApi.saveDslCookerExample(dslFixedContent.value);
    ElMessage.success(t("admin.saveSuccess"));
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    savingFixedDsl.value = false;
  }
}

async function loadFixedSpliterExample() {
  loadingFixedSpliter.value = true;
  try {
    const res = await queryViewApi.getQuestionSplitterExample();
    spliterFixedContent.value = getFixedExampleContent(res);
  } catch {
    // silent
  } finally {
    loadingFixedSpliter.value = false;
  }
}

async function saveFixedSpliterExample() {
  savingFixedSpliter.value = true;
  try {
    await queryViewApi.saveQuestionSplitterExample(spliterFixedContent.value);
    ElMessage.success(t("admin.saveSuccess"));
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    savingFixedSpliter.value = false;
  }
}

onMounted(() => {
  loadExamples();
  loadSplitters();
  loadFixedDslExample();
  loadFixedSpliterExample();
});
</script>

<template>
  <div class="examples-manager">
    <el-tabs v-model="activeTab" class="sub-tabs">
      <el-tab-pane :label="t('example.dslGenerator')" name="dsl">
        <div class="fixed-example-card">
          <div class="fixed-example-header">
            <span>{{ t("example.fixedDslExample") }}</span>
          </div>
          <div v-loading="loadingFixedDsl" class="fixed-example-body">
            <el-input
              v-model="dslFixedContent"
              type="textarea"
              :rows="6"
              :placeholder="t('example.fixedDslExamplePlaceholder')"
            />
            <div class="fixed-example-actions">
              <el-button type="primary" :loading="savingFixedDsl" @click="saveFixedDslExample">
                {{ t("common.save") }}
              </el-button>
            </div>
          </div>
        </div>

        <div class="toolbar">
          <el-button type="primary" :icon="Plus" @click="openCreateDialog">
            {{ t("example.addExample") }}
          </el-button>
          <el-button :disabled="!dslSelection.length" :icon="Trash2" @click="handleDslBatchDelete">
            {{ t("hotData.batchDelete") }}
          </el-button>
          <div class="toolbar-right">
            <el-button-group>
              <el-button
                :type="viewMode === 'table' ? 'primary' : 'default'"
                :icon="List"
                size="small"
                @click="viewMode = 'table'"
              >
                {{ t("common.table") }}
              </el-button>
              <el-button
                :type="viewMode === 'card' ? 'primary' : 'default'"
                :icon="Grid3x3"
                size="small"
                @click="viewMode = 'card'"
              >
                {{ t("common.grid") }}
              </el-button>
            </el-button-group>
          </div>
        </div>

        <el-table
          v-if="viewMode === 'table'"
          v-loading="loading"
          :data="examples"
          border
          stripe
          class="admin-table"
          style="width: 100%"
          @selection-change="handleDslSelectionChange"
        >
          <el-table-column type="selection" width="48" />
          <el-table-column prop="exampleQuestion" :label="t('example.question')" min-width="250" />
          <el-table-column
            prop="exampleA"
            :label="t('example.phaseA')"
            min-width="150"
            show-overflow-tooltip
          />
          <el-table-column
            prop="exampleB"
            :label="t('example.phaseB')"
            min-width="150"
            show-overflow-tooltip
          />
          <el-table-column
            prop="exampleC"
            :label="t('example.phaseC')"
            min-width="150"
            show-overflow-tooltip
          />
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
              <el-button
                type="primary"
                link
                size="small"
                :icon="Pencil"
                @click="openEditDialog(row)"
              >
                {{ t("common.edit") }}
              </el-button>
              <el-button type="danger" link size="small" :icon="Trash2" @click="handleDelete(row)">
                {{ t("common.delete") }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="viewMode === 'card'" v-loading="loading" class="card-grid">
          <el-card
            v-for="item in examples"
            :key="item.exampleID"
            class="example-card"
            shadow="hover"
          >
            <template #header>
              <div class="card-header">
                <span class="card-title">{{ item.exampleQuestion }}</span>
                <el-tag v-if="item.status === 1" type="success" size="small">
                  {{ t("common.approved") }}
                </el-tag>
                <el-tag v-else type="info" size="small">{{ t("common.pendingReview") }}</el-tag>
              </div>
            </template>
            <div class="card-body">
              <div v-if="item.exampleA" class="card-field">
                <span class="field-label">{{ t("example.phaseA") + exampleFieldSeparator }}</span>
                <span class="field-value">{{ item.exampleA }}</span>
              </div>
              <div v-if="item.exampleB" class="card-field">
                <span class="field-label">{{ t("example.phaseB") + exampleFieldSeparator }}</span>
                <span class="field-value">{{ item.exampleB }}</span>
              </div>
              <div v-if="item.exampleC" class="card-field">
                <span class="field-label">{{ t("example.phaseC") + exampleFieldSeparator }}</span>
                <span class="field-value">{{ item.exampleC }}</span>
              </div>
              <div v-if="item.exampleImportant" class="card-field">
                <span class="field-label">{{ t("example.important") + exampleFieldSeparator }}</span>
                <span class="field-value">{{ item.exampleImportant }}</span>
              </div>
            </div>
            <div class="card-footer">
              <el-button
                type="primary"
                link
                size="small"
                :icon="Pencil"
                @click="openEditDialog(item)"
              >
                {{ t("common.edit") }}
              </el-button>
              <el-button type="danger" link size="small" :icon="Trash2" @click="handleDelete(item)">
                {{ t("common.delete") }}
              </el-button>
            </div>
          </el-card>
        </div>

        <el-dialog
          v-model="dialogVisible"
          :title="t('example.editTitle')"
          width="650px"
          destroy-on-close
        >
          <el-form :model="editingExample" label-width="120px">
            <el-form-item :label="t('example.question')">
              <el-input
                v-model="editingExample.exampleQuestion"
                :placeholder="t('example.enterQuestion')"
              />
            </el-form-item>
            <el-form-item :label="t('example.phaseA')">
              <el-input
                v-model="editingExample.exampleA"
                type="textarea"
                :rows="3"
                :placeholder="t('example.lockPhaseHint')"
              />
            </el-form-item>
            <el-form-item :label="t('example.phaseB')">
              <el-input
                v-model="editingExample.exampleB"
                type="textarea"
                :rows="3"
                :placeholder="t('example.fetchPhaseHint')"
              />
            </el-form-item>
            <el-form-item :label="t('example.phaseC')">
              <el-input
                v-model="editingExample.exampleC"
                type="textarea"
                :rows="3"
                :placeholder="t('example.calcPhaseHint')"
              />
            </el-form-item>
            <el-form-item :label="t('example.important')">
              <el-input
                v-model="editingExample.exampleImportant"
                type="textarea"
                :rows="2"
                :placeholder="t('example.importantHint')"
              />
            </el-form-item>
            <el-form-item :label="t('common.status')">
              <el-radio-group v-model="editingExample.status">
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
      </el-tab-pane>

      <el-tab-pane :label="t('example.questionSplitter')" name="spliter">
        <div class="fixed-example-card">
          <div class="fixed-example-header">
            <span>{{ t("example.fixedSpliterExample") }}</span>
          </div>
          <div v-loading="loadingFixedSpliter" class="fixed-example-body">
            <el-input
              v-model="spliterFixedContent"
              type="textarea"
              :rows="6"
              :placeholder="t('example.fixedSpliterExamplePlaceholder')"
            />
            <div class="fixed-example-actions">
              <el-button
                type="primary"
                :loading="savingFixedSpliter"
                @click="saveFixedSpliterExample"
              >
                {{ t("common.save") }}
              </el-button>
            </div>
          </div>
        </div>

        <div class="toolbar">
          <el-button type="primary" :icon="Plus" @click="openCreateSpliterDialog">
            {{ t("example.spliterAdd") }}
          </el-button>
          <el-button
            :disabled="!spliterSelection.length"
            :icon="Trash2"
            @click="handleSpliterBatchDelete"
          >
            {{ t("hotData.batchDelete") }}
          </el-button>
          <div class="toolbar-right">
            <el-button-group>
              <el-button
                :type="viewMode === 'table' ? 'primary' : 'default'"
                :icon="List"
                size="small"
                @click="viewMode = 'table'"
              >
                {{ t("common.table") }}
              </el-button>
              <el-button
                :type="viewMode === 'card' ? 'primary' : 'default'"
                :icon="Grid3x3"
                size="small"
                @click="viewMode = 'card'"
              >
                {{ t("common.grid") }}
              </el-button>
            </el-button-group>
          </div>
        </div>

        <el-table
          v-if="viewMode === 'table'"
          v-loading="spliterLoading"
          :data="splitters"
          border
          stripe
          class="admin-table"
          style="width: 100%"
          @selection-change="handleSpliterSelectionChange"
        >
          <el-table-column type="selection" width="48" />
          <el-table-column prop="question" :label="t('example.spliterQuestion')" min-width="250" />
          <el-table-column
            prop="content"
            :label="t('example.spliterContent')"
            min-width="300"
            show-overflow-tooltip
          />
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
              <el-button
                type="primary"
                link
                size="small"
                :icon="Pencil"
                @click="openEditSpliterDialog(row)"
              >
                {{ t("common.edit") }}
              </el-button>
              <el-button
                type="danger"
                link
                size="small"
                :icon="Trash2"
                @click="handleSpliterDelete(row)"
              >
                {{ t("common.delete") }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="viewMode === 'card'" v-loading="spliterLoading" class="card-grid">
          <el-card v-for="item in splitters" :key="item.id" class="example-card" shadow="hover">
            <template #header>
              <div class="card-header">
                <span class="card-title">{{ item.question }}</span>
                <el-tag v-if="item.status === 1" type="success" size="small">
                  {{ t("common.approved") }}
                </el-tag>
                <el-tag v-else type="info" size="small">{{ t("common.pendingReview") }}</el-tag>
              </div>
            </template>
            <div class="card-body">
              <div v-if="item.content" class="card-field">
                <span class="field-label">{{ t("example.spliterContent") + exampleFieldSeparator }}</span>
                <span class="field-value">{{ item.content }}</span>
              </div>
            </div>
            <div class="card-footer">
              <el-button
                type="primary"
                link
                size="small"
                :icon="Pencil"
                @click="openEditSpliterDialog(item)"
              >
                {{ t("common.edit") }}
              </el-button>
              <el-button
                type="danger"
                link
                size="small"
                :icon="Trash2"
                @click="handleSpliterDelete(item)"
              >
                {{ t("common.delete") }}
              </el-button>
            </div>
          </el-card>
        </div>

        <el-dialog
          v-model="spliterDialogVisible"
          :title="t('example.spliterEditTitle')"
          width="650px"
          destroy-on-close
        >
          <el-form :model="editingSpliter" label-width="120px">
            <el-form-item :label="t('example.spliterQuestion')">
              <el-input
                v-model="editingSpliter.question"
                :placeholder="t('example.spliterEnterQuestion')"
              />
            </el-form-item>
            <el-form-item :label="t('example.spliterContent')">
              <el-input
                v-model="editingSpliter.content"
                type="textarea"
                :rows="5"
                :placeholder="t('example.spliterEnterContent')"
              />
            </el-form-item>
            <el-form-item :label="t('common.status')">
              <el-radio-group v-model="editingSpliter.status">
                <el-radio :value="0">{{ t("common.pendingReview") }}</el-radio>
                <el-radio :value="1">{{ t("common.approved") }}</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="spliterDialogVisible = false">{{ t("common.cancel") }}</el-button>
            <el-button type="primary" @click="handleSpliterSave">{{ t("common.save") }}</el-button>
          </template>
        </el-dialog>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.examples-manager {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sub-tabs {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.sub-tabs :deep(.el-tabs__content) {
  flex: 1;
  overflow: hidden;
}

.sub-tabs :deep(.el-tab-pane) {
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

.toolbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
}

.card-grid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: var(--spacing-md);
  align-content: start;
  padding: 2px;
}

.example-card {
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color) !important;
  border: 1px solid var(--el-border-color) !important;
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.example-card :deep(.el-card__header) {
  padding: 12px 16px;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.example-card :deep(.el-card__body) {
  padding: 0;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-title {
  flex: 1;
  font-weight: 600;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-body {
  padding: 14px 16px 12px;
  flex: 1;
  overflow: hidden;
}

.card-field {
  font-size: 13px;
  line-height: 1.65;
  margin-bottom: 6px;
  display: flex;
  align-items: flex-start;
  gap: 2px;
}

.card-field:last-child {
  margin-bottom: 0;
}

.field-label {
  color: var(--el-text-color-secondary);
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}

.field-value {
  color: var(--el-text-color-regular);
  word-break: break-word;
  overflow-wrap: break-word;
  min-width: 0;
}

.card-footer {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  padding: 8px 16px;
  background: var(--el-fill-color-lighter);
  border-top: 1px solid var(--el-border-color-lighter);
}

@media (max-width: 1024px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar .el-button {
    width: 100%;
  }

  .toolbar-right {
    margin-left: 0;
  }
}

.fixed-example-card {
  margin-bottom: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
  background: var(--el-bg-color);
  overflow: hidden;
}

.fixed-example-header {
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
}

.fixed-example-body {
  padding: 16px;
}

.fixed-example-actions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 768px) {
  .operation-cell .el-button + .el-button {
    margin-left: 0;
  }

  .card-grid {
    grid-template-columns: 1fr;
  }
}
</style>
