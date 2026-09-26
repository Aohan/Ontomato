<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { ArrowLeft, ChevronDown, LayoutDashboard, ListTodo } from "lucide-vue-next";
import { useLocale } from "@ontomato/workbench-ui";
import { useTheme } from "@ontomato/workbench-ui/composables/useTheme";
import { QaThreadPanel, useChatStore } from "@ontomato/workbench-ui/features/chat";
import {
  AnalysisTaskPanel,
  AgentCreateDialog,
  useAnalysisStore,
} from "@ontomato/workbench-ui/features/analysis";
import {
  DashboardPanel,
  AddToDashboardDialog,
  DashboardSidebarPopover,
  useDashboardStore,
} from "@ontomato/workbench-ui/features/dashboard";
import type {
  AppearanceSection,
  WorkbenchAppearance,
} from "@ontomato/contracts/workbench-appearance";
import { getWorkbenchAppearance } from "@ontomato/workbench-ui/features/workbench/api";
import WorkbenchAgentRail from "@ontomato/workbench-ui/features/workbench/components/WorkbenchAgentRail.vue";
import {
  WorkbenchAppearanceDialog,
  type WorkbenchAgent,
} from "@ontomato/workbench-ui/features/workbench";
import WorkbenchUserMenu from "./WorkbenchUserMenu.vue";
import WorkbenchWelcomeState from "@ontomato/workbench-ui/features/workbench/components/WorkbenchWelcomeState.vue";
import WorkbenchWorkspaceHeader from "@ontomato/workbench-ui/features/workbench/components/WorkbenchWorkspaceHeader.vue";
import WorkbenchWorkspaceContent from "@ontomato/workbench-ui/features/workbench/components/WorkbenchWorkspaceContent.vue";
import { useWorkbenchLayoutState } from "./useWorkbenchLayoutState";
import { workbenchContent } from "../workbench-content";

const router = useRouter();
const { isDark, toggleTheme } = useTheme();
const { t } = useLocale();
const chatStore = useChatStore();
const analysisStore = useAnalysisStore();
const dashboardStore = useDashboardStore();

const { showWelcome: showQAWelcome } = storeToRefs(chatStore);
const { agents, selectedAgentId, tasks, currentTask, showAgentCreateDialog, editingAgent } =
  storeToRefs(analysisStore);
const {
  addToDashboardOpen,
  pendingDashboardDataset,
  currentDashboardId,
  isDashboardView,
  showDashboardPanel,
} = storeToRefs(dashboardStore);
const {
  welcomeAnimation,
  timerDropdownOpen,
  showUserMenu,
  selectionMode,
  currentView,
  rightPanelResetKey,
} = useWorkbenchLayoutState();

/* ── Domain-scoped appearance: loads once, failures never overwrite saved config ── */
const appearance = ref<WorkbenchAppearance | null>(null);
const appearanceSection = ref<AppearanceSection | null>(null);
const isCompactRail = ref(false);
const isMobile = ref(false);
const mobileView = ref<"nav" | "list" | "workspace">("nav");
let appearanceLoad = 0;
let compactRailQuery: MediaQueryList | null = null;
let mobileQuery: MediaQueryList | null = null;
function syncCompactRail() {
  isCompactRail.value = compactRailQuery?.matches ?? false;
}
function syncMobile() {
  isMobile.value = mobileQuery?.matches ?? false;
}
const defaultLogo = computed(() => `${import.meta.env.BASE_URL}ontomato-mark-green.svg`);
const logoSrc = computed(() => appearance.value?.brand.logo || defaultLogo.value);
const mobileWorkspaceLabel = computed(() => {
  if (isDashboardView.value) return t("analysis.dashboardName");
  if (selectionMode.value === "qa") return qaAgent.value.name;
  if (selectionMode.value === "all") return t("analysis.allTasks");
  return agents.value.find((agent) => agent.id === selectedAgentId.value)?.name || t("app.agent");
});

async function loadAppearance() {
  const load = ++appearanceLoad;
  try {
    const value = await getWorkbenchAppearance();
    if (load === appearanceLoad) appearance.value = value;
  } catch (error) {
    if (load === appearanceLoad) {
      ElMessage.error(
        error instanceof Error && !error.message.startsWith("appearance.")
          ? error.message
          : t("appearance.loadFailed")
      );
    }
  }
}

function appearanceSaved(value: WorkbenchAppearance) {
  appearanceLoad++;
  appearance.value = value;
  appearanceSection.value = null;
}

/** The query entry is not a real agent; its name, description and avatar come from appearance. */
const qaAgent = computed<WorkbenchAgent>(() => ({
  id: "__qa__",
  name: appearance.value?.qa.name || t("chat.queryAgent"),
  description: appearance.value?.qa.description || t("chat.queryAgentDesc"),
  icon: JSON.stringify({
    key: appearance.value?.qa.avatarKey || "MessageSquare",
    color: appearance.value?.qa.avatarColor || "",
  }),
  isQA: true,
  summarizerPrompt: "",
  conclusionMakerPrompt: "",
  isEnabled: true,
  createdAt: 0,
  updatedAt: 0,
}));

async function loadInitialWorkbenchData() {
  void loadAppearance();
  await analysisStore.loadAgents();
  await analysisStore.loadTasks();
  analysisStore.startTaskListPolling();
  await Promise.all([chatStore.loadThreads(), chatStore.restoreCurrentThread()]);
}

onMounted(() => {
  compactRailQuery = window.matchMedia("(max-width: 1000px)");
  mobileQuery = window.matchMedia("(max-width: 700px)");
  syncCompactRail();
  syncMobile();
  compactRailQuery.addEventListener("change", syncCompactRail);
  mobileQuery.addEventListener("change", syncMobile);
  void loadInitialWorkbenchData();
});

function handleSelectLeftAgent(agent: WorkbenchAgent) {
  void dashboardStore.selectDashboard();
  if (agent.isQA) {
    selectionMode.value = "qa";
    analysisStore.closeCurrentTask();
    selectedAgentId.value = "";
    void chatStore.loadThreads();
    void chatStore.restoreCurrentThread();
    chatStore.ensureConversation();
  } else {
    selectionMode.value = "analysis";
    selectedAgentId.value = agent.id;
    analysisStore.closeCurrentTask();
    void analysisStore.selectAgent(agent.id);
  }
  currentView.value = "chat";
  if (isMobile.value) mobileView.value = "list";
}

function handleShowAllTasks() {
  void dashboardStore.selectDashboard();
  selectionMode.value = "all";
  selectedAgentId.value = "";
  analysisStore.closeCurrentTask();
  void analysisStore.loadTasks();
  if (isMobile.value) mobileView.value = "list";
}

function openMobileWorkspace() {
  if (isMobile.value) mobileView.value = "workspace";
}

function openDashboardList() {
  dashboardStore.toggleDashboardPanel();
}

watch(isDashboardView, (active) => {
  if (active && isMobile.value) mobileView.value = "workspace";
});

onUnmounted(() => {
  compactRailQuery?.removeEventListener("change", syncCompactRail);
  mobileQuery?.removeEventListener("change", syncMobile);
  appearanceLoad++;
  chatStore.detachCurrentStream();
  analysisStore.disposeWorkbench();
});
</script>

<template>
  <div class="unified-layout" :class="`mobile-view-${mobileView}`">
    <!-- ═══ LEFT PANEL ═══ -->
    <aside class="left-panel">
      <WorkbenchAgentRail
        :logo-src="logoSrc"
        :brand-name="appearance?.brand.name || 'Ontomato'"
        :brand-subtitle="appearance?.brand.subtitle || t('app.subtitle')"
        :add-agent-label="appearance?.addAgentLabel || t('analysis.addAgent')"
        :qa-agent="qaAgent"
        :agents="agents"
        :selection-mode="selectionMode"
        :selected-agent-id="selectedAgentId"
        :compact="isCompactRail && !isMobile"
        card-tag="button"
        :native-titles="false"
        :add-icon-size="18"
        @edit-appearance="appearanceSection = $event"
        @select-agent="handleSelectLeftAgent"
        @add-agent="
          editingAgent = null;
          showAgentCreateDialog = true;
        "
      />

      <div class="left-footer">
        <el-tooltip
          :disabled="!isCompactRail || isMobile"
          :content="t('analysis.allTasks')"
          placement="right"
        >
          <button
            type="button"
            class="footer-item"
            :class="{ active: selectionMode === 'all' && !isDashboardView }"
            :aria-label="t('analysis.allTasks')"
            @click="handleShowAllTasks"
          >
            <ListTodo :size="18" class="footer-icon" />
            <span class="footer-label">{{ t("analysis.allTasks") }}</span>
            <span v-if="tasks.length" class="footer-badge">{{ tasks.length }}</span>
          </button>
        </el-tooltip>
        <DashboardSidebarPopover close-icon @open-dashboard="openMobileWorkspace" />
        <el-tooltip
          :disabled="!isCompactRail || isMobile"
          :content="t('analysis.dashboardName')"
          placement="right"
        >
          <button
            type="button"
            class="footer-item"
            :class="{ active: isDashboardView || showDashboardPanel }"
            :aria-label="t('analysis.dashboardName')"
            :aria-expanded="showDashboardPanel"
            @click="openDashboardList"
          >
            <span class="footer-icon"><LayoutDashboard :size="18" /></span>
            <span class="footer-label">{{ t("analysis.dashboardName") }}</span>
            <ChevronDown :size="12" class="dashboard-arrow" :class="{ open: showDashboardPanel }" />
          </button>
        </el-tooltip>
        <WorkbenchUserMenu
          v-model:visible="showUserMenu"
          :is-dark="isDark"
          :compact="isCompactRail && !isMobile"
          @admin="router.push('/admin')"
          @toggle-theme="toggleTheme"
        />
      </div>
    </aside>

    <!-- ═══ MID PANEL ═══ -->
    <template v-if="selectionMode === 'qa'">
      <QaThreadPanel
        :mobile="isMobile"
        :agent="qaAgent"
        @back="mobileView = 'nav'"
        @edit-agent="appearanceSection = 'qa'"
        @open-workspace="openMobileWorkspace"
        @update:current-view="currentView = $event"
        @reset-workspace="rightPanelResetKey++"
      />
    </template>
    <template v-else>
      <AnalysisTaskPanel
        :mobile="isMobile"
        :mode="selectionMode"
        @back="mobileView = 'nav'"
        @open-workspace="openMobileWorkspace"
        @update:current-view="currentView = $event"
      />
    </template>

    <!-- ═══ RIGHT PANEL ═══ -->
    <section :key="rightPanelResetKey" class="right-panel">
      <div class="mobile-workspace-nav">
        <button
          type="button"
          class="mobile-back-btn"
          :aria-label="t('common.back')"
          @click="mobileView = 'list'"
        >
          <ArrowLeft :size="19" />
        </button>
        <span>{{ mobileWorkspaceLabel }}</span>
      </div>
      <DashboardPanel v-if="isDashboardView" :dashboard-id="currentDashboardId" />
      <template v-else>
        <template v-if="selectionMode === 'qa' && showQAWelcome">
          <WorkbenchWelcomeState mode="qa" :animation="welcomeAnimation" />
        </template>
        <!-- Regular agents without a current task still need an entry point. -->
        <template
          v-else-if="selectionMode !== 'qa' && !currentTask && !analysisStore.isHarnessAgent"
        >
          <WorkbenchWelcomeState mode="analysis" :animation="welcomeAnimation" />
        </template>
        <template v-else>
          <!-- Header -->
          <WorkbenchWorkspaceHeader
            v-model:timer-open="timerDropdownOpen"
            :is-analysis="selectionMode !== 'qa'"
          />

          <WorkbenchWorkspaceContent
            v-model:current-view="currentView"
            :selection-mode="selectionMode"
          />
        </template>
      </template>
    </section>

    <!-- Dialogs -->
    <AddToDashboardDialog
      v-model="addToDashboardOpen"
      :thread-id="pendingDashboardDataset?.threadId || ''"
      :request-seq="pendingDashboardDataset?.requestSeq ?? -1"
      :dataset-index="pendingDashboardDataset?.datasetIndex ?? -1"
      :dataset-title="pendingDashboardDataset?.datasetTitle || ''"
      @update:model-value="(v: boolean) => (addToDashboardOpen = v)"
      @added="dashboardStore.addedToDashboard"
    />

    <AgentCreateDialog
      v-model:visible="showAgentCreateDialog"
      :editing-agent="editingAgent"
      v-bind="workbenchContent.agentDialogDisplay"
      @created="analysisStore.refreshAgentsAfterEdit"
      @updated="analysisStore.refreshAgentsAfterEdit"
    />

    <WorkbenchAppearanceDialog
      v-if="appearanceSection"
      :section="appearanceSection"
      :default-logo="defaultLogo"
      @close="appearanceSection = null"
      @saved="appearanceSaved"
    />
  </div>
</template>

<style scoped>
.unified-layout {
  display: grid;
  grid-template-columns: 240px 400px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: var(--el-bg-color-page);
  gap: 14px;
  padding: 18px;
}

/* ── LEFT PANEL ── */
.left-panel {
  min-width: 0;
  background: var(--el-bg-color);
  border: none;
  border-radius: 24px;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
  box-shadow: var(--shadow-card);
  transition: width 0.3s ease;
}
.left-footer {
  border-top: 1px solid var(--el-border-color);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: relative;
}
.footer-item {
  position: relative;
  width: 100%;
  border: 0;
  background: transparent;
  display: flex;
  align-items: center;
  padding: 8px 10px;
  border-radius: 14px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
  transition: all 0.15s;
  gap: 8px;
  text-align: left;
}
.footer-item:hover {
  background: var(--el-fill-color);
}
.footer-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.footer-item:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.footer-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
.footer-label {
  flex: 1;
}
.footer-badge {
  margin-left: auto;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  padding: 1px 7px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
}

.dashboard-arrow {
  margin-left: auto;
  color: var(--el-text-color-secondary);
  transition: transform 0.2s ease;
}
.dashboard-arrow.open {
  transform: rotate(180deg);
}

/* ── RIGHT PANEL ── */
.right-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color);
  border-radius: 24px;
  box-shadow: var(--shadow-card);
  overflow: hidden;
  position: relative;
}
.mobile-workspace-nav {
  display: none;
}
@media (max-width: 1200px) {
  .unified-layout {
    grid-template-columns: 200px 320px minmax(0, 1fr);
  }
}
@media (max-width: 1000px) {
  .unified-layout {
    grid-template-columns: 64px 260px minmax(0, 1fr);
  }
  .unified-layout > .left-panel {
    border-radius: 16px;
    overflow: visible;
    position: relative;
    z-index: 20;
  }
  .unified-layout :deep(.brand) {
    min-height: 64px;
    justify-content: center;
    padding: 12px 10px;
  }
  .unified-layout :deep(.brand-icon) {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    margin-right: 0;
  }
  .unified-layout :deep(.agent-list) {
    padding: 8px 12px;
  }
  .unified-layout :deep(.agent-card) {
    width: 40px;
    height: 40px;
    padding: 4px;
    justify-content: center;
    border-radius: 12px;
  }
  .unified-layout :deep(.agent-avatar) {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    margin-right: 0;
  }
  .unified-layout :deep(.agent-avatar svg) {
    width: 18px;
    height: 18px;
  }
  .unified-layout :deep(.agent-card.active) {
    background: transparent;
    box-shadow: none;
  }
  .unified-layout :deep(.agent-card.active::before) {
    top: 7px;
    right: -9px;
    bottom: 7px;
    width: 3px;
  }
  .unified-layout :deep(.agent-divider) {
    margin: 8px 6px;
  }
  .unified-layout :deep(.agent-add-wrap) {
    padding: 8px 12px;
  }
  .unified-layout :deep(.agent-add-btn) {
    position: relative;
    width: 40px;
    height: 40px;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 12px;
    background: transparent;
  }
  .unified-layout :deep(.agent-add-btn::before) {
    content: "";
    position: absolute;
    inset: 4px;
    border: 1px dashed var(--el-border-color-dark);
    border-radius: 10px;
    background: var(--el-fill-color-extra-light);
  }
  .unified-layout :deep(.agent-add-btn svg) {
    position: relative;
    z-index: 1;
    width: 18px;
    height: 18px;
  }
  .unified-layout :deep(.agent-add-btn:hover) {
    transform: none;
    background: transparent;
  }
  .unified-layout :deep(.agent-add-btn:hover::before) {
    border-color: color-mix(in srgb, var(--el-color-primary) 45%, transparent);
    background: var(--el-color-primary-light-9);
  }
  .unified-layout :deep(.footer-user) {
    width: 44px;
    height: 44px;
    min-height: 44px;
    justify-content: center;
    padding: 0;
  }
  .unified-layout :deep(.footer-user:focus-visible),
  .unified-layout :deep(.agent-add-btn:focus-visible) {
    outline: 2px solid var(--el-color-primary);
    outline-offset: -2px;
  }
  .unified-layout .left-footer {
    padding: 8px 10px;
    gap: 4px;
  }
  .unified-layout .footer-item {
    width: 44px;
    height: 44px;
    justify-content: center;
    padding: 0;
    border-radius: 14px;
  }
  .unified-layout .footer-badge {
    position: absolute;
    top: 7px;
    right: 7px;
    width: 7px;
    height: 7px;
    min-width: 0;
    padding: 0;
    overflow: hidden;
    color: transparent;
    background: var(--el-color-danger);
    border: 1px solid var(--el-bg-color);
  }
  .unified-layout .dashboard-arrow,
  .unified-layout :deep(.footer-chevron) {
    display: none;
  }
  .unified-layout :deep(.dashboard-expand) {
    left: calc(100% + 12px);
    right: auto;
    bottom: 48px;
    width: 260px;
    margin: 0;
  }
  .unified-layout :deep(.agent-info),
  .unified-layout :deep(.agent-section-title),
  .unified-layout :deep(.brand-text-group),
  .unified-layout :deep(.add-agent-text),
  .unified-layout :deep(.footer-user-name),
  .unified-layout :deep(.footer-label) {
    display: none;
  }
}
@media (max-width: 700px) {
  .unified-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    padding: 0;
    gap: 0;
    background: var(--el-bg-color);
  }
  .unified-layout > .left-panel,
  .unified-layout :deep(.mid-panel),
  .unified-layout > .right-panel {
    grid-column: 1;
    grid-row: 1;
    width: 100%;
    height: 100%;
    min-height: 0;
    border-radius: 0;
    box-shadow: none;
  }
  .unified-layout.mobile-view-nav :deep(.mid-panel),
  .unified-layout.mobile-view-nav > .right-panel,
  .unified-layout.mobile-view-list > .left-panel,
  .unified-layout.mobile-view-list > .right-panel,
  .unified-layout.mobile-view-workspace > .left-panel,
  .unified-layout.mobile-view-workspace :deep(.mid-panel) {
    display: none;
  }
  .unified-layout > .left-panel {
    overflow: hidden;
    z-index: auto;
  }
  .unified-layout :deep(.brand) {
    min-height: 76px;
    justify-content: flex-start;
    padding: calc(14px + env(safe-area-inset-top)) 18px 14px;
  }
  .unified-layout :deep(.brand-icon) {
    width: 38px;
    height: 38px;
    border-radius: 12px;
    margin-right: 10px;
  }
  .unified-layout :deep(.brand-text-group),
  .unified-layout :deep(.agent-section-title),
  .unified-layout :deep(.agent-info),
  .unified-layout :deep(.add-agent-text),
  .unified-layout :deep(.footer-user-name),
  .unified-layout :deep(.footer-label) {
    display: flex;
  }
  .unified-layout :deep(.brand-text-group),
  .unified-layout :deep(.agent-info) {
    flex-direction: column;
  }
  .unified-layout :deep(.agent-section-title) {
    padding: 16px 18px 8px;
  }
  .unified-layout :deep(.agent-list) {
    padding: 4px 12px 12px;
  }
  .unified-layout :deep(.agent-card) {
    width: 100%;
    height: auto;
    min-height: 56px;
    justify-content: flex-start;
    padding: 9px 10px;
    border-radius: 12px;
  }
  .unified-layout :deep(.agent-card.active) {
    background: var(--el-color-primary-light-9);
  }
  .unified-layout :deep(.agent-card.active::before) {
    top: 14px;
    right: 6px;
    bottom: 14px;
  }
  .unified-layout :deep(.agent-avatar) {
    width: 38px;
    height: 38px;
    border-radius: 12px;
    margin-right: 10px;
  }
  .unified-layout :deep(.agent-avatar svg) {
    width: 20px;
    height: 20px;
  }
  .unified-layout :deep(.agent-add-wrap) {
    padding: 8px 12px;
  }
  .unified-layout :deep(.agent-add-btn) {
    width: 100%;
    height: 44px;
    gap: 8px;
    border: 1.5px dashed var(--el-border-color-dark);
    border-radius: 12px;
    background: var(--el-fill-color-extra-light);
  }
  .unified-layout :deep(.agent-add-btn::before) {
    display: none;
  }
  .unified-layout .left-footer {
    padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
  }
  .unified-layout .footer-item,
  .unified-layout :deep(.footer-user) {
    width: 100%;
    height: 44px;
    justify-content: flex-start;
    padding: 0 12px;
    gap: 10px;
    border-radius: 12px;
  }
  .unified-layout .footer-badge {
    position: static;
    width: auto;
    height: auto;
    margin-left: auto;
    padding: 1px 7px;
    overflow: visible;
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
    border: 0;
  }
  .unified-layout .dashboard-arrow,
  .unified-layout :deep(.footer-chevron) {
    display: block;
  }
  .unified-layout :deep(.dashboard-expand) {
    position: fixed;
    left: 8px;
    right: 8px;
    bottom: calc(8px + env(safe-area-inset-bottom));
    width: auto;
    max-height: 0;
    margin: 0;
    z-index: 2100;
    border-radius: 16px;
  }
  .unified-layout :deep(.dashboard-expand.open) {
    max-height: min(70dvh, 520px);
  }
  .unified-layout :deep(.dashboard-expand-inner) {
    padding: 16px;
  }
  .unified-layout :deep(.mid-panel) {
    overflow: hidden;
  }
  .mobile-workspace-nav {
    height: calc(48px + env(safe-area-inset-top));
    padding: env(safe-area-inset-top) 12px 0;
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) 36px;
    align-items: center;
    flex-shrink: 0;
    border-bottom: 1px solid var(--el-border-color);
    background: var(--el-bg-color);
  }
  .mobile-workspace-nav span {
    grid-column: 2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
    font-size: 14px;
    font-weight: 650;
    color: var(--el-text-color-primary);
  }
  .mobile-back-btn {
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--el-text-color-regular);
  }
  .mobile-back-btn:active {
    background: var(--el-fill-color);
  }
}
</style>
