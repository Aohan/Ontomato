<script setup lang="ts">
import { MODEL_ROLES, type ModelSettingsData } from "@ontomato/contracts/model-settings";
import { computed, onMounted, ref, shallowRef } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { adminApi } from "../../admin";
import { renderMarkdown } from "../../../utils/markdown";
import { workbenchContent } from "../../../content";
import EmbeddingModelConfigCard from "./business-config/EmbeddingModelConfigCard.vue";
import ModelListCard from "./business-config/ModelListCard.vue";
import RoleModelsCard from "./business-config/RoleModelsCard.vue";
import TestResultDialog from "./business-config/TestResultDialog.vue";
import {
  modelLabel,
  type BusinessConfig,
  type EmbeddingModelConfig,
  type ModelEntry,
  type RoleModels,
} from "../types";

// Model configuration page: saved where edited. The page holds the saved model list and role references (from the last load
// or save response) plus a role draft; model dialogs, model deletion, the role card and the Embedding dialog each save on their own.
const { t } = useI18n();
const { businessConfigSeparator } = workbenchContent().text;

const unsetRoles = () => Object.fromEntries(MODEL_ROLES.map((role) => [role, null])) as RoleModels;

// The list is held by a shallow ref and replaced as a whole: entries stay plain objects and opaque custom parameters never pass through Vue proxies.
const savedModels = shallowRef<ModelEntry[]>([]);
const savedRoles = ref<RoleModels>(unsetRoles());
const roleDraft = ref<RoleModels>(unsetRoles());
const loading = ref(false);
const loadError = ref("");
const saving = ref(false);

const rolesDirty = computed(() =>
  MODEL_ROLES.some((role) => roleDraft.value[role] !== savedRoles.value[role])
);

function applySaved(data: ModelSettingsData) {
  savedModels.value = data.models;
  // Unconfigured roles may omit the model field in the response; normalize them to null.
  savedRoles.value = Object.fromEntries(
    MODEL_ROLES.map((role) => [role, data.agents[role].model ?? null])
  ) as RoleModels;
}

async function loadSettings() {
  loading.value = true;
  loadError.value = "";
  try {
    const res = await adminApi.getModelSettings();
    applySaved(res.data as ModelSettingsData);
    roleDraft.value = { ...savedRoles.value };
  } catch (e: any) {
    loadError.value = e.message || t("admin.loadConfigFailed");
  } finally {
    loading.value = false;
  }
}

// The backend takes models and roles as one document; each save sends the part being changed together with the saved rest.
async function saveSettings(models: ModelEntry[], agents: RoleModels): Promise<boolean> {
  saving.value = true;
  try {
    const res = await adminApi.saveModelSettings({ models, agents });
    applySaved(res.data as ModelSettingsData);
    ElMessage.success(t("admin.modelSaveSuccess"));
    return true;
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
    return false;
  } finally {
    saving.value = false;
  }
}

// Model add/edit: saved with the saved roles, so an unsaved role draft is neither submitted nor lost.
const saveModels = (models: ModelEntry[]) => saveSettings(models, savedRoles.value);

async function saveRoles() {
  if (await saveSettings(savedModels.value, roleDraft.value)) {
    roleDraft.value = { ...savedRoles.value };
  }
}

async function removeModel(index: number) {
  const removed = savedModels.value[index]!;
  const usedBy = MODEL_ROLES.filter((role) => savedRoles.value[role] === removed.name);
  const name = modelLabel(removed);
  const confirmed = await ElMessageBox.confirm(
    usedBy.length
      ? t("admin.deleteModelInUseConfirm", {
          name,
          roles: usedBy.map((role) => t(`admin.modelRoleNames.${role}`)).join(", "),
        })
      : t("admin.deleteModelConfirm", { name }),
    t("common.deleteConfirm"),
    { type: "warning", confirmButtonText: t("common.delete"), cancelButtonText: t("common.cancel") }
  ).then(
    () => true,
    () => false
  );
  if (!confirmed) return;
  // Roles referring to the deleted model become not configured in the same save, so no dangling reference is stored.
  const agents = { ...savedRoles.value };
  for (const role of usedBy) agents[role] = null;
  const models = savedModels.value.filter((_, i) => i !== index);
  if (!(await saveSettings(models, agents))) return;
  for (const role of MODEL_ROLES) {
    if (roleDraft.value[role] === removed.name) roleDraft.value[role] = null;
  }
}

const testDialogVisible = ref(false);
const testModel = shallowRef<ModelEntry | null>(null);
const testContent = ref("");
const testResult = ref("");
const testRunning = ref(false);
const renderedTestResult = computed(() => renderMarkdown(testResult.value));

function openModelTest(model: ModelEntry) {
  testModel.value = model;
  testContent.value = "";
  testResult.value = "";
  testDialogVisible.value = true;
}

async function runModelTest() {
  if (!testContent.value.trim()) {
    ElMessage.warning(t("common.enterTestContent"));
    return;
  }
  testRunning.value = true;
  testResult.value = "";
  try {
    const res = await adminApi.testModel(testModel.value!, testContent.value);
    testResult.value = res.data as string;
  } catch (e: any) {
    testResult.value = `${t("admin.testFailed")}: ${e.message || t("common.unknownError")}`;
  } finally {
    testRunning.value = false;
  }
}

// Embedding belongs to the business config: read with getConfig and saved separately.
const embedding = shallowRef<EmbeddingModelConfig | null>(null);
const embeddingLoading = ref(false);
const embeddingLoadError = ref("");
const savingEmbedding = ref(false);

async function loadEmbedding() {
  embeddingLoading.value = true;
  embeddingLoadError.value = "";
  try {
    const res = await adminApi.getBusinessConfig();
    embedding.value = (res.data as BusinessConfig).embeddingModelProperties;
  } catch (e: any) {
    embeddingLoadError.value = e.message || t("admin.loadConfigFailed");
  } finally {
    embeddingLoading.value = false;
  }
}

// The dialog hands over the whole snapshot, which keeps fields it does not show (such as customHeaders).
async function saveEmbeddingConfig(model: EmbeddingModelConfig): Promise<boolean> {
  savingEmbedding.value = true;
  try {
    await adminApi.saveEmbeddingModel(model);
    embedding.value = model;
    ElMessage.success(t("admin.embeddingSaveSuccess"));
    return true;
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
    return false;
  } finally {
    savingEmbedding.value = false;
  }
}

const testEmbeddingDialogVisible = ref(false);
const testEmbeddingContent = ref("");
const testEmbeddingResult = ref("");
const testEmbeddingRunning = ref(false);

async function runEmbeddingTest() {
  if (!testEmbeddingContent.value.trim()) {
    ElMessage.warning(t("common.enterTestContent"));
    return;
  }
  testEmbeddingRunning.value = true;
  testEmbeddingResult.value = "";
  try {
    const res = await adminApi.testEmbeddingModel({
      modelConfig: embedding.value,
      userContent: testEmbeddingContent.value,
    });
    testEmbeddingResult.value = JSON.stringify(res, null, 2);
  } catch (e: any) {
    testEmbeddingResult.value = `${t("admin.testFailed")}: ${e.message || t("common.unknownError")}`;
  } finally {
    testEmbeddingRunning.value = false;
  }
}

onMounted(() => {
  loadSettings();
  loadEmbedding();
});
</script>

<template>
  <div class="system-config-container">
    <div v-if="loading" class="admin-card config-card">
      <el-skeleton :rows="4" animated />
    </div>
    <div v-else-if="loadError" class="load-error" role="alert">
      <span>{{ t("admin.modelListLoadFailed") }}{{ businessConfigSeparator }}{{ loadError }}</span>
      <el-button size="small" @click="loadSettings">{{ t("common.retry") }}</el-button>
    </div>
    <template v-else>
      <ModelListCard
        :models="savedModels"
        :saving="saving"
        :save="saveModels"
        @remove="removeModel"
        @test="openModelTest"
      />
      <RoleModelsCard
        v-model:roles="roleDraft"
        :models="savedModels"
        :saving="saving"
        :dirty="rolesDirty"
        @save="saveRoles"
      />
    </template>

    <EmbeddingModelConfigCard
      :model="embedding"
      :loading="embeddingLoading"
      :saving="savingEmbedding"
      :load-error="embeddingLoadError"
      :save="saveEmbeddingConfig"
      @test="testEmbeddingDialogVisible = true"
      @retry="loadEmbedding"
    />

    <TestResultDialog
      v-model:visible="testDialogVisible"
      v-model:content="testContent"
      :title="t('admin.testModelNamed', { name: testModel && modelLabel(testModel) })"
      :result="testResult"
      :rendered-result="renderedTestResult"
      :running="testRunning"
      :placeholder="t('common.enterTestMessage')"
      @submit="runModelTest"
    />

    <TestResultDialog
      v-model:visible="testEmbeddingDialogVisible"
      v-model:content="testEmbeddingContent"
      :title="t('admin.testModelNamed', { name: t('admin.embeddingModelConfig') })"
      :result="testEmbeddingResult"
      :running="testEmbeddingRunning"
      :placeholder="t('common.enterEmbeddingText')"
      plain-result
      @submit="runEmbeddingTest"
    />
  </div>
</template>

<style scoped src="./business-config/business-config.css"></style>

<style scoped>
/* Width follows the admin main area; individual inputs limit their own width. */
.system-config-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}
</style>
