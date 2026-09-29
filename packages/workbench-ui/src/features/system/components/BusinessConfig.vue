<script setup lang="ts">
import type {
  SystemModelConfigResponse as SystemModelConfig,
} from "@ontomato/contracts/system-model";

import { ref, reactive, onMounted } from "vue";
import { ElMessage } from "element-plus";
import { MessagesSquare } from "lucide-vue-next";
import { adminApi } from "../../admin";
import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../content";
import DataAdapterConfigCard from "./business-config/DataAdapterConfigCard.vue";
import GeneralConfigCard from "./business-config/GeneralConfigCard.vue";
import QuerySettingsCard from "./business-config/QuerySettingsCard.vue";
import SkillDirConfigCard from "./business-config/SkillDirConfigCard.vue";
import ExamplesManager from "../../admin/components/intelligence-engine/ExamplesManager.vue";
import {
  agentKeys,
  type BackendAgentConfig,
  type BusinessConfig,
  type DataAdapterInfo,
  type GeneralConfigKey,
} from "../types";
import type { BusinessConfigProps } from "../business-config";

const props = defineProps<BusinessConfigProps>();
const { t } = useI18n();
const { businessConfigSeparator } = workbenchContent().text;

function emptyBackendAgent(): BackendAgentConfig {
  return { model: "", actorCopies: 1 };
}

const loading = ref(false);
const backendLoadError = ref("");
const systemLoadError = ref("");
const querySettingsRef = ref<{ markSaved: () => void } | null>(null);

let config = reactive<BusinessConfig>({
  models: [],
  agents: {
    normalChat: emptyBackendAgent(),
    questionSpliter: emptyBackendAgent(),
    cleverNormalChat: emptyBackendAgent(),
    pythonChat: emptyBackendAgent(),
    toolChat: emptyBackendAgent(),
  },
  embeddingModelProperties: null,
  knowledgeMaxResult: 10,
  toolAndPythonRetry: 0,
  dslCookerTries: 1,
  dslCookerTimeout: 300000,
  questionSpliterTries: 1,
  questionSpliterTimeout: 300000,
  lang: props.defaultLanguage,
  dataAdapter: "",
  dataAdapterConnections: {},
});
const dataAdapters = ref<DataAdapterInfo[]>([]);
const skilldir = ref("");

async function loadConfig() {
  loading.value = true;
  backendLoadError.value = "";
  try {
    const [res, adaptersRes] = await Promise.all([
      adminApi.getBusinessConfig(),
      adminApi.listDataAdapters(),
    ]);
    if (res?.success) {
      dataAdapters.value = adaptersRes.data;
      const data = res.data as BusinessConfig;
      config.models = data.models ?? [];
      const savedAgents = data.agents;
      for (const role of agentKeys) {
        const saved = savedAgents?.[role];
        config.agents[role] = saved ? { ...emptyBackendAgent(), ...saved } : emptyBackendAgent();
      }
      skilldir.value = savedAgents?.toolChat?.skilldir ?? "";
      config.embeddingModelProperties = data.embeddingModelProperties ?? null;
      config.knowledgeMaxResult = data.knowledgeMaxResult ?? 10;
      config.toolAndPythonRetry = data.toolAndPythonRetry ?? 0;
      config.dslCookerTries = data.dslCookerTries ?? 1;
      config.dslCookerTimeout = data.dslCookerTimeout ?? 300000;
      config.questionSpliterTries = data.questionSpliterTries ?? 1;
      config.questionSpliterTimeout = data.questionSpliterTimeout ?? 300000;
      // Only languages this edition ships are selectable; any other stored value shows the default until saved explicitly.
      config.lang = props.languageOptions.some(({ value }) => value === data.lang)
        ? data.lang
        : props.defaultLanguage;
      config.dataAdapter = data.dataAdapter;
      config.dataAdapterConnections = data.dataAdapterConnections;
      dataAdapterMode.value = config.dataAdapter;
    } else {
      backendLoadError.value = res?.message || t("admin.loadConfigFailed");
    }
  } catch (e: any) {
    backendLoadError.value = e.message || t("admin.loadConfigFailed");
    ElMessage.error(e.message || t("admin.loadConfigFailed"));
  } finally {
    loading.value = false;
  }
}

const savingSkillDir = ref(false);

async function saveSkillDir() {
  if (loading.value || backendLoadError.value || savingSkillDir.value) {
    if (backendLoadError.value) ElMessage.error(backendLoadError.value);
    return;
  }
  savingSkillDir.value = true;
  try {
    const res = await adminApi.saveToolSkillDir(skilldir.value);
    if (res?.success) {
      ElMessage.success(t("admin.configSaveSuccess"));
    } else {
      ElMessage.error(res?.message || t("admin.saveFailed"));
    }
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    savingSkillDir.value = false;
  }
}

const savingGeneral: Record<string, boolean> = reactive({
  knowledgeMaxResult: false,
  toolAndPythonRetry: false,
  dslCookerTries: false,
  dslCookerTimeout: false,
  questionSpliterTries: false,
  questionSpliterTimeout: false,
  lang: false,
});

async function saveGeneralConfig(key: GeneralConfigKey, value: unknown) {
  savingGeneral[key] = true;
  try {
    const res = await adminApi.saveGeneralConfig(key, value);
    if (res?.success) {
      ElMessage.success(t("admin.configSaveSuccess"));
    } else {
      ElMessage.error(res?.message || t("admin.saveFailed"));
    }
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    savingGeneral[key] = false;
  }
}

async function saveGeneralField(key: GeneralConfigKey) {
  await saveGeneralConfig(key, config[key]);
}

const dataAdapterMode = ref("");
const savingAdapter = ref(false);

async function saveDataAdapter() {
  savingAdapter.value = true;
  try {
    const adapter = dataAdapters.value.find(({ type }) => type === dataAdapterMode.value)!;
    const connection = config.dataAdapterConnections[adapter.type];
    await adminApi.useDataAdapter({
      type: adapter.type,
      ...Object.fromEntries(adapter.fields.map((field) => [field, connection[field]])),
    });
    ElMessage.success(t("admin.switchedDataAdapter", { name: adapter.label }));
    config.dataAdapter = dataAdapterMode.value;
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    savingAdapter.value = false;
  }
}

let systemModel = reactive<SystemModelConfig>({
  models: [],
  agents: { default: { model: "" }, diagnosis: { model: "" } },
  abcQuestionMode: "harness",
  queryTimeoutSeconds: 600,
  hasCustomConfig: false,
});

const loadingSystemModel = ref(false);

async function loadSystemModelConfig() {
  loadingSystemModel.value = true;
  systemLoadError.value = "";
  try {
    const res = await adminApi.getSystemModelConfig();
    if (res?.success) {
      Object.assign(systemModel, res.data as SystemModelConfig);
    } else {
      systemLoadError.value = res?.message || t("admin.loadConfigFailed");
    }
  } catch (e: any) {
    systemLoadError.value = e.message || t("admin.loadConfigFailed");
    ElMessage.error(e.message || t("admin.loadConfigFailed"));
  } finally {
    loadingSystemModel.value = false;
  }
}

const savingQuerySettings = ref(false);

async function saveQuerySettings() {
  if (loadingSystemModel.value || systemLoadError.value) {
    if (systemLoadError.value) ElMessage.error(systemLoadError.value);
    return;
  }
  savingQuerySettings.value = true;
  try {
    const res = await adminApi.saveSystemModelConfig({
      abcQuestionMode: systemModel.abcQuestionMode,
      queryTimeoutSeconds: systemModel.queryTimeoutSeconds,
    });
    if (res?.success) {
      const saved = res.data as SystemModelConfig;
      systemModel.abcQuestionMode = saved.abcQuestionMode;
      systemModel.queryTimeoutSeconds = saved.queryTimeoutSeconds;
      querySettingsRef.value?.markSaved();
      ElMessage.success(t("admin.configSaveSuccess"));
    } else {
      ElMessage.error(res?.message || t("admin.saveFailed"));
    }
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    savingQuerySettings.value = false;
  }
}

onMounted(() => {
  loadConfig();
  loadSystemModelConfig();
});
</script>

<template>
  <div class="system-config-container">
    <QuerySettingsCard
      ref="querySettingsRef"
      v-model:model="systemModel"
      :loading="loadingSystemModel"
      :saving="savingQuerySettings"
      :load-error="systemLoadError"
      @save="saveQuerySettings"
      @retry="loadSystemModelConfig"
    />

    <div v-if="backendLoadError" class="config-load-error" role="alert">
      <span>{{ t("admin.loadConfigFailed") }}{{ businessConfigSeparator }}{{ backendLoadError }}</span>
      <el-button size="small" @click="loadConfig">{{ t("common.retry") }}</el-button>
    </div>

    <SkillDirConfigCard
      v-model:skilldir="skilldir"
      :saving="savingSkillDir"
      :disabled="loading || !!backendLoadError"
      @save="saveSkillDir"
    />

    <GeneralConfigCard
      v-model:config="config"
      :saving="savingGeneral"
      :language-options="languageOptions"
      :default-language="defaultLanguage"
      :disabled="loading || !!backendLoadError"
      @save="saveGeneralField"
    />

    <DataAdapterConfigCard
      v-model:config="config"
      v-model:mode="dataAdapterMode"
      :adapters="dataAdapters"
      :adapter-display="adapterDisplay"
      :saving="savingAdapter"
      :disabled="loading || !!backendLoadError"
      @save="saveDataAdapter"
    />

    <div v-if="queryExamples" class="admin-card config-card examples-card">
      <div class="card-header">
        <el-icon :size="20"><MessagesSquare /></el-icon>
        <span>{{ t("nav.queryExamples") }}</span>
      </div>
      <div class="card-body">
        <ExamplesManager />
      </div>
    </div>
  </div>
</template>

<style scoped src="./business-config/business-config.css"></style>

<style scoped>
.system-config-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}

.config-load-error {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-md);
  margin: var(--spacing-lg) 0;
  border: 1px solid var(--el-color-danger-light-5);
  border-radius: var(--radius-md);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  font-size: var(--text-sm);
  flex-wrap: wrap;
}

.examples-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.examples-card :deep(.examples-manager) {
  height: auto;
  min-height: 520px;
  overflow: visible;
}

.examples-card :deep(.examples-manager .sub-tabs),
.examples-card :deep(.examples-manager .sub-tabs .el-tabs__content),
.examples-card :deep(.examples-manager .sub-tabs .el-tab-pane),
.examples-card :deep(.examples-manager .card-grid) {
  height: auto;
  overflow: visible;
}
</style>
