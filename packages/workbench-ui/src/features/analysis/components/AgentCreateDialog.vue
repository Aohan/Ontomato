<script setup lang="ts">
import type {
  AnalysisAgent,
  AnalysisReportSummaryPosition,
  AnalysisAgentExecutionMode,
  AnalysisGraphScope,
} from "@ontomato/contracts/analysis-agent";

import { ref, computed, watch, onBeforeUnmount } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft, UserRound, Workflow, FileText, Blocks, Database, BarChart3, Cog, Flame, Settings } from "lucide-vue-next";
import CodeMirrorEditor from "../../../components/CodeMirrorEditor.vue";
import { renderAgentMarkdown } from "../../../utils/agent-markdown";
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
type Section = "basic" | "execution" | "prompts" | "tools" | "data" | "reports";
const activeSection = ref<Section>("basic");
const sections = computed(() => [
  { id: "basic" as const, label: t("common.basicInfo"), icon: UserRound },
  { id: "execution" as const, label: t("admin.executionMode"), icon: Workflow },
  { id: "prompts" as const, label: t("admin.promptConfig"), icon: FileText },
  { id: "tools" as const, label: t("admin.agentEditorTools"), icon: Blocks },
  { id: "data" as const, label: t("admin.agentEditorData"), icon: Database },
  { id: "reports" as const, label: t("admin.agentEditorReports"), icon: BarChart3 },
]);
const promptTab = ref<"analysisDimensionPrompt" | "summarizerPrompt" | "conclusionMakerPrompt">("analysisDimensionPrompt");
const promptPreview = ref(false);
const baseline = ref("");
const dirty = computed(() => baseline.value !== JSON.stringify(form.value));
const currentPrompt = computed({
  get: () => isLoopMode.value ? form.value.loopPrompt : form.value[promptTab.value],
  set: (value: string) => { if (isLoopMode.value) form.value.loopPrompt = value; else form.value[promptTab.value] = value; },
});
const promptOptions = computed(() => [
  { value: "analysisDimensionPrompt", label: t("analysis.analysisDimensions") },
  { value: "summarizerPrompt", label: t("hotData.dimensionReport") },
  { value: "conclusionMakerPrompt", label: t("hotData.conclusionReport") },
]);
async function requestClose() {
  if (saving.value) return;
  if (dirty.value) {
    try {
      await ElMessageBox.confirm(t("admin.agentEditorDiscard"), t("admin.agentEditorUnsaved"), {
        confirmButtonText: t("admin.agentEditorDiscardAction"), cancelButtonText: t("common.cancel"), type: "warning",
      });
    } catch { return; }
  }
  emit("update:visible", false);
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (props.visible && dirty.value) { event.preventDefault(); event.returnValue = ""; }
}
window.addEventListener("beforeunload", beforeUnload);
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));

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
    const wasDirty = dirty.value;
    form.value.enabledVisualizationSkillIds = getDefaultVisualizationSkillIds();
    if (!wasDirty) baseline.value = JSON.stringify(form.value);
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
  graphScopeMode: "panorama" as AnalysisGraphScope["mode"],
  graphScopeRootClassNames: [] as string[],
  graphScopeMaxDepth: 1 as number | undefined,
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
    graphScopeMode: agent.graphScope?.mode === "subgraph" ? "subgraph" : "panorama",
    graphScopeRootClassNames:
      agent.graphScope?.mode === "subgraph" ? [...agent.graphScope.rootClassNames] : [],
    graphScopeMaxDepth: agent.graphScope?.mode === "subgraph" ? agent.graphScope.maxDepth : 1,
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
    graphScopeMode: "panorama",
    graphScopeRootClassNames: [],
    graphScopeMaxDepth: 1,
    isEnabled: true,
    sortOrder: 0,
    avatarKey: "Brain",
    avatarColor: defaultAvatarColor.value,
  };
}

async function handleSubmit() {
  if (!form.value.name.trim()) {
    activeSection.value = "basic";
    ElMessage.warning(t("analysis.agentNameRequired"));
    return;
  }

  const { graphScopeMode, graphScopeRootClassNames, graphScopeMaxDepth, ...agentForm } = form.value;
  if (graphScopeMode === "subgraph") {
    if (!graphScopeRootClassNames.length) {
      activeSection.value = "data";
      ElMessage.warning(t("admin.graphScopeRootsRequired"));
      return;
    }
    if (
      graphScopeMaxDepth === undefined ||
      !Number.isInteger(graphScopeMaxDepth) ||
      graphScopeMaxDepth < 0 ||
      graphScopeMaxDepth > 10
    ) {
      activeSection.value = "data";
      ElMessage.warning(t("admin.graphScopeDepthInvalid"));
      return;
    }
  }
  const graphScope: AnalysisGraphScope =
    graphScopeMode === "subgraph"
      ? { mode: "subgraph", rootClassNames: [...graphScopeRootClassNames], maxDepth: graphScopeMaxDepth! }
      : { mode: "panorama" };
  saving.value = true;
  const payload = {
    ...agentForm,
    graphScope,
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
      activeSection.value = props.editingAgent ? "prompts" : "basic";
      promptPreview.value = false;
      promptTab.value = "analysisDimensionPrompt";
      hotReports.value = [];
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
      baseline.value = JSON.stringify(form.value);
    }
  },
  { immediate: true }
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
  <el-drawer
    v-model="showDialog"
    :title="isEditing ? t('admin.editAgent') : t('admin.newAgent')"
    direction="rtl"
    size="61.8vw"
    class="agent-editor-drawer"
    :with-header="false"
    :show-close="false"
    :close-on-click-modal="false"
    :before-close="requestClose"
    @close="resetForm"
  >
    <header class="agent-editor-header">
      <el-button :icon="ArrowLeft" :disabled="saving" @click="requestClose">{{ t('admin.agentEditorBack') }}</el-button>
      <div class="agent-editor-heading"><strong>{{ isEditing ? t('admin.editAgent') : t('admin.newAgent') }}<span v-if="form.name"> · {{ form.name }}</span></strong><small>{{ dirty ? t('admin.agentEditorUnsaved') : t('admin.agentEditorSaved') }}</small></div>
      <el-button type="primary" :loading="saving" @click="handleSubmit">{{ t('common.save') }}</el-button>
    </header>
    <div class="agent-editor-workspace">
      <nav class="agent-editor-nav" :aria-label="t('admin.agentEditorNavigation')">
        <button v-for="section in sections" :key="section.id" type="button" :class="{ active: activeSection === section.id }" :aria-current="activeSection === section.id ? 'page' : undefined" @click="activeSection = section.id"><component :is="section.icon" :size="18" /><span>{{ section.label }}</span></button>
      </nav>
    <div
      :class="[
        'agent-form-layout',
        labelWrap ? 'agent-form-layout--label-wrap' : 'agent-form-layout--label-nowrap',
      ]"
    >
      <div class="editor-section-heading">
        <h2>{{ sections.find(section => section.id === activeSection)?.label }}</h2>
        <p>{{ t(`admin.agentEditorIntro.${activeSection}`) }}</p>
      </div>
      <!-- Configuration forms stay mounted to preserve drafts when navigating. -->
      <div class="form-left">
        <el-form
          v-show="activeSection === 'basic' || activeSection === 'execution' || activeSection === 'data'"
          :model="form"
          label-position="top"
          :require-asterisk-position="requireAsteriskPosition"
          size="default"
        >
          <div v-show="activeSection === 'basic'" class="configuration-card identity-card">
          <AgentBasicInfoFields
            v-model:name="form.name"
            v-model:description="form.description"
            v-model:avatar-key="form.avatarKey"
            v-model:avatar-color="form.avatarColor"
          />
          <div class="setting-row"><div><strong>{{ t('common.enable') }}</strong><p>{{ t('admin.agentEditorEnabledHint') }}</p></div><el-switch v-model="form.isEnabled" :aria-label="t('common.enable')" /></div>
          </div>
            <div v-show="activeSection === 'execution'" class="editor-config-section">
            <el-form-item :label="t('admin.productMode')" required>
              <el-radio-group
                v-model="form.reportDeliverableEnabled"
                :aria-label="t('admin.productMode')"
              >
                <el-radio :value="true"><span class="mode-title">{{ t("admin.productModeAnalysis") }}</span><small>{{ t('admin.productModeAnalysisHint') }}</small></el-radio>
                <el-radio :value="false"><span class="mode-title">{{ t("admin.productModeHarness") }}</span><small>{{ t('admin.productModeHarnessHint') }}</small></el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item :label="t('admin.executionMode')" required>
              <el-radio-group
                v-if="form.reportDeliverableEnabled"
                v-model="form.executionMode"
                :aria-label="t('admin.executionMode')"
              >
                <el-radio value="dimension"><span class="mode-title">{{ t("admin.executionModeDimension") }}</span><small>{{ t('admin.agentEditorDimensionHint') }}</small></el-radio>
                <el-radio value="loop"><span class="mode-title">{{ t("admin.executionModeLoop") }}</span><small>{{ t('admin.agentEditorLoopHint') }}</small></el-radio>
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
            </div>
             <div v-show="activeSection === 'data'" class="editor-config-section data-configuration">
             <section class="configuration-card">
            <el-form-item :label="t('admin.relatedClasses')">
              <el-select
                popper-class="agent-editor-select-dropdown"
                fit-input-width
                v-model="form.classNames"
                multiple
                filterable
                collapse-tags
                collapse-tags-tooltip
                clearable
                :loading="classesLoading"
                 :placeholder="t('admin.relatedClasses')"
                 :max-collapse-tags="3"
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
            </section>
            <section class="configuration-card">
            <el-form-item :label="t('admin.graphScope')">
              <el-radio-group v-model="form.graphScopeMode" :aria-label="t('admin.graphScope')">
                <el-radio value="panorama">{{ t("admin.graphScopePanorama") }}</el-radio>
                <el-radio value="subgraph">{{ t("admin.graphScopeSubgraph") }}</el-radio>
              </el-radio-group>
              <p class="form-tip">{{ t("admin.graphScopeHint") }}</p>
            </el-form-item>
             <div v-if="form.graphScopeMode === 'subgraph'" class="subgraph-fields">
              <el-form-item :label="t('admin.graphScopeRoots')" required>
                <el-select
                  popper-class="agent-editor-select-dropdown"
                  fit-input-width
                  v-model="form.graphScopeRootClassNames"
                  multiple
                  filterable
                  collapse-tags
                  collapse-tags-tooltip
                  clearable
                  :loading="classesLoading"
                  :aria-label="t('admin.graphScopeRoots')"
                  :placeholder="t('admin.graphScopeRootsHint')"
                  style="width: 100%"
                >
                  <el-option
                    v-for="cls in objectClasses"
                    :key="cls.className"
                    :label="getClassLabel(cls)"
                    :value="cls.className"
                  />
                </el-select>
                <p class="form-tip">{{ t("admin.graphScopeRootsHint") }}</p>
              </el-form-item>
              <el-form-item :label="t('admin.graphScopeMaxDepth')" required>
                <el-input-number
                  v-model="form.graphScopeMaxDepth"
                  :min="0"
                  :max="10"
                  :step="1"
                  step-strictly
                  :precision="0"
                  :aria-label="t('admin.graphScopeMaxDepth')"
                />
                <p class="form-tip">{{ t("admin.graphScopeDepthHint") }}</p>
              </el-form-item>
             </div>
             </section>
            </div>
        </el-form>

        <section v-if="activeSection === 'prompts'" class="prompt-workspace">
          <div class="prompt-toolbar"><strong>{{ isLoopMode ? t('admin.loopPrompt') : promptOptions.find(option => option.value === promptTab)?.label }}</strong><el-radio-group v-model="promptPreview" size="small"><el-radio-button :value="false">{{ t('common.edit') }}</el-radio-button><el-radio-button :value="true">{{ t('admin.agentEditorPreview') }}</el-radio-button></el-radio-group></div>
          <el-segmented v-if="!isLoopMode" v-model="promptTab" :options="promptOptions" />
          <p class="form-tip">{{ isLoopMode ? t('admin.loopPromptHint') : promptTab === 'analysisDimensionPrompt' ? t('hotData.dimensionPromptHint') : promptTab === 'summarizerPrompt' ? t('hotData.dimensionReportHint') : t('hotData.conclusionPromptHint') }}</p>
          <div v-if="promptPreview" class="prompt-preview markdown-body" v-html="renderAgentMarkdown(currentPrompt)" />
          <CodeMirrorEditor v-else :key="isLoopMode ? 'loop' : promptTab" v-model="currentPrompt" language="markdown" :min-height="400" />
          <small class="prompt-status">{{ t('admin.agentEditorCharacters', { count: currentPrompt.length }) }} · Markdown</small>
        </section>
      </div>

      <!-- Tools and report configuration share the same workspace. -->
      <div v-show="activeSection === 'tools' || activeSection === 'reports'" class="form-right">

        <!-- Analysis skill configuration -->
        <div v-show="activeSection === 'tools'" class="skills-group">
          <div class="skills-group-header">
            <el-icon><Cog /></el-icon>
            <span>{{ t("admin.analysisSkills") }}</span>
            <el-tag size="small" effect="plain">{{ form.enabledSkillIds.length }}</el-tag>
          </div>
          <p class="skill-hint">{{ t("admin.selectSkillsForAnalysis") }}</p>
          <SkillSelector v-model="form.enabledSkillIds" />
        </div>

        <!-- Visualization skill configuration -->
        <div v-show="activeSection === 'tools'" class="skills-group">
          <div class="skills-group-header">
            <el-icon><BarChart3 /></el-icon>
            <span>{{ t("admin.visualizationSkills") }}</span>
            <el-tag size="small" effect="plain">{{ form.enabledVisualizationSkillIds?.length ?? 0 }}</el-tag>
          </div>
          <p class="skill-hint">{{ t("admin.selectVisualSkills") }}</p>
          <SkillSelector
            v-model="form.enabledVisualizationSkillIds"
            mode="visualization"
            @loaded="handleVisualizationSkillsLoaded"
          />
        </div>

        <div v-show="activeSection === 'reports'" class="skills-group">
          <div class="skills-group-header">
            <el-icon><Settings /></el-icon>
            <span>{{ t("admin.reportDeliverable") }}</span>
          </div>
          <div class="setting-row"><div><strong>{{ t('admin.reportDeliverableEnabled') }}</strong><p>{{ t('admin.reportDeliverableHint') }}</p></div><el-switch v-model="form.reportDeliverableEnabled" :aria-label="t('admin.reportDeliverableEnabled')" /></div>
          <el-form-item
            v-if="form.reportDeliverableEnabled && !isLoopMode"
            :label="t('admin.summaryPosition')"
          >
            <el-select
              popper-class="agent-editor-select-dropdown"
              fit-input-width
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

        <div v-show="activeSection === 'reports'" class="skills-group">
          <div class="skills-group-header">
            <el-icon><Flame /></el-icon>
            <span>{{ t("admin.hotReport") }}</span>
          </div>
          <div class="setting-row">
            <div><strong>{{ t('admin.hotReportEnabled') }}</strong><p>{{ t('admin.hotReportEnabledHint') }}</p></div>
            <el-switch
              v-model="form.hotReportEnabled"
              :aria-label="t('admin.hotReportEnabled')"
            />
          </div>

          <div v-if="isEditing" class="published-reports-section">
            <p class="form-tip">{{ t('admin.agentEditorImmediateReports') }}</p>
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
          </div>
        </div>

        <div v-show="activeSection === 'tools'" class="skills-group">
          <div class="skills-group-header">
            <el-icon><Cog /></el-icon>
            <span>{{ t("admin.externalMcpServices") }}</span>
            <el-tag size="small" effect="plain">{{ form.enabledMcpServiceNames.length }}</el-tag>
          </div>
          <el-select
            popper-class="agent-editor-select-dropdown"
            v-model="form.enabledMcpServiceNames"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            clearable
            :loading="mcpServicesLoading"
            :disabled="mcpServicesLoading || mcpServicesLoadFailed"
            :aria-label="t('admin.externalMcpServices')"
            :placeholder="t('admin.externalMcpServicesPlaceholder')"
            fit-input-width
            style="width: 100%"
          >
            <el-option
              v-for="serviceName in externalMcpServiceNames"
              :key="serviceName"
              :label="serviceName"
              :value="serviceName"
            />
            <el-option v-for="name in form.enabledMcpServiceNames.filter(name => !externalMcpServiceNames.includes(name))" :key="name" :label="name" :value="name" disabled />
          </el-select>
          <el-alert
            v-if="mcpServicesLoadFailed"
            class="mcp-load-alert"
            type="warning"
            :closable="false"
            :title="t('admin.externalMcpServicesLoadFailed')"
          />
          <p class="skill-hint">{{ t("admin.externalMcpServicesHint") }}</p>
          <div class="mcp-actions">
          <a href="#/admin/mcp-service" target="_blank" rel="noopener" class="mcp-manage-link">{{ t('mcp.manageServices') }}</a>
          <el-button text :loading="mcpServicesLoading" @click="loadExternalMcpServices">{{ t('common.refresh') }}</el-button>
          </div>
        </div>
      </div>
    </div>
    </div>
  </el-drawer>
</template>

<style scoped>
:global(.agent-editor-drawer.el-drawer) { border-radius: 0; overflow: hidden; }
:global(.el-popper.agent-editor-select-dropdown) { max-width: none !important; box-sizing: border-box; }
:global(.agent-editor-select-dropdown .el-select-dropdown) { width: 100%; min-width: 0 !important; }
:global(.agent-editor-select-dropdown .el-select-dropdown__item) { width: 100%; box-sizing: border-box; }
:global(.agent-editor-drawer > .el-drawer__body) { display: flex; flex: 1; flex-direction: column; min-height: 0; padding: 0; overflow: hidden; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.agent-editor-header { display: flex; align-items: center; gap: 20px; padding: 16px 24px; border-bottom: 1px solid var(--el-border-color-light); flex-shrink: 0; }
.agent-editor-heading { flex: 1; min-width: 0; display: grid; gap: 4px; }
.agent-editor-heading strong { font-size: 18px; color: var(--el-text-color-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-editor-heading small { font-size: 12px; color: var(--el-text-color-secondary); }
.agent-editor-workspace { flex: 1; display: grid; grid-template-columns: 184px minmax(0, 1fr); min-height: 0; }
.agent-editor-nav { padding: 24px 12px; display: flex; flex-direction: column; gap: 6px; border-right: 1px solid var(--el-border-color-light); background: var(--el-fill-color-extra-light); overflow: auto; }
.agent-editor-nav button { display: flex; gap: 12px; align-items: center; padding: 12px 16px; border: 0; border-radius: 8px; background: transparent; color: var(--el-text-color-regular); cursor: pointer; text-align: left; font: inherit; }
.agent-editor-nav button.active { color: var(--el-color-primary); background: var(--el-color-primary-light-9); font-weight: 600; }
.agent-editor-nav button:hover { background: var(--el-fill-color); }
.prompt-workspace { display: flex; flex-direction: column; gap: 16px; min-height: calc(100dvh - 160px); }
.prompt-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.prompt-toolbar .section-title { border: 0; padding: 0; }
.prompt-workspace > .codemirror-editor { flex: 1; min-height: 400px; }
.prompt-workspace :deep(.cm-editor) { min-height: 400px; height: calc(100dvh - 310px); }
.prompt-preview { flex: 1; min-height: 400px; padding: 24px; border: 1px solid var(--el-border-color); border-radius: 8px; overflow-wrap: anywhere; line-height: 1.8; }
.prompt-preview :deep(pre) { overflow: auto; padding: 16px; background: var(--el-fill-color-light); }
.prompt-status { color: var(--el-text-color-secondary); text-align: right; }
.mcp-manage-link {
  display: inline-block;
  color: var(--el-color-primary);
}
.agent-form-layout {
  display: block;
  min-width: 0;
  overflow-y: auto;
  padding: 28px;
}
.editor-section-heading { max-width: 1100px; margin: 0 auto 28px; }
.editor-section-heading h2 { margin: 0 0 8px; font-size: 22px; color: var(--el-text-color-primary); }
.editor-section-heading p { margin: 0; color: var(--el-text-color-secondary); line-height: 1.7; font-size: 14px; }
.configuration-card, .form-right > .skills-group { padding: 24px; border: 1px solid var(--el-border-color-light); border-radius: 12px; background: var(--el-bg-color); }
.identity-card { max-width: 800px; }
.identity-card :deep(.el-form-item) { margin-bottom: 24px; }
.setting-row { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 0; }
.setting-row strong { font-size: 14px; font-weight: 500; color: var(--el-text-color-primary); }
.setting-row p { font-size: 13px; line-height: 1.6; color: var(--el-text-color-secondary); margin: 6px 0 0; }
.setting-row .el-switch { flex-shrink: 0; }
.data-configuration { display: grid; gap: 24px; }
.configuration-card :deep(.el-form-item:last-child) { margin-bottom: 0; }
.subgraph-fields { border-top: 1px solid var(--el-border-color-light); padding-top: 20px; margin-top: 16px; }
.form-right > .skills-group { display: flex; flex-direction: column; gap: 16px; margin-top: 0; }
.form-right > .skills-group > .el-form-item { margin-bottom: 0; }
.published-reports-section { display: grid; gap: 12px; padding-top: 16px; border-top: 1px solid var(--el-border-color-light); }
.published-reports-section > .form-tip { margin: 0; }
.mcp-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; }
.mcp-actions .el-button { margin: 0; padding: 0; }
.skills-group-header .el-tag { margin-left: auto; }

.form-left,
.form-right {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
  max-width: 1100px;
  margin: 0 auto;
}
.editor-config-section { max-width: 100%; }
.editor-config-section :deep(.el-radio-group) { display: flex; flex-wrap: wrap; gap: 12px; width: 100%; }
.editor-config-section :deep(.el-radio) { margin: 0; flex: 1 1 240px; min-width: 0; height: auto; min-height: 64px; padding: 20px; border: 1px solid var(--el-border-color); border-radius: 10px; align-items: flex-start; }
.editor-config-section :deep(.el-radio__input) { margin-top: 3px; }
.editor-config-section :deep(.el-radio__label) { white-space: normal; min-width: 0; line-height: 1.6; }
.editor-config-section :deep(.mode-title) { display: block; font-weight: 600; font-size: 15px; }
.editor-config-section :deep(.el-radio small) { display: block; margin-top: 6px; color: var(--el-text-color-secondary); line-height: 1.6; font-size: 13px; }
.editor-config-section :deep(.el-radio.is-checked) { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.agent-form-layout :deep(.el-form-item__label) { white-space: normal !important; }

.skill-hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin: 0;
  line-height: 1.6;
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
  padding: 0;
}
.hot-report-list > .skill-hint { padding: 16px; }

.hot-report-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.hot-report-item .el-switch { flex-shrink: 0; }

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
  line-height: 1.6;
}

.mcp-load-alert {
  margin-top: 0;
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
  margin-bottom: 0;
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
  :global(.agent-editor-drawer.el-drawer) { width: 100vw !important; }
  .agent-editor-workspace { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .agent-editor-nav { flex-direction: row; padding: 8px; border-right: 0; border-bottom: 1px solid var(--el-border-color-light); }
  .agent-editor-nav button { flex-shrink: 0; padding: 8px; }
  .agent-editor-header { padding: 12px; gap: 10px; }
  .agent-editor-heading strong { font-size: 15px; }
  .agent-form-layout {
    grid-template-columns: minmax(0, 1fr);
    padding: 20px 16px;
  }
  .configuration-card, .form-right > .skills-group { padding: 16px; }
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
