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
import BackendAgentConfigCard from "./business-config/BackendAgentConfigCard.vue";
import BackendModelListCard from "./business-config/BackendModelListCard.vue";
import EmbeddingModelConfigCard from "./business-config/EmbeddingModelConfigCard.vue";
import SystemModelConfigCard from "./business-config/SystemModelConfigCard.vue";
import TestResultDialog from "./business-config/TestResultDialog.vue";
import { useSystemModelConfig } from "../useSystemModelConfig";
import {
  agentKeys,
  modelLabel,
  type AgentKey,
  type BackendAgentConfig,
  type BackendModelConfig,
  type BusinessConfig,
} from "../types";

// 模型配置页：应用模型（Node）与问数引擎模型（DataRAG）两个页签；问数设置等其他配置在系统配置页。
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
// 保存后端模型列表后的重读错误：保存已成功但本地视图尚未取得服务端规范化结果时的持久状态。
const modelRefreshError = ref("");
const refreshingModels = ref(false);
const activeModelSection = ref("application");
const backendListRef = ref<{ markSaved: () => void } | null>(null);
const systemCardRef = ref<{ markSaved: () => void } | null>(null);

const config = reactive<Pick<BusinessConfig, "models" | "agents" | "embeddingModelProperties">>({
  models: [],
  agents: {
    normalChat: emptyBackendAgent(),
    questionSpliter: emptyBackendAgent(),
    cleverNormalChat: emptyBackendAgent(),
    pythonChat: emptyBackendAgent(),
    toolChat: emptyBackendAgent(),
  },
  embeddingModelProperties: null,
});

// 已保存模型：角色选项只认它，草稿里新增但未保存的模型不进入角色引用。
const savedModels = ref<Pick<BackendModelConfig, "name" | "displayName">[]>([]);

function markModelsSaved() {
  savedModels.value = config.models.map(({ name, displayName }) => ({ name, displayName }));
}

// 模型列表的错误态：既覆盖首次加载失败，也覆盖保存成功后的重读失败。
const backendModelError = computed(() => backendLoadError.value || modelRefreshError.value);

async function loadConfig() {
  loading.value = true;
  backendLoadError.value = "";
  modelRefreshError.value = "";
  try {
    const res = await adminApi.getBusinessConfig();
    if (res?.success) {
      const data = res.data as BusinessConfig;
      config.models = data.models ?? [];
      markModelsSaved();
      const savedAgents = data.agents;
      for (const role of agentKeys) {
        const saved = savedAgents?.[role];
        config.agents[role] = saved ? { ...emptyBackendAgent(), ...saved } : emptyBackendAgent();
      }
      // 外部响应缺这项时保持“未配置”，不伪造一条默认模型行。
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

const savingBackendModels = ref(false);

async function saveBackendModels() {
  // C1：加载失败或尚未成功时阻止空快照覆盖保存。
  if (loading.value || backendModelError.value || savingBackendModels.value) {
    if (backendModelError.value) ElMessage.error(backendModelError.value);
    return;
  }
  savingBackendModels.value = true;
  try {
    const res = await adminApi.saveBackendModels(config.models.map((entry) => plainOuter(entry)));
    if (res?.success) {
      backendListRef.value?.markSaved();
      ElMessage.success(t("admin.modelSaveSuccess"));
      // 保存响应不带模型列表，服务端还会规范化自定义参数，按服务端结果重读。
      await refreshSavedModels();
    } else {
      ElMessage.error(res?.message || t("admin.saveFailed"));
    }
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    savingBackendModels.value = false;
  }
}

// 只回填 models 与已保存名称，未保存的角色/Embedding 草稿不动。
async function refreshSavedModels() {
  refreshingModels.value = true;
  modelRefreshError.value = "";
  try {
    const res = await adminApi.getBusinessConfig();
    if (res?.success) {
      config.models = (res.data as BusinessConfig).models ?? [];
      markModelsSaved();
      backendListRef.value?.markSaved();
    } else {
      modelRefreshError.value = res?.message || t("admin.modelRefreshFailed");
    }
  } catch (e: any) {
    modelRefreshError.value = e.message || t("admin.modelRefreshFailed");
  } finally {
    refreshingModels.value = false;
  }
}

function retryBackendModels() {
  // 重读失败时只重读模型列表，不能回退到整页 loadConfig 冲掉其他草稿。
  if (backendLoadError.value) return loadConfig();
  return refreshSavedModels();
}

const savingAgentModels = ref(false);

async function saveBackendAgentModels() {
  if (loading.value || backendLoadError.value || savingAgentModels.value) {
    if (backendLoadError.value) ElMessage.error(backendLoadError.value);
    return;
  }
  savingAgentModels.value = true;
  try {
    // 五个角色一次提交，只带引用；actorCopies 与 skilldir 由服务端保留。
    const modelsByRole: Record<AgentKey, string> = {
      normalChat: config.agents.normalChat.model,
      questionSpliter: config.agents.questionSpliter.model,
      cleverNormalChat: config.agents.cleverNormalChat.model,
      pythonChat: config.agents.pythonChat.model,
      toolChat: config.agents.toolChat.model,
    };
    const res = await adminApi.saveBackendAgentModels(modelsByRole);
    if (res?.success) {
      ElMessage.success(t("admin.modelSaveSuccess"));
    } else {
      ElMessage.error(res?.message || t("admin.saveFailed"));
    }
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    savingAgentModels.value = false;
  }
}

const savingEmbedding = ref(false);

async function saveEmbeddingConfig() {
  // C1：加载失败或尚未成功时阻止空快照覆盖保存。
  if (loading.value || backendLoadError.value || savingEmbedding.value) {
    if (backendLoadError.value) ElMessage.error(backendLoadError.value);
    return;
  }
  const m = config.embeddingModelProperties;
  if (!m) return;
  savingEmbedding.value = true;
  try {
    // 整条快照提交：保留 customHeaders 等未在弹窗展示的字段。
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

const backendTestDialogVisible = ref(false);
const backendTestModel = ref<BackendModelConfig | null>(null);
const backendTestContent = ref("");
const backendTestResult = ref("");
const backendTestRunning = ref(false);
const renderedBackendTestResult = computed(() => renderMarkdown(backendTestResult.value));

function openBackendModelTest(model: BackendModelConfig) {
  backendTestModel.value = model;
  backendTestContent.value = "";
  backendTestResult.value = "";
  backendTestDialogVisible.value = true;
}

async function runBackendModelTest() {
  if (!backendTestContent.value.trim()) {
    ElMessage.warning(t("common.enterTestContent"));
    return;
  }
  if (!backendTestModel.value) return;
  backendTestRunning.value = true;
  backendTestResult.value = "";
  try {
    const res = await adminApi.testBackendModel(
      plainOuter(backendTestModel.value),
      backendTestContent.value
    );
    backendTestResult.value = formatTestResponse(res);
  } catch (e: any) {
    backendTestResult.value = `${t("admin.testFailed")}: ${e.message || t("common.unknownError")}`;
  } finally {
    backendTestRunning.value = false;
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

const { systemModel, loadingSystemModel, systemLoadError, loadSystemModelConfig } =
  useSystemModelConfig();
const savingSystemModel = ref(false);

async function saveSystemModelConfig() {
  // C1：加载失败或尚未成功时阻止空快照覆盖保存。
  if (loadingSystemModel.value || systemLoadError.value) {
    if (systemLoadError.value) ElMessage.error(systemLoadError.value);
    return;
  }
  savingSystemModel.value = true;
  try {
    // 部分更新：只提交本区字段，问数设置草稿不随应用模型保存。
    const res = await adminApi.saveSystemModelConfig({
      models: systemModel.models.map((entry) => plainOuter(entry)),
      agents: systemModel.agents,
    });
    if (res?.success) {
      const saved = res.data as SystemModelConfig;
      systemModel.models = saved.models;
      systemModel.agents = saved.agents;
      systemModel.hasCustomConfig = saved.hasCustomConfig;
      systemCardRef.value?.markSaved();
      ElMessage.success(t("admin.systemModelSaveSuccess"));
    } else {
      ElMessage.error(res?.message || t("admin.saveFailed"));
    }
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    savingSystemModel.value = false;
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
    // 先整条解代理：含 __v_isRef 的用户对象经代理读会被当 ref 解包。
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

onMounted(() => {
  loadConfig();
  loadSystemModelConfig();
});
</script>

<template>
  <div class="system-config-container">
    <el-tabs v-model="activeModelSection" class="model-type-tabs">
      <el-tab-pane :label="t('admin.applicationModels')" name="application">
        <SystemModelConfigCard
          ref="systemCardRef"
          v-model:model="systemModel"
          :loading="loadingSystemModel"
          :saving="savingSystemModel"
          :load-error="systemLoadError"
          @save="saveSystemModelConfig"
          @test="openSystemModelTest"
          @retry="loadSystemModelConfig"
        />
      </el-tab-pane>
      <el-tab-pane :label="t('admin.queryEngineModels')" name="queryEngine">
        <BackendModelListCard
          ref="backendListRef"
          v-model:models="config.models"
          :saving="savingBackendModels"
          :loading="loading || refreshingModels"
          :load-error="backendModelError"
          @save="saveBackendModels"
          @test="openBackendModelTest"
          @retry="retryBackendModels"
        />

        <BackendAgentConfigCard
          v-model:agents="config.agents"
          :models="savedModels"
          :saving="savingAgentModels"
          :disabled="loading || refreshingModels || !!backendLoadError"
          @save="saveBackendAgentModels"
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
      </el-tab-pane>
    </el-tabs>

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
      v-model:visible="backendTestDialogVisible"
      v-model:content="backendTestContent"
      :title="t('admin.testModelNamed', { name: backendTestModel && modelLabel(backendTestModel) })"
      :result="backendTestResult"
      :rendered-result="renderedBackendTestResult"
      :running="backendTestRunning"
      :placeholder="t('common.enterTestMessage')"
      @submit="runBackendModelTest"
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
/* 宽度跟随后台主区；具体输入控件各自限宽。 */
.system-config-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}

.model-type-tabs,
.model-type-tabs :deep(.el-tabs__content) {
  min-width: 0;
}

/* Element Plus 页签内容默认 overflow:hidden，会裁掉卡片阴影；本页不用页签切换动画。 */
.model-type-tabs :deep(.el-tabs__content) {
  overflow: visible;
}

.model-type-tabs :deep(.config-card + .config-card) {
  margin-top: var(--spacing-lg);
}

/* 模型类型页签用分段样式。 */
.model-type-tabs :deep(.el-tabs__header) {
  margin-bottom: var(--spacing-lg);
}

.model-type-tabs :deep(.el-tabs__nav-wrap::after),
.model-type-tabs :deep(.el-tabs__active-bar) {
  display: none;
}

.model-type-tabs :deep(.el-tabs__nav) {
  gap: var(--spacing-xs);
  padding: var(--spacing-xs);
  border-radius: var(--radius-md);
  background: var(--el-fill-color-light);
}

/* :nth-child(n) 压过 Element 对首尾页签清零左右内边距的规则。 */
.model-type-tabs :deep(.el-tabs__header .el-tabs__item:nth-child(n)) {
  height: 32px;
  padding: 0 var(--spacing-lg);
  border-radius: calc(var(--radius-md) - var(--spacing-xs));
  color: var(--el-text-color-regular);
}

.model-type-tabs :deep(.el-tabs__header .el-tabs__item.is-active) {
  background: var(--el-bg-color);
  color: var(--el-color-primary);
}
</style>
