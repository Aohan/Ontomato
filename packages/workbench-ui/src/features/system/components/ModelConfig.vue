<script setup lang="ts">
import type {
  SystemModelConfigResponse as SystemModelConfig,
  SystemModelEntry,
} from "@ontomato/contracts/system-model";

import type { SystemModelTestEvent } from "@ontomato/contracts/system-model";
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage } from "element-plus";
import { adminApi } from "../../admin";
import { renderMarkdown } from "../../../utils/markdown";
import { plainOuter } from "../utils/raw";
import { useI18n } from "vue-i18n";
import EmbeddingModelConfigCard from "./business-config/EmbeddingModelConfigCard.vue";
import RoleReferencesCard from "./business-config/RoleReferencesCard.vue";
import SystemModelConfigCard from "./business-config/SystemModelConfigCard.vue";
import TestResultDialog from "./business-config/TestResultDialog.vue";
import {
  agentKeys,
  formatTimeout,
  modelLabel,
  type AgentKey,
  type BackendAgentConfig,
  type BackendModelConfig,
} from "../types";

const { t } = useI18n();

function emptyBackendAgent(): BackendAgentConfig {
  return { model: "", actorCopies: 1 };
}

function formatTestResponse(res: unknown): string {
  if (typeof res === "string") return res;
  if (res && typeof res === "object") {
    const record = res as Record<string, unknown>;
    const data = record.data;
    if (typeof data === "string") return data;
    if (data && typeof data === "object") {
      const dataRecord = data as Record<string, unknown>;
      const content = dataRecord.content ?? dataRecord.message ?? dataRecord.result;
      if (typeof content === "string") return content;
    }
    const content = record.content ?? record.message ?? record.result;
    if (typeof content === "string") return content;
  }
  return JSON.stringify(res, null, 2);
}

const loading = ref(false);
const backendLoadError = ref("");
const systemLoadError = ref("");
const saving = ref(false);
const systemCardRef = ref<{ markSaved: () => void } | null>(null);

// A single model library: system models (SystemModelEntry) are the only source and every role refers to the same list.
let systemModel = reactive<SystemModelConfig>({
  models: [],
  agents: { default: { model: "" }, diagnosis: { model: "" } },
  abcQuestionMode: "harness",
  queryTimeoutSeconds: 600,
  hasCustomConfig: false,
});

// Query engine roles and Embedding are still stored in the business config (data engine); this page forwards them.
let config = reactive<{
  agents: Record<AgentKey, BackendAgentConfig>;
  embeddingModelProperties: {
    baseUrl: string;
    apiKey: string;
    modelName: string;
    timeout: string;
    customHeaders?: Record<string, string> | null;
  } | null;
}>({
  agents: {
    normalChat: emptyBackendAgent(),
    questionSpliter: emptyBackendAgent(),
    cleverNormalChat: emptyBackendAgent(),
    pythonChat: emptyBackendAgent(),
    toolChat: emptyBackendAgent(),
  },
  embeddingModelProperties: null,
});

// Role options accept only the saved model library; an unselected role defaults to the first model.
const savedModels = computed(() =>
  systemModel.models.map(({ name, displayName }) => ({ name, displayName }))
);

function ensureRoleDefaults() {
  const first = systemModel.models[0]?.name;
  if (!first) return;
  if (!systemModel.agents.default.model) systemModel.agents.default.model = first;
  if (!systemModel.agents.diagnosis.model) systemModel.agents.diagnosis.model = first;
  for (const role of agentKeys) {
    if (!config.agents[role].model) config.agents[role].model = first;
  }
}

/** Maps the single model library to the query engine backend model shape (single key → key array, seconds → ISO duration). */
function toBackendModel(entry: SystemModelEntry): BackendModelConfig {
  return {
    name: entry.name,
    displayName: entry.displayName,
    baseUrl: entry.baseUrl,
    apiKeys: entry.apiKey ? [entry.apiKey] : [],
    modelName: entry.modelName,
    timeout: formatTimeout(entry.timeoutSeconds),
    maxRetries: entry.maxRetries,
    temperature: null,
    topP: null,
    maxTokens: null,
    maxCompletionTokens: null,
    customRequestParameters: entry.customRequestParameters,
  };
}

async function loadConfig() {
  loading.value = true;
  backendLoadError.value = "";
  try {
    const res = await adminApi.getBusinessConfig();
    if (res?.success) {
      const data = res.data as {
        agents?: Record<AgentKey, BackendAgentConfig>;
        embeddingModelProperties?: (typeof config)["embeddingModelProperties"];
      };
      const savedAgents = data.agents;
      for (const role of agentKeys) {
        const saved = savedAgents?.[role];
        config.agents[role] = saved ? { ...emptyBackendAgent(), ...saved } : emptyBackendAgent();
      }
      config.embeddingModelProperties = data.embeddingModelProperties ?? null;
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

// The combined view has one save action: the model list and role references are saved together (system model config is stored by Node, query engine settings are forwarded to the data engine).
const saveDisabled = computed(
  () =>
    loading.value ||
    loadingSystemModel.value ||
    !!systemLoadError.value ||
    !!backendLoadError.value
);

async function saveAll() {
  if (saveDisabled.value) {
    if (systemLoadError.value) ElMessage.error(systemLoadError.value);
    else if (backendLoadError.value) ElMessage.error(backendLoadError.value);
    return;
  }
  ensureRoleDefaults();
  saving.value = true;
  try {
    // 1. Store the model list and system roles (System model / Diagnosis model) in the system model config.
    const res = await adminApi.saveSystemModelConfig({
      models: systemModel.models.map((entry) => plainOuter(entry)),
      agents: systemModel.agents,
    });
    if (!res?.success) {
      ElMessage.error(res?.message || t("admin.saveFailed"));
      return;
    }
    const saved = res.data as SystemModelConfig;
    systemModel.models = saved.models;
    systemModel.agents = saved.agents;
    systemModel.hasCustomConfig = saved.hasCustomConfig;
    systemCardRef.value?.markSaved();

    // 2. Forward the single model library to the query engine model list.
    try {
      await adminApi.saveBackendModels(systemModel.models.map(toBackendModel));
    } catch {
      /* A failed query engine model forward does not block saving */
    }
    // 3. Store the five query engine roles in the business config.
    try {
      await adminApi.saveBackendAgentModels({
        normalChat: config.agents.normalChat.model,
        questionSpliter: config.agents.questionSpliter.model,
        cleverNormalChat: config.agents.cleverNormalChat.model,
        pythonChat: config.agents.pythonChat.model,
        toolChat: config.agents.toolChat.model,
      });
    } catch {
      /* A failed query engine role forward does not block saving */
    }
    ElMessage.success(t("admin.modelSaveSuccess"));
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    saving.value = false;
  }
}

const savingEmbedding = ref(false);

async function saveEmbeddingConfig() {
  if (loading.value || backendLoadError.value || savingEmbedding.value) {
    if (backendLoadError.value) ElMessage.error(backendLoadError.value);
    return;
  }
  const m = config.embeddingModelProperties;
  if (!m) return;
  savingEmbedding.value = true;
  try {
    const res = await adminApi.saveEmbeddingModel(plainOuter(m));
    if (res?.success) {
      ElMessage.success(t("admin.embeddingSaveSuccess"));
    } else {
      ElMessage.error(res?.message || t("admin.saveFailed"));
    }
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    savingEmbedding.value = false;
  }
}

const systemTestDialogVisible = ref(false);
const systemTestEntry = ref<SystemModelEntry | null>(null);
const systemTestContent = ref("");
const systemTestResult = ref("");
const systemTestRunning = ref(false);

const renderedSystemTestResult = computed(() => renderMarkdown(systemTestResult.value));

function openSystemModelTest(entry: SystemModelEntry) {
  systemTestEntry.value = entry;
  systemTestContent.value = "";
  systemTestResult.value = "";
  systemTestDialogVisible.value = true;
}

async function runSystemModelTest() {
  if (!systemTestContent.value.trim()) {
    ElMessage.warning(t("common.enterTestContent"));
    return;
  }
  if (!systemTestEntry.value) return;
  systemTestRunning.value = true;
  systemTestResult.value = "";
  try {
    const entry = plainOuter<SystemModelEntry>(systemTestEntry.value);
    const res = await adminApi.testSystemModelConfig({
      name: entry.name,
      baseUrl: entry.baseUrl,
      apiKey: entry.apiKey,
      modelName: entry.modelName,
      customRequestParameters: entry.customRequestParameters,
      timeoutSeconds: entry.timeoutSeconds,
      userContent: systemTestContent.value,
    });

    const reader = res.body?.getReader();
    if (!reader) {
      systemTestResult.value = t("admin.testFailed");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = JSON.parse(line.slice(6)) as SystemModelTestEvent;
          if (data.type === "error") {
            systemTestResult.value = data.error;
          } else if (data.done) {
            // completed
          } else if (data.content) {
            systemTestResult.value += data.content;
          }
        }
      }
    }
  } catch (e: any) {
    systemTestResult.value = `${t("admin.testFailed")}: ${e.message || t("common.unknownError")}`;
  } finally {
    systemTestRunning.value = false;
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
  const m = config.embeddingModelProperties;
  if (!m) return;
  testEmbeddingRunning.value = true;
  testEmbeddingResult.value = "";
  try {
    const res = await adminApi.testEmbeddingModel({
      modelConfig: plainOuter(m),
      userContent: testEmbeddingContent.value,
    });
    testEmbeddingResult.value = formatTestResponse(res);
  } catch (e: any) {
    testEmbeddingResult.value = `${t("admin.testFailed")}: ${e.message || t("common.unknownError")}`;
  } finally {
    testEmbeddingRunning.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadConfig(), loadSystemModelConfig()]);
  ensureRoleDefaults();
});
</script>

<template>
  <div class="model-config-container">
    <SystemModelConfigCard
      ref="systemCardRef"
      v-model:model="systemModel"
      :loading="loadingSystemModel"
      :saving="saving"
      :load-error="systemLoadError"
      @test="openSystemModelTest"
      @retry="loadSystemModelConfig"
    />

    <RoleReferencesCard
      v-model:system-agents="systemModel.agents"
      v-model:query-agents="config.agents"
      :models="savedModels"
      :saving="saving"
      :disabled="saveDisabled"
      @save="saveAll"
    />

    <EmbeddingModelConfigCard
      v-model:model="config.embeddingModelProperties"
      :loading="loading"
      :saving="savingEmbedding"
      :load-error="backendLoadError"
      @save="saveEmbeddingConfig"
      @test="testEmbeddingDialogVisible = true"
      @retry="loadConfig"
    />

    <TestResultDialog
      v-model:visible="systemTestDialogVisible"
      v-model:content="systemTestContent"
      :title="t('admin.testModelNamed', { name: systemTestEntry && modelLabel(systemTestEntry) })"
      :result="systemTestResult"
      :rendered-result="renderedSystemTestResult"
      :running="systemTestRunning"
      :placeholder="t('common.enterTestMessage')"
      @submit="runSystemModelTest"
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

<style scoped>
.model-config-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}

.model-config-container :deep(.config-card + .config-card) {
  margin-top: 0;
}
</style>
