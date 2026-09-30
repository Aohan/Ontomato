<script setup lang="ts">
import { MODEL_ROLES, type ModelSettingsData } from "@ontomato/contracts/model-settings";
import { computed, onMounted, ref, shallowRef } from "vue";
import { ElMessage } from "element-plus";
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

// Model configuration page: the model list and the five role references are an edit draft of the Java model library, saved at once; the Embedding card saves separately.
const { t } = useI18n();
const { businessConfigSeparator } = workbenchContent().text;

// The list is held by a shallow ref and replaced as a whole: entries stay plain objects and opaque custom parameters never pass through Vue proxies.
const models = shallowRef<ModelEntry[]>([]);
const roles = ref<RoleModels>(
  Object.fromEntries(MODEL_ROLES.map((role) => [role, null])) as RoleModels
);
const loading = ref(false);
const loadError = ref("");
const saving = ref(false);
const savedSignature = ref("");

const signature = () => JSON.stringify({ models: models.value, agents: roles.value });
const dirty = computed(() => signature() !== savedSignature.value);

function applySettings(data: ModelSettingsData) {
  models.value = data.models;
  // Unconfigured roles may omit the model field in the response; normalize them to null.
  roles.value = Object.fromEntries(
    MODEL_ROLES.map((role) => [role, data.agents[role].model ?? null])
  ) as RoleModels;
  savedSignature.value = signature();
}

async function loadSettings() {
  loading.value = true;
  loadError.value = "";
  try {
    const res = await adminApi.getModelSettings();
    applySettings(res.data as ModelSettingsData);
  } catch (e: any) {
    loadError.value = e.message || t("admin.loadConfigFailed");
  } finally {
    loading.value = false;
  }
}

function removeModel(index: number) {
  const removed = models.value[index]!.name;
  models.value = models.value.filter((_, i) => i !== index);
  // Roles referring to a deleted model are cleared so no dangling reference is saved.
  for (const role of MODEL_ROLES) {
    if (roles.value[role] === removed) roles.value[role] = null;
  }
}

async function saveSettings() {
  saving.value = true;
  try {
    const res = await adminApi.saveModelSettings({ models: models.value, agents: roles.value });
    applySettings(res.data as ModelSettingsData);
    ElMessage.success(t("admin.modelSaveSuccess"));
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    saving.value = false;
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
    // Test with the current draft entry without saving.
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

async function saveEmbeddingConfig() {
  savingEmbedding.value = true;
  try {
    // Submit the whole snapshot to keep fields not shown in the dialog, such as customHeaders.
    await adminApi.saveEmbeddingModel(embedding.value);
    ElMessage.success(t("admin.embeddingSaveSuccess"));
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
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
        v-model:models="models"
        :disabled="saving"
        @remove="removeModel"
        @test="openModelTest"
      />
      <RoleModelsCard v-model:roles="roles" :models="models" :disabled="saving" />
      <div class="model-settings-actions">
        <el-tag v-if="dirty" type="warning" size="small">{{ t("admin.unsaved") }}</el-tag>
        <el-button type="primary" :loading="saving" @click="saveSettings">
          {{ t("common.save") }}
        </el-button>
      </div>
    </template>

    <EmbeddingModelConfigCard
      v-model:model="embedding"
      :loading="embeddingLoading"
      :saving="savingEmbedding"
      :load-error="embeddingLoadError"
      @save="saveEmbeddingConfig"
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

/* The single save action for the model list and role references, right after the role table; the Embedding card has its own save. */
.model-settings-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

@media (max-width: 640px) {
  .model-settings-actions :deep(.el-button) {
    min-width: 44px;
    min-height: 44px;
  }
}
</style>
