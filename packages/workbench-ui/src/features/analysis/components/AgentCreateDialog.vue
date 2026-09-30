<script setup lang="ts">
import type {
  AnalysisAgent,
  AnalysisReportSummaryPosition,
  AnalysisAgentExecutionMode,
} from "@ontomato/contracts/analysis-agent";

import { ref, computed, watch } from "vue";
import { ElMessage } from "element-plus";
import { BarChart3, Cog, Flame, Settings } from "lucide-vue-next";
import { analysisAgentApi, analysisReportApi } from "../api";
import type { AnalysisReportHotCardSummary } from "@ontomato/contracts/analysis-report";
import type { AnalysisSkill } from "../../skills/api";
import { listMcpServiceNames } from "../../mcp/api";
import { queryViewApi } from "../../query-view";
import SkillSelector from "../../admin/components/SkillSelector.vue";
import {
  AgentBasicInfoFields,
  darkAvatarColorOptions,
  lightAvatarColorOptions,
} from "../../workbench";
import { useI18n } from "vue-i18n";
import { useTheme } from "../../../composables/useTheme";

const { t } = useI18n();

const emit = defineEmits<{
  "update:visible": [value: boolean];
  created: [];
  updated: [];
}>();

const props = defineProps<{
  visible: boolean;
  editingAgent: AnalysisAgent | null;
  /**
   * Original display passed by the open-source layout: required asterisk on the right, MCP dropdown as wide as the input,
   * wrapping form labels. Layouts that omit it keep both Element Plus attributes unset and labels unwrapped.
   */
  requireAsteriskPosition?: "left" | "right";
  fitInputWidth?: boolean;
  labelWrap?: boolean;
}>();

const { isDark } = useTheme();
const avatarColorOptions = computed(() =>
  isDark.value ? darkAvatarColorOptions : lightAvatarColorOptions
);
const defaultAvatarColor = computed(() => avatarColorOptions.value[0]);

function normalizeAvatarColor(color: string): string {
  const lightColorIndex = lightAvatarColorOptions.indexOf(color);
  const darkColorIndex = darkAvatarColorOptions.indexOf(color);
  if (isDark.value) {
    if (lightColorIndex >= 0) return darkAvatarColorOptions[lightColorIndex];
    return darkColorIndex >= 0 ? color : defaultAvatarColor.value;
  }
  if (darkColorIndex >= 0) return lightAvatarColorOptions[darkColorIndex];
  return lightColorIndex >= 0 ? color : defaultAvatarColor.value;
}

const isEditing = computed(() => !!props.editingAgent?.id);

const saving = ref(false);
const visualizationSkills = ref<AnalysisSkill[] | null>(null);
const objectClasses = ref<ObjectClassOption[]>([]);
const classesLoading = ref(false);
const externalMcpServiceNames = ref<string[]>([]);
const mcpServicesLoading = ref(false);
const mcpServicesLoadFailed = ref(false);
const hotReports = ref<AnalysisReportHotCardSummary[]>([]);
const hotReportsLoading = ref(false);
const hotReportsLoadFailed = ref(false);
const hotReportsSaving = ref<Set<string>>(new Set());
async function loadHotReports(agentId: string) {
  hotReportsLoading.value = true;
  hotReportsLoadFailed.value = false;
  try {
    hotReports.value = await analysisAgentApi.listHotReports(agentId);
  } catch {
    hotReportsLoadFailed.value = true;
    hotReports.value = [];
  } finally {
    hotReportsLoading.value = false;
  }
}

async function toggleHotReport(card: AnalysisReportHotCardSummary, enabled: boolean) {
  hotReportsSaving.value.add(card.id);
  try {
    await analysisReportApi.updateCardStatus(card.id, enabled ? "PUBLISHED" : "UNUSED");
    card.status = enabled ? "PUBLISHED" : "UNUSED";
  } catch {
    ElMessage.error(t("admin.hotReportToggleFailed"));
  } finally {
    hotReportsSaving.value.delete(card.id);
  }
}

function onHotReportToggle(card: AnalysisReportHotCardSummary, val: string | number | boolean) {
  void toggleHotReport(card, Boolean(val));
}

async function loadExternalMcpServices() {
  mcpServicesLoading.value = true;
  mcpServicesLoadFailed.value = false;
  try {
    externalMcpServiceNames.value = await listMcpServiceNames();
  } catch {
    mcpServicesLoadFailed.value = true;
  } finally {
    mcpServicesLoading.value = false;
  }
}

interface ObjectClassOption {
  className: string;
  showName?: string;
  classDesc?: string;
}

function getClassLabel(cls: ObjectClassOption): string {
  const displayName = cls.showName || cls.classDesc || cls.className;
  return displayName === cls.className ? cls.className : `${displayName} (${cls.className})`;
}

async function loadObjectClasses() {
  classesLoading.value = true;
  try {
    const json = await queryViewApi.getMetas();
    objectClasses.value = Array.isArray(json.data?.classDef)
      ? json.data.classDef
          .map((cls: any) => ({
            className: String(cls.className || ""),
            showName: cls.showName || "",
            classDesc: cls.classDesc || "",
          }))
          .filter((cls: ObjectClassOption) => cls.className)
      : [];
  } catch {
    objectClasses.value = [];
  } finally {
    classesLoading.value = false;
  }
}

function getDefaultVisualizationSkillIds(): string[] | undefined {
  return visualizationSkills.value?.filter((skill) => skill.enabled).map((skill) => skill.id);
}

function handleVisualizationSkillsLoaded(skills: AnalysisSkill[]) {
  visualizationSkills.value = skills;
  if (!isEditing.value && form.value.enabledVisualizationSkillIds === undefined) {
    form.value.enabledVisualizationSkillIds = getDefaultVisualizationSkillIds();
  }
}

const form = ref({
  name: "",
  description: "",
  executionMode: "loop" as AnalysisAgentExecutionMode,
  loopPrompt: "",
  reportDeliverableEnabled: true,
  hotReportEnabled: true,
  summaryPosition: "bottom" as AnalysisReportSummaryPosition,
  enabledMcpServiceNames: [] as string[],
  analysisDimensionPrompt: "",
  summarizerPrompt: "",
  conclusionMakerPrompt: "",
  enabledSkillIds: [] as string[],
  enabledVisualizationSkillIds: undefined as string[] | undefined,
  classNames: [] as string[],
  isEnabled: true,
  sortOrder: 0 as number,
  avatarKey: "Brain",
  avatarColor: defaultAvatarColor.value,
});

/** Loop mode does not use the three-part dimension-config / dimension-orchestration prompts; its business control surface is the loop prompt. */
const isLoopMode = computed(() => form.value.executionMode === "loop");

const showDialog = computed({
  get: () => props.visible,
  set: (val: boolean) => emit("update:visible", val),
});

function fillFormFromAgent(agent: AnalysisAgent) {
  let avatarKey = "Brain";
  let avatarColor = defaultAvatarColor.value;
  try {
    if (agent.icon) {
      const parsed = typeof agent.icon === "string" ? JSON.parse(agent.icon) : agent.icon;
      if (parsed.key) avatarKey = parsed.key;
      if (parsed.color) avatarColor = normalizeAvatarColor(parsed.color);
    }
  } catch {
    /* ignore */
  }

  form.value = {
    name: agent.name,
    description: agent.description,
    executionMode: agent.executionMode === "loop" ? "loop" : "dimension",
    loopPrompt: agent.loopPrompt || "",
    reportDeliverableEnabled: agent.reportDeliverableEnabled !== false,
    hotReportEnabled: agent.hotReportEnabled !== false,
    summaryPosition: agent.summaryPosition === "top" ? "top" : "bottom",
    enabledMcpServiceNames: agent.enabledMcpServiceNames || [],
    analysisDimensionPrompt: agent.analysisDimensionPrompt || "",
    summarizerPrompt: agent.summarizerPrompt || "",
    conclusionMakerPrompt: agent.conclusionMakerPrompt || "",
    enabledSkillIds: agent.enabledSkillIds || [],
    enabledVisualizationSkillIds: agent.enabledVisualizationSkillIds || [],
    classNames: agent.classNames || [],
    isEnabled: agent.isEnabled,
    sortOrder: agent.sortOrder ?? 0,
    avatarKey,
    avatarColor,
  };
}

function resetForm() {
  form.value = {
    name: "",
    description: "",
    executionMode: "loop",
    loopPrompt: "",
    reportDeliverableEnabled: true,
    hotReportEnabled: true,
    summaryPosition: "bottom",
    enabledMcpServiceNames: [],
    analysisDimensionPrompt: "",
    summarizerPrompt: "",
    conclusionMakerPrompt: "",
    enabledSkillIds: [],
    enabledVisualizationSkillIds: getDefaultVisualizationSkillIds(),
    classNames: [],
    isEnabled: true,
    sortOrder: 0,
    avatarKey: "Brain",
    avatarColor: defaultAvatarColor.value,
  };
}

async function handleSubmit() {
  if (!form.value.name.trim()) {
    ElMessage.warning(t("analysis.agentNameRequired"));
    return;
  }

  saving.value = true;
  const payload = {
    ...form.value,
    icon: JSON.stringify({ key: form.value.avatarKey, color: form.value.avatarColor }),
  };
  delete (payload as any).avatarKey;
  delete (payload as any).avatarColor;

  try {
    if (isEditing.value && props.editingAgent) {
      await analysisAgentApi.updateAgent(props.editingAgent.id, payload);
      ElMessage.success(t("analysis.agentUpdated"));
      emit("updated");
    } else {
      await analysisAgentApi.createAgent(payload);
      ElMessage.success(t("analysis.agentCreated"));
      emit("created");
    }
    resetForm();
    emit("update:visible", false);
  } catch (e: any) {
    ElMessage.error(
      e?.message || (isEditing.value ? t("analysis.updateFailed") : t("analysis.createFailed"))
    );
  } finally {
    saving.value = false;
  }
}

watch(
  () => props.visible,
  (val) => {
    if (val) {
      if (objectClasses.value.length === 0) {
        loadObjectClasses();
      }
      loadExternalMcpServices();
      if (props.editingAgent) {
        fillFormFromAgent(props.editingAgent);
        if (props.editingAgent.id) {
          loadHotReports(props.editingAgent.id);
        }
      } else {
        resetForm();
      }
    }
  }
);

watch(
  () => form.value.reportDeliverableEnabled,
  (enabled) => {
    if (!enabled) form.value.executionMode = "loop";
  }
);

watch(isDark, () => {
  form.value.avatarColor = normalizeAvatarColor(form.value.avatarColor);
});
</script>

<template>
  <el-dialog
    v-model="showDialog"
    :title="isEditing ? t('admin.editAgent') : t('admin.newAgent')"
    width="min(1000px, calc(100vw - 24px))"
    align-center
    @close="resetForm"
  >
    <div
      :class="[
        'agent-form-layout',
        labelWrap ? 'agent-form-layout--label-wrap' : 'agent-form-layout--label-nowrap',
      ]"
    >
      <!-- Left: basic info and prompts -->
      <div class="form-left">
        <h4 class="section-title">{{ t("common.basicInfo") }}</h4>
        <el-form
          :model="form"
          label-width="110px"
          :require-asterisk-position="requireAsteriskPosition"
          size="default"
        >
          <AgentBasicInfoFields
            v-model:name="form.name"
            v-model:description="form.description"
            v-model:avatar-key="form.avatarKey"
            v-model:avatar-color="form.avatarColor"
          >
            <el-form-item :label="t('admin.productMode')" required>
              <el-radio-group
                v-model="form.reportDeliverableEnabled"
                :aria-label="t('admin.productMode')"
              >
                <el-radio :value="true">{{ t("admin.productModeAnalysis") }}</el-radio>
                <el-radio :value="false">{{ t("admin.productModeHarness") }}</el-radio>
              </el-radio-group>
              <p class="form-tip">
                {{
                  form.reportDeliverableEnabled
                    ? t("admin.productModeAnalysisHint")
                    : t("admin.productModeHarnessHint")
                }}
              </p>
            </el-form-item>
            <el-form-item :label="t('admin.executionMode')" required>
              <el-radio-group
                v-if="form.reportDeliverableEnabled"
                v-model="form.executionMode"
                :aria-label="t('admin.executionMode')"
              >
                <el-radio value="dimension">{{ t("admin.executionModeDimension") }}</el-radio>
                <el-radio value="loop">{{ t("admin.executionModeLoop") }}</el-radio>
              </el-radio-group>
              <span v-else>{{ t("admin.executionModeLoop") }}</span>
              <p class="form-tip">
                {{
                  form.reportDeliverableEnabled
                    ? t("admin.executionModeHint")
                    : t("admin.harnessExecutionHint")
                }}
              </p>
            </el-form-item>
            <el-form-item :label="t('admin.relatedClasses')">
              <el-select
                v-model="form.classNames"
                multiple
                filterable
                collapse-tags
                collapse-tags-tooltip
                clearable
                :loading="classesLoading"
                :placeholder="t('admin.relatedClassesHint')"
                style="width: 100%"
              >
                <el-option
                  v-for="cls in objectClasses"
                  :key="cls.className"
                  :label="getClassLabel(cls)"
                  :value="cls.className"
                />
              </el-select>
              <p class="form-tip">{{ t("admin.relatedClassesHint") }}</p>
            </el-form-item>
          </AgentBasicInfoFields>
        </el-form>

        <h4 class="section-title" style="margin-top: 20px">{{ t("admin.promptConfig") }}</h4>
        <el-form
          :model="form"
          label-width="110px"
          :require-asterisk-position="requireAsteriskPosition"
          size="default"
        >
          <el-form-item v-if="isLoopMode" :label="t('admin.loopPrompt')">
            <el-input
              v-model="form.loopPrompt"
              type="textarea"
              :rows="12"
              :placeholder="t('admin.loopPromptHint')"
            />
          </el-form-item>
          <template v-else>
            <el-form-item :label="t('analysis.analysisDimensions')" required>
              <el-input
                v-model="form.analysisDimensionPrompt"
                type="textarea"
                :rows="4"
                :placeholder="t('hotData.dimensionPromptHint')"
              />
            </el-form-item>
            <el-form-item :label="t('hotData.dimensionReport')" required>
              <el-input
                v-model="form.summarizerPrompt"
                type="textarea"
                :rows="4"
                :placeholder="t('hotData.dimensionReportHint')"
              />
            </el-form-item>
            <el-form-item :label="t('hotData.conclusionReport')" required>
              <el-input
                v-model="form.conclusionMakerPrompt"
                type="textarea"
                :rows="4"
                :placeholder="t('hotData.conclusionPromptHint')"
              />
            </el-form-item>
          </template>
        </el-form>
      </div>

      <!-- Right: skill configuration -->
      <div class="form-right">
        <h4 class="section-title">{{ t("admin.skillConfig") }}</h4>

        <!-- Analysis skill configuration -->
        <div class="skills-group">
          <div class="skills-group-header">
            <el-icon><Cog /></el-icon>
            <span>{{ t("admin.analysisSkills") }}</span>
          </div>
          <p class="skill-hint">{{ t("admin.selectSkillsForAnalysis") }}</p>
          <SkillSelector v-model="form.enabledSkillIds" />
        </div>

        <div v-if="isLoopMode" class="skills-group">
          <h4 class="skills-group-header">{{ t("admin.externalMcpServices") }}</h4>
          <a href="#/admin/mcp-service" target="_blank" rel="noopener" class="mcp-manage-link">
            {{ t("mcp.manageServices") }}
          </a>
          <el-button text :loading="mcpServicesLoading" @click="loadExternalMcpServices">
            {{ t("common.refresh") }}
          </el-button>
          <el-select
            v-model="form.enabledMcpServiceNames"
            multiple
            filterable
            clearable
            :loading="mcpServicesLoading"
            :disabled="mcpServicesLoading || mcpServicesLoadFailed"
            :aria-label="t('admin.externalMcpServices')"
            :placeholder="t('admin.externalMcpServicesHint')"
            :fit-input-width="fitInputWidth"
            style="width: 100%"
          >
            <el-option
              v-for="name in externalMcpServiceNames"
              :key="name"
              :label="name"
              :value="name"
            />
            <el-option
              v-for="name in form.enabledMcpServiceNames.filter(
                (name) => !externalMcpServiceNames.includes(name)
              )"
              :key="name"
              :label="name"
              :value="name"
              disabled
            />
          </el-select>
          <p class="form-tip" :role="mcpServicesLoadFailed ? 'alert' : undefined">
            {{
              t(
                mcpServicesLoadFailed
                  ? "admin.externalMcpServicesLoadFailed"
                  : "admin.externalMcpServicesHint"
              )
            }}
          </p>
          <el-button v-if="mcpServicesLoadFailed" text @click="loadExternalMcpServices">
            {{ t("common.retry") }}
          </el-button>
        </div>

        <!-- Visualization skill configuration -->
        <div class="skills-group">
          <div class="skills-group-header">
            <el-icon><BarChart3 /></el-icon>
            <span>{{ t("admin.visualizationSkills") }}</span>
          </div>
          <p class="skill-hint">{{ t("admin.selectVisualSkills") }}</p>
          <SkillSelector
            v-model="form.enabledVisualizationSkillIds"
            mode="visualization"
            @loaded="handleVisualizationSkillsLoaded"
          />
        </div>

        <div class="skills-group">
          <div class="skills-group-header">
            <el-icon><Settings /></el-icon>
            <span>{{ t("admin.reportDeliverable") }}</span>
          </div>
          <el-checkbox v-model="form.reportDeliverableEnabled">
            {{ t("admin.reportDeliverableEnabled") }}
          </el-checkbox>
          <p class="skill-hint">{{ t("admin.reportDeliverableHint") }}</p>
          <el-form-item
            v-if="form.reportDeliverableEnabled && !isLoopMode"
            :label="t('admin.summaryPosition')"
          >
            <el-select
              v-model="form.summaryPosition"
              :aria-label="t('admin.summaryPosition')"
              style="width: 100%"
            >
              <el-option value="bottom" :label="t('admin.summaryPositionBottom')" />
              <el-option value="top" :label="t('admin.summaryPositionTop')" />
            </el-select>
            <p class="form-tip">{{ t("admin.summaryPositionHint") }}</p>
          </el-form-item>
        </div>

        <div class="skills-group">
          <div class="skills-group-header">
            <el-icon><Flame /></el-icon>
            <span>{{ t("admin.hotReport") }}</span>
          </div>
          <div class="hot-report-toggle">
            <el-switch
              v-model="form.hotReportEnabled"
              :aria-label="t('admin.hotReportEnabled')"
            />
            <span class="hot-report-toggle-label">{{ t("admin.hotReportEnabled") }}</span>
          </div>
          <p class="skill-hint">{{ t("admin.hotReportEnabledHint") }}</p>

          <template v-if="isEditing">
            <div v-loading="hotReportsLoading" class="hot-report-list">
              <p v-if="hotReportsLoadFailed" class="skill-hint" role="alert">
                {{ t("admin.hotReportLoadFailed") }}
              </p>
              <template v-else-if="hotReports.length === 0">
                <p class="skill-hint">{{ t("admin.noHotReports") }}</p>
              </template>
              <template v-else>
                <div
                  v-for="card in hotReports"
                  :key="card.id"
                  class="hot-report-item"
                >
                  <div class="hot-report-question">{{ card.question }}</div>
                  <el-switch
                    :model-value="card.status === 'PUBLISHED'"
                    :loading="hotReportsSaving.has(card.id)"
                    :disabled="hotReportsSaving.has(card.id)"
                    @change="onHotReportToggle(card, $event)"
                  />
                </div>
              </template>
            </div>
          </template>
        </div>

        <div class="skills-group">
          <div class="skills-group-header">
            <el-icon><Cog /></el-icon>
            <span>{{ t("admin.externalMcpServices") }}</span>
          </div>
          <el-select
            v-model="form.enabledMcpServiceNames"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            clearable
            :loading="mcpServicesLoading"
            :disabled="mcpServicesLoadFailed"
            :placeholder="t('admin.externalMcpServicesPlaceholder')"
            :fit-input-width="fitInputWidth"
            style="width: 100%"
          >
            <el-option
              v-for="serviceName in externalMcpServiceNames"
              :key="serviceName"
              :label="serviceName"
              :value="serviceName"
            />
          </el-select>
          <el-alert
            v-if="mcpServicesLoadFailed"
            class="mcp-load-alert"
            type="warning"
            :closable="false"
            :title="t('admin.externalMcpServicesLoadFailed')"
          />
          <p class="skill-hint">{{ t("admin.externalMcpServicesHint") }}</p>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="showDialog = false">{{ t("common.cancel") }}</el-button>
        <el-button type="primary" :loading="saving" @click="handleSubmit">
          {{ t("common.save") }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.mcp-manage-link {
  display: inline-block;
  margin-bottom: 8px;
  color: var(--el-color-primary);
}
.agent-form-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-xl);
  max-height: 70vh;
  overflow-y: auto;
  padding-right: var(--spacing-md);
}

.form-left,
.form-right {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  min-width: 0;
}

.skill-hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin: 0 0 var(--spacing-sm) 0;
}

.hot-report-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--spacing-sm);
}

.hot-report-toggle-label {
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.hot-report-list {
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
  padding: var(--spacing-sm);
}

.hot-report-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.hot-report-item:last-child {
  border-bottom: none;
}

.hot-report-question {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
  word-break: break-word;
}

.mcp-load-alert {
  margin-top: var(--spacing-sm);
}

.form-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
  margin: 6px 0 0;
  flex-basis: 100%;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0;
  padding-bottom: var(--spacing-sm);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.agent-form-layout--label-nowrap :deep(.el-form-item__label) {
  white-space: nowrap !important;
}
.agent-form-layout--label-wrap :deep(.el-form-item__label) {
  white-space: normal;
  line-height: 1.4;
  height: auto;
  word-break: break-word;
}

.skills-group {
  margin-top: var(--spacing-md);
}

.skills-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: var(--spacing-sm);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
}
button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
}
@media (max-width: 700px) {
  .agent-form-layout {
    grid-template-columns: minmax(0, 1fr);
    padding-right: 0;
  }
  :deep(.el-form-item) {
    display: block;
  }
  :deep(.el-form-item__label) {
    justify-content: flex-start;
  }
  :deep(.el-form-item__content) {
    margin-left: 0 !important;
  }
}
</style>
