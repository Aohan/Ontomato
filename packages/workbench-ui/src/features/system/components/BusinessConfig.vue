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
import { workbenchContent } from "../../../content";
import BackendAgentConfigCard from "./business-config/BackendAgentConfigCard.vue";
import BackendModelListCard from "./business-config/BackendModelListCard.vue";
import DataAdapterConfigCard from "./business-config/DataAdapterConfigCard.vue";
import EmbeddingModelConfigCard from "./business-config/EmbeddingModelConfigCard.vue";
import GeneralConfigCard from "./business-config/GeneralConfigCard.vue";
import QuerySettingsCard from "./business-config/QuerySettingsCard.vue";
import SkillDirConfigCard from "./business-config/SkillDirConfigCard.vue";
import SystemModelConfigCard from "./business-config/SystemModelConfigCard.vue";
import TestResultDialog from "./business-config/TestResultDialog.vue";
import {
  agentKeys,
  modelLabel,
  type AgentKey,
  type BackendAgentConfig,
  type BackendModelConfig,
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
const systemLoadError = ref("");
const activeSection = ref("models");
const activeModelSection = ref("application");
const backendListRef = ref<{ markSaved: () => void } | null>(null);
const systemCardRef = ref<{ markSaved: () => void } | null>(null);
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
// 本版本后端已安装的数据适配器，随业务配置一起加载。
const dataAdapters = ref<DataAdapterInfo[]>([]);

// 已保存模型：角色选项只认它，草稿里新增但未保存的模型不进入角色引用。
const savedModels = ref<Pick<BackendModelConfig, "name" | "displayName">[]>([]);
// 技能目录草稿：加载失败或保存失败时保留，切导航与模型保存都不动它。
const skilldir = ref("");

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
    const [res, adaptersRes] = await Promise.all([
      adminApi.getBusinessConfig(),
      adminApi.listDataAdapters(),
    ]);
    if (res?.success) {
      dataAdapters.value = adaptersRes.data;
      const data = res.data as BusinessConfig;
      config.models = data.models ?? [];
      markModelsSaved();
      const savedAgents = data.agents;
      for (const role of agentKeys) {
        const saved = savedAgents?.[role];
        config.agents[role] = saved ? { ...emptyBackendAgent(), ...saved } : emptyBackendAgent();
      }
      skilldir.value = savedAgents?.toolChat?.skilldir ?? "";
      // 外部响应缺这项时保持“未配置”，不伪造一条默认模型行。
      config.embeddingModelProperties = data.embeddingModelProperties ?? null;
      config.knowledgeMaxResult = data.knowledgeMaxResult ?? 10;
      config.toolAndPythonRetry = data.toolAndPythonRetry ?? 0;
      config.dslCookerTries = data.dslCookerTries ?? 1;
      config.dslCookerTimeout = data.dslCookerTimeout ?? 300000;
      config.questionSpliterTries = data.questionSpliterTries ?? 1;
      config.questionSpliterTimeout = data.questionSpliterTimeout ?? 300000;
      config.lang = data.lang || props.defaultLanguage;
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

// 只回填 models 与已保存名称，未保存的角色/技能/Embedding/其他区域草稿不动。
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
    // 只提交该类型声明的连接字段；有字段的类型其连接对象由卡片表单建立。
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

let systemModel = reactive<SystemModelConfig>({
  models: [],
  agents: { default: { model: "" }, diagnosis: { model: "" } },
  abcQuestionMode: "harness",
  queryTimeoutSeconds: 600,
  hasCustomConfig: false,
});

const loadingSystemModel = ref(false);
const savingSystemModel = ref(false);

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

const savingQuerySettings = ref(false);

async function saveQuerySettings() {
  if (loadingSystemModel.value || systemLoadError.value) {
    if (systemLoadError.value) ElMessage.error(systemLoadError.value);
    return;
  }
  savingQuerySettings.value = true;
  try {
    // 部分更新：只提交问数设置，应用模型草稿不随之保存。
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
    <el-tabs v-model="activeSection" class="model-section-tabs">
      <el-tab-pane :label="t('admin.modelConfig')" name="models">
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
      </el-tab-pane>
      <el-tab-pane :label="t('admin.otherSettings')" name="other">
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
          :language-labels="languageLabels"
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

.model-section-tabs,
.model-section-tabs :deep(.el-tabs__content) {
  min-width: 0;
}

/* Element Plus 页签内容默认 overflow:hidden，会裁掉卡片阴影；本页不用页签切换动画。 */
.model-section-tabs :deep(.el-tabs__content) {
  overflow: visible;
}

.model-section-tabs :deep(.config-card + .config-card) {
  margin-top: var(--spacing-lg);
}

/* 二级页签用分段样式，与顶层下划线页签区分层级。 */
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

/* 其他配置区的持久错误说明（接在问数设置之后，只针对下方业务配置）：与卡片内错误块同形，避免只靠会消失的 toast。 */
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
</style>
