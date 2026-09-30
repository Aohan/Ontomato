<script setup lang="ts">
import type { SessionInfo as AgentSession } from "@ontomato/contracts/diagnosis";
import type { ArtifactType as RetentionArtifactType } from "@ontomato/contracts/observe";
import type {
  WorkspaceManifest,
  AutotestRunMeta,
  AutotestActiveView,
  ObserveAccount,
  ObserveActiveView,
  ObserveNavGroupKey,
} from "./types";
import { ref, computed, nextTick, watch, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { useLocale } from "../../../../composables/useLocale";
import { workbenchContent } from "../../../../content";
import { useAgentChat } from "../../composables/useAgentChat";
import { artifactRetentionRequestKey, diagnosisApi, setArtifactRetention } from "../../api";
import { isTurnCollectRequested, isTurnDiagnoseRequested } from "../../utils/workspace-route";

import ObserveHeader from "./ObserveHeader.vue";
import ObserveSidebar from "./ObserveSidebar.vue";

import DiagnosisSidebar from "../DiagnosisSidebar.vue";
import EmptyState from "../agent-chat/EmptyState.vue";
import ArtifactDetail from "../ArtifactDetail.vue";
import LiveLogsPage from "../live-logs/LiveLogsPage.vue";
import TestPage from "../test-run/TestPage.vue";
import TestcasesPage from "../testcases/TestcasesPage.vue";
import ResultsPage from "../results/ResultsPage.vue";
import CaseArtifactPage from "../results/CaseArtifactPage.vue";
import DslTestPage from "../dsl-test/DslTestPage.vue";

/** The header account comes from the host (null in open source); extra DSL result tabs go back to their original place through the dsl-result-tabs slot. */
defineProps<{ account: ObserveAccount | null }>();

const router = useRouter();
const route = useRoute();
const { t } = useLocale();

/* (autotestMenuItems removed — autotest sidebar is now custom, see autotest state section) */

/* ------------------------------------------------------------------ */
/*  Global AI sidebar (declared early — referenced by route watcher)   */
/* ------------------------------------------------------------------ */

const aiSidebarVisible = ref(false);
const diagnosisSidebarRef = ref<InstanceType<typeof DiagnosisSidebar> | null>(null);
const AUTO_TURN_DIAGNOSIS_MESSAGE = workbenchContent().text.observe.autoTurnDiagnosisMessage;

/* ------------------------------------------------------------------ */
/*  Observe group state                                                */
/* ------------------------------------------------------------------ */

const observeTurns = ref<WorkspaceManifest[]>([]);
const observeTurnsLoading = ref(false);
const selectedTurnKey = ref<string | null>(null);
const observeActiveView = ref<ObserveActiveView>("turns");
const turnSearchInput = ref("");
const turnSearching = ref(false);
const deletingTurnKey = ref<string | null>(null);
const routeWorkspaceCollecting = ref(false);
const routeWorkspaceCollectingId = ref<string | null>(null);
const retentionUpdatingKey = ref<string | null>(null);

const observeApiPrefix = computed(() => {
  return selectedTurnKey.value ? diagnosisApi.turnArtifactUrl(selectedTurnKey.value) : "";
});

const observeBuildUrl = computed(() => diagnosisApi.turnBuildUrl());

const observeBuildBody = computed(() => {
  return selectedTurnKey.value ? { turnKey: selectedTurnKey.value } : {};
});

const isSelectedWorkspaceCollecting = computed(
  () => routeWorkspaceCollecting.value && routeWorkspaceCollectingId.value === selectedTurnKey.value
);

function createTurnPlaceholder(turnKey: string): WorkspaceManifest {
  return {
    workspaceId: turnKey,
    turnKey: turnKey,
    status: "collecting",
    createdAt: new Date().toISOString(),
    appLogCount: 0,
    llmCallCount: 0,
    backendLogCount: 0,
    errorCount: 0,
  };
}

function turnIdentity(workspace: WorkspaceManifest): string {
  return workspace.turnKey || workspace.workspaceId;
}

const selectedTurn = computed(() =>
  observeTurns.value.find((workspace) => turnIdentity(workspace) === selectedTurnKey.value)
);

function ensureSelectedTurnInList(turnKey = selectedTurnKey.value) {
  if (!turnKey) return;
  if (observeTurns.value.some((turn) => turnIdentity(turn) === turnKey)) return;
  observeTurns.value = [createTurnPlaceholder(turnKey), ...observeTurns.value];
}

async function handleObserveArtifactLoaded() {
  await loadObserveTurns();
}

async function loadObserveTurns() {
  observeTurnsLoading.value = true;
  try {
    const res = await diagnosisApi.listTurns();
    observeTurns.value = res.data || [];
  } catch (e: any) {
    observeTurns.value = [];
    console.error("Failed to load turns", e);
  } finally {
    ensureSelectedTurnInList();
    observeTurnsLoading.value = false;
  }
}

function selectTurn(turnKey: string) {
  // URL is the single source of truth: push the route and let the
  // `watch(route.path)` handler below backfill selectedTurnKey / observeActiveView.
  // Pushing the same path is a no-op navigation (rejected promise), swallowed here.
  router.push({ name: "ObserveTurnDetail", params: { turnKey: turnKey } }).catch(() => {});
}

function handleTurnDeleted(turnKey: string) {
  observeTurns.value = observeTurns.value.filter((turn) => turnIdentity(turn) !== turnKey);
  if (selectedTurnKey.value === turnKey || String(route.params.turnKey || "") === turnKey) {
    selectedTurnKey.value = null;
    observeActiveView.value = "turns";
    router.push("/observe/turn").catch(() => {});
  }
}

async function handleDeleteTurn(workspace: WorkspaceManifest) {
  if (deletingTurnKey.value) return;

  try {
    await ElMessageBox.confirm(
      t("diagnosis.deleteWorkspaceConfirm", { id: turnIdentity(workspace) }),
      t("common.deleteConfirm"),
      {
        type: "warning",
        confirmButtonText: t("common.delete"),
        cancelButtonText: t("common.cancel"),
        confirmButtonClass: "el-button--danger",
      }
    );

    const turnKey = turnIdentity(workspace);
    deletingTurnKey.value = turnKey;
    await diagnosisApi.deleteTurn(turnKey);
    handleTurnDeleted(turnKey);
    ElMessage.success(t("diagnosis.workspaceDeleted"));
  } catch (e: any) {
    if (e !== "cancel" && e !== "close" && e?.message !== "cancel") {
      ElMessage.error(e?.message || t("diagnosis.workspaceDeleteFailed"));
    }
  } finally {
    if (deletingTurnKey.value === turnIdentity(workspace)) {
      deletingTurnKey.value = null;
    }
  }
}

function selectLiveLogs() {
  selectedTurnKey.value = null;
  observeActiveView.value = "live-logs";
}

async function handleTurnSearch() {
  const id = turnSearchInput.value.trim();
  if (!id) return;

  // Check if already in list
  const existing = observeTurns.value.find((t) => turnIdentity(t) === id);
  if (existing) {
    selectTurn(id);
    turnSearchInput.value = "";
    return;
  }

  // Trigger on-demand build
  turnSearching.value = true;
  try {
    await diagnosisApi.buildTurn(id);
    // Refresh list and select
    await loadObserveTurns();
    selectTurn(id);
    turnSearchInput.value = "";
  } catch (e: any) {
    ElMessage.error(e?.message || t("diagnosis.workspaceBuildFailed"));
  } finally {
    turnSearching.value = false;
  }
}

function clearWorkspaceRouteFlags(turnKey: string, flags: Array<"collect" | "diagnose">) {
  if (String(route.params.turnKey || "") !== turnKey) return;

  const nextQuery = { ...route.query };
  for (const flag of flags) {
    delete nextQuery[flag];
  }
  router.replace({ path: route.path, query: nextQuery }).catch(() => {});
}

async function startTurnDiagnosisFromRoute(turnKey: string, opts?: { clearQuery?: boolean }) {
  if (String(route.params.turnKey || "") !== turnKey) return false;

  aiSidebarVisible.value = true;
  await nextTick();

  const started = await diagnosisSidebarRef.value?.startNewContextDiagnosis(
    AUTO_TURN_DIAGNOSIS_MESSAGE
  );

  if (!started) {
    ElMessage.error(t("diagnosis.requestFailed"));
  }

  if (opts?.clearQuery !== false) {
    clearWorkspaceRouteFlags(turnKey, ["diagnose"]);
  }

  return Boolean(started);
}

async function collectTurnFromRoute(turnKey: string, opts?: { diagnoseAfter?: boolean }) {
  if (routeWorkspaceCollecting.value && routeWorkspaceCollectingId.value === turnKey) return;

  routeWorkspaceCollecting.value = true;
  routeWorkspaceCollectingId.value = turnKey;
  let collected = false;
  try {
    await diagnosisApi.buildTurn(turnKey);
    collected = true;
    await loadObserveTurns();
    if (opts?.diagnoseAfter) {
      await startTurnDiagnosisFromRoute(turnKey, { clearQuery: false });
    }
  } catch (e: any) {
    ElMessage.error(e?.message || t("diagnosis.workspaceBuildFailed"));
  } finally {
    routeWorkspaceCollecting.value = false;
    routeWorkspaceCollectingId.value = null;

    const flags: Array<"collect" | "diagnose"> = ["collect"];
    if (opts?.diagnoseAfter || (!collected && isTurnDiagnoseRequested(route.query.diagnose))) {
      flags.push("diagnose");
    }
    clearWorkspaceRouteFlags(turnKey, flags);
  }
}

/* ------------------------------------------------------------------ */
/*  Autotest group state                                               */
/* ------------------------------------------------------------------ */

const autotestRuns = ref<AutotestRunMeta[]>([]);
const autotestRunsLoading = ref(false);
const selectedRunId = ref<string | null>(null);
const autotestActiveView = ref<AutotestActiveView>("run");
const deletingRunId = ref<string | null>(null);
const activeAutotestRunId = computed(
  () => autotestRuns.value.find((run) => isAutotestRunBusy(run))?.runId || null
);
const selectedAutotestRun = computed(() =>
  autotestRuns.value.find((run) => run.runId === selectedRunId.value)
);

function isAutotestRunBusy(run: AutotestRunMeta): boolean {
  return run.status === "running" || run.status === "stopping";
}

function createEmptyRunSummary(): AutotestRunMeta["summary"] {
  return {
    total: 0,
    correct: 0,
    wrong: 0,
    abnormal: 0,
  };
}

function createAutotestRunPlaceholder(runId: string): AutotestRunMeta {
  const now = new Date().toISOString();
  return {
    runId,
    caseSetId: "",
    caseSetName: "",
    status: "running",
    summary: createEmptyRunSummary(),
    createdAt: now,
    updatedAt: now,
  };
}

function ensureAutotestRunInList(runId: string | null = selectedRunId.value) {
  if (!runId) return;
  if (autotestRuns.value.some((run) => run.runId === runId)) return;
  autotestRuns.value = [createAutotestRunPlaceholder(runId), ...autotestRuns.value];
}

async function handleAutotestRunCreated(runId: string) {
  ensureAutotestRunInList(runId);
  await loadAutotestRuns(runId);
}

async function handleAutotestRunSettled(runId: string) {
  await loadAutotestRuns(runId);
}

async function loadAutotestRuns(visibleRunId: string | null = selectedRunId.value) {
  autotestRunsLoading.value = true;
  try {
    const res = await diagnosisApi.listRuns();
    autotestRuns.value = res.data || [];
  } catch (e: any) {
    autotestRuns.value = [];
    console.error("Failed to load autotest runs", e);
  } finally {
    ensureAutotestRunInList(visibleRunId);
    autotestRunsLoading.value = false;
  }
}

function selectAutotestRun(runId: string) {
  // Sync runId into the URL query so DiagnosisSidebar.detectContext() can pick it
  // up (URL = single source of truth for the diagnosis session context). Local
  // assignment is kept because switching between runs is a query-only navigation
  // (path stays /observe/results), which the path-based watcher below does not
  // re-trigger — so the inline content must be updated here directly.
  selectedRunId.value = runId;
  autotestActiveView.value = "run";
  router.push({ path: "/observe/results", query: { runId } }).catch(() => {});
}

function handleAutotestRunDeleted(runId: string) {
  autotestRuns.value = autotestRuns.value.filter((run) => run.runId !== runId);
  if (
    selectedRunId.value === runId ||
    String(route.params.runId || "") === runId ||
    String(route.query.runId || "") === runId
  ) {
    selectedRunId.value = null;
    autotestActiveView.value = "run";
    router.push("/observe/results").catch(() => {});
  }
}

async function handleDeleteAutotestRun(run: AutotestRunMeta) {
  if (deletingRunId.value) return;

  if (isAutotestRunBusy(run)) {
    ElMessage.warning(t("diagnosis.testBatchRunningPleaseStop"));
    return;
  }

  const title = run.caseSetName || run.runId;
  try {
    await ElMessageBox.confirm(
      t("diagnosis.deleteTestBatchConfirm", { title }),
      t("common.deleteConfirm"),
      {
        type: "warning",
        confirmButtonText: t("common.delete"),
        cancelButtonText: t("common.cancel"),
        confirmButtonClass: "el-button--danger",
      }
    );

    deletingRunId.value = run.runId;
    await diagnosisApi.deleteRun(run.runId);
    handleAutotestRunDeleted(run.runId);
    ElMessage.success(t("diagnosis.testBatchDeleted"));
  } catch (e: any) {
    if (e !== "cancel" && e !== "close" && e?.message !== "cancel") {
      ElMessage.error(e?.message || t("diagnosis.testBatchDeleteFailed"));
    }
  } finally {
    if (deletingRunId.value === run.runId) {
      deletingRunId.value = null;
    }
  }
}

function selectAutotestView(view: "test" | "cases") {
  selectedRunId.value = null;
  autotestActiveView.value = view;
  router.push(view === "test" ? "/observe/test" : "/observe/cases").catch(() => {});
}

/* ------------------------------------------------------------------ */
/*  Artifact retention                                                 */
/* ------------------------------------------------------------------ */

function retentionUpdating(artifactType: RetentionArtifactType, artifactId?: string | null) {
  return artifactId
    ? retentionUpdatingKey.value === artifactRetentionRequestKey(artifactType, artifactId)
    : false;
}

async function updateArtifactRetention(
  artifactType: RetentionArtifactType,
  artifactId: string,
  currentlyKept: boolean
) {
  const key = artifactRetentionRequestKey(artifactType, artifactId);
  if (retentionUpdatingKey.value) return;
  retentionUpdatingKey.value = key;

  try {
    const kept = await setArtifactRetention(artifactType, artifactId, !currentlyKept);
    if (artifactType === "turn-workspace") {
      observeTurns.value = observeTurns.value.map((workspace) =>
        turnIdentity(workspace) === artifactId ? { ...workspace, kept } : workspace
      );
    } else {
      autotestRuns.value = autotestRuns.value.map((run) =>
        run.runId === artifactId ? { ...run, kept } : run
      );
    }
  } catch (error: any) {
    ElMessage.error(error?.message || t("diagnosis.retentionUpdateFailed"));
  } finally {
    retentionUpdatingKey.value = null;
  }
}

function toggleTurnRetention(workspace: WorkspaceManifest) {
  return updateArtifactRetention("turn-workspace", turnIdentity(workspace), !!workspace.kept);
}

function toggleAutotestRunRetention(run: AutotestRunMeta) {
  return updateArtifactRetention("autotest-run", run.runId, !!run.kept);
}

/* ------------------------------------------------------------------ */
/*  Active group state                                                 */
/* ------------------------------------------------------------------ */

const activeGroup = ref<ObserveNavGroupKey>("diagnosis");

function isObserveNavGroupKey(group: string | undefined): group is ObserveNavGroupKey {
  return group === "diagnosis" || group === "observe" || group === "autotest" || group === "dsl";
}

watch(
  () => route.meta?.group as string | undefined,
  (group) => {
    if (isObserveNavGroupKey(group) && group !== activeGroup.value) {
      activeGroup.value = group;
    }
    if (group === "diagnosis") {
      aiSidebarVisible.value = false;
    }
  },
  { immediate: true }
);

// Handle direct navigation to observe sub-routes
watch(
  () => [route.path, route.params.turnKey, route.query.collect, route.query.diagnose] as const,
  ([p]) => {
    if (activeGroup.value === "observe") {
      // /observe/turn/:turnKey -> select Turn workspace.
      const turnKey = route.params.turnKey as string | undefined;
      if (turnKey) {
        selectedTurnKey.value = turnKey;
        observeActiveView.value = "turns";
        ensureSelectedTurnInList(turnKey);
        const shouldCollect = isTurnCollectRequested(route.query.collect);
        const shouldDiagnose = isTurnDiagnoseRequested(route.query.diagnose);
        if (shouldCollect) {
          void collectTurnFromRoute(turnKey, { diagnoseAfter: shouldDiagnose });
          return;
        }
        if (shouldDiagnose) {
          void startTurnDiagnosisFromRoute(turnKey);
        }
        return;
      }
      // /observe/live-logs -> switch to live logs
      if (p === "/observe/live-logs") {
        selectedTurnKey.value = null;
        observeActiveView.value = "live-logs";
      }
    } else if (activeGroup.value === "autotest") {
      if (p === "/observe/test") {
        autotestActiveView.value = "test";
        selectedRunId.value = null;
      } else if (p === "/observe/cases") {
        autotestActiveView.value = "cases";
        selectedRunId.value = null;
      } else if (p === "/observe/results") {
        autotestActiveView.value = "run";
        const qRunId = route.query.runId as string | undefined;
        if (qRunId) {
          selectedRunId.value = qRunId;
          ensureAutotestRunInList(qRunId);
        }
      }
    }
  },
  { immediate: true }
);

function handleGroupSelect(key: ObserveNavGroupKey) {
  activeGroup.value = key;
  // Navigate to first item in that group if current route is not in it
  const currentGroup = route.meta?.group as string | undefined;
  if (currentGroup === key) return;

  if (key === "diagnosis") {
    router.push("/observe/diagnosis");
  } else if (key === "observe") {
    router.push("/observe/turn");
  } else if (key === "autotest") {
    router.push("/observe/test");
  } else if (key === "dsl") {
    router.push("/observe/dsl");
  }
}

/* ------------------------------------------------------------------ */
/*  Sidebar state                                                      */
/* ------------------------------------------------------------------ */

const COLLAPSED_KEY = "observe-sidebar-collapsed";
const collapsed = ref(true);

onMounted(() => {
  const stored = localStorage.getItem(COLLAPSED_KEY);
  if (stored !== null) collapsed.value = stored === "true";

  // Entering observability is the explicit lazy-load boundary for backend config.
  void diagnosisApi.initializeLogSourceConfig().catch((error) => {
    console.warn("Failed to initialize observe backend config", error);
  });
});

function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  localStorage.setItem(COLLAPSED_KEY, String(collapsed.value));
}

/* (Old autotest menu items section removed — autotest now uses custom sidebar) */

/* ------------------------------------------------------------------ */
/*  Diagnosis Agent group — session management in sidebar              */
/* ------------------------------------------------------------------ */

const {
  sessions,
  currentSessionId,
  sessionsLoading,
  loadSessions,
  deleteSession,
  selectSession,
  clearSession,
} = useAgentChat();

// Load sessions when entering diagnosis group, turns when entering observe group, runs when entering autotest group
watch(
  activeGroup,
  (g) => {
    if (g === "diagnosis") {
      loadSessions();
    } else if (g === "observe") {
      loadObserveTurns();
    } else if (g === "autotest") {
      loadAutotestRuns();
    }
  },
  { immediate: true }
);

function handleNewSession() {
  clearSession();
  router.push("/observe/diagnosis");
}

async function handleSelectSession(session: AgentSession) {
  await selectSession(session.id);
  // Navigate to diagnosis page with session id in query
  router.push({ path: "/observe/diagnosis", query: { sessionId: session.id } });
}

async function handleDeleteSession(id: string) {
  await deleteSession(id);
}

/* ------------------------------------------------------------------ */
/*  Global AI sidebar (continued)                                      */
/* ------------------------------------------------------------------ */

const showAiButton = computed(() => activeGroup.value !== "diagnosis");

function toggleAiSidebar() {
  aiSidebarVisible.value = !aiSidebarVisible.value;
}

/* ------------------------------------------------------------------ */
/*  Navigation helpers                                                 */
/* ------------------------------------------------------------------ */

function goBack() {
  router.push("/admin");
}

// Check if a diagnosis sub-route is active (knowledge)
function isDiagnosisSubRoute(path: string): boolean {
  return route.path === path;
}
</script>

<template>
  <div class="observe-layout">
    <ObserveHeader
      :account="account"
      :active-group="activeGroup"
      :show-ai-button="showAiButton"
      :ai-sidebar-visible="aiSidebarVisible"
      @group-select="handleGroupSelect"
      @toggle-ai-sidebar="toggleAiSidebar"
      @go-back="goBack"
    />

    <!-- Body: sidebar + main -->
    <div class="observe-body">
      <ObserveSidebar
        v-if="activeGroup !== 'dsl'"
        v-model:turn-search-input="turnSearchInput"
        :active-group="activeGroup"
        :collapsed="collapsed"
        :knowledge-active="isDiagnosisSubRoute('/observe/knowledge')"
        :sessions="sessions"
        :current-session-id="currentSessionId"
        :sessions-loading="sessionsLoading"
        :observe-turns="observeTurns"
        :observe-turns-loading="observeTurnsLoading"
        :selected-turn-key="selectedTurnKey"
        :observe-active-view="observeActiveView"
        :turn-searching="turnSearching"
        :deleting-turn-key="deletingTurnKey"
        :autotest-runs="autotestRuns"
        :autotest-runs-loading="autotestRunsLoading"
        :selected-run-id="selectedRunId"
        :autotest-active-view="autotestActiveView"
        :deleting-run-id="deletingRunId"
        :retention-updating-key="retentionUpdatingKey"
        @toggle-collapsed="toggleCollapsed"
        @new-session="handleNewSession"
        @open-knowledge="router.push('/observe/knowledge')"
        @select-session="handleSelectSession"
        @delete-session="handleDeleteSession"
        @select-live-logs="selectLiveLogs"
        @search-turn="handleTurnSearch"
        @select-turn="selectTurn"
        @delete-turn="handleDeleteTurn"
        @toggle-turn-retention="toggleTurnRetention"
        @select-autotest-view="selectAutotestView"
        @select-autotest-run="selectAutotestRun"
        @delete-autotest-run="handleDeleteAutotestRun"
        @toggle-autotest-run-retention="toggleAutotestRunRetention"
      />

      <!-- Main content -->
      <main class="observe-main">
        <!-- Observe group: inline content based on sidebar selection -->
        <template v-if="activeGroup === 'observe'">
          <LiveLogsPage v-if="observeActiveView === 'live-logs'" />
          <div
            v-else-if="selectedTurnKey && isSelectedWorkspaceCollecting"
            v-loading="true"
            class="observe-turn-loading"
          />
          <ArtifactDetail
            v-else-if="selectedTurnKey"
            :api-prefix="observeApiPrefix"
            :title="selectedTurnKey"
            :trigger-build-url="observeBuildUrl"
            :trigger-build-body="observeBuildBody"
            :kept="selectedTurn?.kept"
            :retention-loading="retentionUpdating('turn-workspace', selectedTurnKey)"
            @loaded="handleObserveArtifactLoaded"
            @toggle-retention="selectedTurn && toggleTurnRetention(selectedTurn)"
          />
          <EmptyState
            v-else
            icon="search"
            :title="t('observe.selectOrSearchTurn')"
            :subtitle="t('observe.selectOrSearchTurnHint')"
          />
        </template>

        <!-- Autotest group: inline content based on sidebar selection -->
        <template v-else-if="activeGroup === 'autotest'">
          <CaseArtifactPage v-if="route.params.caseId" />
          <TestPage
            v-else-if="autotestActiveView === 'test' && !selectedRunId"
            :initial-run-id="activeAutotestRunId"
            @run-created="handleAutotestRunCreated"
            @run-settled="handleAutotestRunSettled"
          />
          <TestcasesPage v-else-if="autotestActiveView === 'cases' && !selectedRunId" />
          <ResultsPage
            v-else-if="selectedRunId && autotestActiveView === 'run'"
            :run-id="selectedRunId"
            :kept="selectedAutotestRun?.kept"
            :retention-loading="retentionUpdating('autotest-run', selectedRunId)"
            @deleted="handleAutotestRunDeleted"
            @settled="handleAutotestRunSettled"
            @toggle-retention="
              selectedAutotestRun && toggleAutotestRunRetention(selectedAutotestRun)
            "
          />
          <EmptyState
            v-else
            icon="file-text"
            :title="t('observe.selectOrStartTest')"
            :subtitle="t('observe.selectOrStartTestHint')"
          />
        </template>

        <!-- DSL test: a single-page tool with left-right split in the main area, no left sidebar -->
        <DslTestPage v-else-if="activeGroup === 'dsl'">
          <template #result-tabs="slotProps"><slot name="dsl-result-tabs" v-bind="slotProps" /></template>
        </DslTestPage>

        <!-- Other groups: use router-view -->
        <router-view v-else />
      </main>

      <!-- Global AI sidebar -->
      <DiagnosisSidebar ref="diagnosisSidebarRef" v-model:visible="aiSidebarVisible" />
    </div>
  </div>
</template>

<style>
/* ------------------------------------------------------------------ */
/*  Observe elevation CSS variables (non-scoped, :root level)          */
/* ------------------------------------------------------------------ */

:root {
  --observe-bg-top: #fff;
  --observe-bg-sidebar: #f7f7f8;
  --observe-bg-main: #fff;
  --observe-bg-card: #f9f9f9;
  --observe-bg-hover: #f0f0f0;
  --observe-bg-active: #e8e8e8;
  --observe-border: #e5e5e5;
}

html.dark {
  --observe-bg-top: #1a1a1a;
  --observe-bg-sidebar: #212121;
  --observe-bg-main: #2a2a2a;
  --observe-bg-card: #333;
  --observe-bg-hover: #3a3a3a;
  --observe-bg-active: #404040;
  --observe-border: #3a3a3a;
}

/* Brighten secondary text in the observe module in dark mode to avoid insufficient contrast with the dark background */
html.dark .observe-layout {
  --el-text-color-secondary: #aaa;
  --el-text-color-placeholder: #777;
}
</style>

<style scoped>
.observe-layout {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ------------------------------------------------------------------ */
/*  Body                                                               */
/* ------------------------------------------------------------------ */

.observe-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

/* ------------------------------------------------------------------ */
/*  Main content                                                       */
/* ------------------------------------------------------------------ */

.observe-main {
  flex: 1;
  overflow: hidden;
  padding: 16px;
  min-height: 0;
  min-width: 0;
  background: var(--observe-bg-main);
}

.observe-turn-loading {
  height: 100%;
  min-height: 240px;
}

/* ------------------------------------------------------------------ */
/*  Responsive                                                         */
/* ------------------------------------------------------------------ */

@media (max-width: 768px) {
  .observe-main {
    padding: 10px;
  }
}
</style>
