<script setup lang="ts">
import type { SessionInfo as AgentSession } from "@ontomato/contracts/diagnosis";
import type { ArtifactType as RetentionArtifactType } from "@ontomato/contracts/observe";
import type {
  WorkspaceManifest,
  AutotestRunMeta,
  AutotestActiveView,
  ObserveActiveView,
  ObserveNavGroupKey,
} from "./types";
import { computed } from "vue";
import {
  Activity,
  BookOpen,
  Database,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
} from "lucide-vue-next";
import { useLocale } from "../../../../composables/useLocale";
import { relativeTime } from "../../../../utils/relative-time";
import { sessionContextLabel } from "../../utils/session-context";
import { artifactRetentionRequestKey } from "../../api";
import CompactSidebarHistoryItem from "./CompactSidebarHistoryItem.vue";
import SidebarListItem from "../agent-chat/SidebarListItem.vue";

const props = defineProps<{
  activeGroup: ObserveNavGroupKey;
  collapsed: boolean;
  knowledgeActive: boolean;
  sessions: AgentSession[];
  currentSessionId?: string | null;
  sessionsLoading: boolean;
  observeTurns: WorkspaceManifest[];
  observeTurnsLoading: boolean;
  selectedTurnKey?: string | null;
  observeActiveView: ObserveActiveView;
  turnSearchInput: string;
  turnSearching: boolean;
  deletingTurnKey?: string | null;
  autotestRuns: AutotestRunMeta[];
  autotestRunsLoading: boolean;
  selectedRunId?: string | null;
  autotestActiveView: AutotestActiveView;
  deletingRunId?: string | null;
  retentionUpdatingKey?: string | null;
}>();

const emit = defineEmits<{
  "toggle-collapsed": [];
  "new-session": [];
  "open-knowledge": [];
  "select-session": [session: AgentSession];
  "delete-session": [id: string];
  "select-live-logs": [];
  "update:turnSearchInput": [value: string];
  "search-turn": [];
  "select-turn": [turnKey: string];
  "delete-turn": [workspace: WorkspaceManifest];
  "toggle-turn-retention": [workspace: WorkspaceManifest];
  "select-autotest-view": [view: "test" | "cases"];
  "select-autotest-run": [runId: string];
  "delete-autotest-run": [run: AutotestRunMeta];
  "toggle-autotest-run-retention": [run: AutotestRunMeta];
}>();

const { t } = useLocale();

const turnSearchModel = computed({
  get: () => props.turnSearchInput,
  set: (value: string) => emit("update:turnSearchInput", value),
});

function keptFirst<T extends { kept?: boolean }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => Number(!!right.kept) - Number(!!left.kept));
}

const orderedObserveTurns = computed(() => keptFirst(props.observeTurns));
const orderedAutotestRuns = computed(() => keptFirst(props.autotestRuns));

function turnIdentity(workspace: WorkspaceManifest): string {
  return workspace.turnKey || workspace.workspaceId;
}

function formatTurnTitle(workspace: WorkspaceManifest): string {
  return workspace.question?.replace(/\s+/g, " ").trim() || turnIdentity(workspace);
}

function formatTurnSubtitle(workspace: WorkspaceManifest): string {
  return workspace.createdAt ? relativeTime(workspace.createdAt) : "";
}

function formatSessionSubtitle(session: AgentSession): string {
  return [sessionContextLabel(session), session.createdAt].filter(Boolean).join(" · ");
}

function formatRunSubtitle(run: AutotestRunMeta): string {
  const parts: string[] = [];
  if (run.summary.total > 0) {
    const correct = Number.isFinite(run.summary.correct) ? run.summary.correct : null;
    parts.push(
      correct === null
        ? t("admin.nTestcases", { n: run.summary.total })
        : t("admin.correctCount", { correct, total: run.summary.total })
    );
  }
  if (run.createdAt) {
    parts.push(relativeTime(run.createdAt));
  }
  return parts.join(" · ");
}

function isAutotestRunBusy(run: AutotestRunMeta): boolean {
  return run.status === "running" || run.status === "stopping";
}

function retentionUpdating(artifactType: RetentionArtifactType, artifactId: string): boolean {
  return props.retentionUpdatingKey === artifactRetentionRequestKey(artifactType, artifactId);
}
</script>

<template>
  <aside :class="['observe-aside', { collapsed }]">
    <template v-if="activeGroup === 'diagnosis'">
      <div class="diagnosis-sidebar-content">
        <div class="diagnosis-fixed">
          <div class="aside-top-row">
            <div
              :class="['diagnosis-action-item', 'no-margin', { collapsed }]"
              @click="emit('new-session')"
            >
              <el-icon><Plus /></el-icon>
              <span v-if="!collapsed" class="action-label">
                {{ t("diagnosis.newConversation") }}
              </span>
            </div>
          </div>
          <div
            :class="['diagnosis-action-item', { active: knowledgeActive, collapsed }]"
            @click="emit('open-knowledge')"
          >
            <el-icon><BookOpen /></el-icon>
            <span v-if="!collapsed" class="action-label">{{ t("admin.knowledgeBase") }}</span>
          </div>
        </div>

        <div v-if="!collapsed" class="diagnosis-sessions">
          <div class="sessions-divider">
            <span class="sessions-divider-text">{{ t("chat.historyConversations") }}</span>
          </div>
          <div v-loading="sessionsLoading" class="sessions-scroll">
            <div
              v-for="s in sessions"
              :key="s.id"
              :class="['session-item', { active: currentSessionId === s.id }]"
              @click="emit('select-session', s)"
            >
              <div class="session-item-title">
                {{ s.title || s.id }}
              </div>
              <div v-if="sessionContextLabel(s)" class="session-item-context">
                {{ sessionContextLabel(s) }}
              </div>
              <div v-if="s.createdAt" class="session-item-meta">
                {{ s.createdAt }}
              </div>
              <el-button
                class="session-delete-btn"
                text
                size="small"
                :icon="Trash2"
                @click.stop="emit('delete-session', s.id)"
              />
            </div>
            <div v-if="sessions.length === 0 && !sessionsLoading" class="sessions-empty">
              {{ t("chat.noConversations") }}
            </div>
          </div>
        </div>

        <div v-if="collapsed" v-loading="sessionsLoading" class="compact-history-list">
          <CompactSidebarHistoryItem
            v-for="s in sessions"
            :key="s.id"
            :title="s.title || s.id"
            :subtitle="formatSessionSubtitle(s)"
            :active="currentSessionId === s.id"
            @click="emit('select-session', s)"
          />
        </div>
      </div>
    </template>

    <template v-else-if="activeGroup === 'observe'">
      <div class="observe-sidebar-content">
        <div class="observe-fixed">
          <div class="aside-top-row">
            <div
              :class="[
                'diagnosis-action-item',
                'no-margin',
                { active: observeActiveView === 'live-logs', collapsed },
              ]"
              @click="emit('select-live-logs')"
            >
              <el-icon><Activity /></el-icon>
              <span v-if="!collapsed" class="action-label">{{ t("nav.liveLogs") }}</span>
            </div>
          </div>

          <div v-if="!collapsed" v-loading="turnSearching" class="observe-search">
            <el-input
              v-model="turnSearchModel"
              :placeholder="t('observe.inputTurnKey')"
              size="small"
              clearable
              @keyup.enter="emit('search-turn')"
            >
              <template #prefix>
                <el-icon><Database /></el-icon>
              </template>
            </el-input>
          </div>
        </div>

        <div v-if="!collapsed" class="observe-turns">
          <div class="sessions-divider">
            <span class="sessions-divider-text">{{ t("nav.turnList") }}</span>
          </div>
          <div v-loading="observeTurnsLoading" class="sessions-scroll">
            <SidebarListItem
              v-for="ot in orderedObserveTurns"
              :key="turnIdentity(ot)"
              :title="formatTurnTitle(ot)"
              :subtitle="formatTurnSubtitle(ot)"
              :active="selectedTurnKey === turnIdentity(ot) && observeActiveView === 'turns'"
              keepable
              :kept="ot.kept"
              :keep-loading="retentionUpdating('turn-workspace', turnIdentity(ot))"
              deletable
              :delete-loading="deletingTurnKey === turnIdentity(ot)"
              :delete-tooltip="t('observe.deleteWorkspace')"
              @click="emit('select-turn', turnIdentity(ot))"
              @toggle-keep="emit('toggle-turn-retention', ot)"
              @delete-item="emit('delete-turn', ot)"
            />
            <div v-if="observeTurns.length === 0 && !observeTurnsLoading" class="sessions-empty">
              {{ t("observe.noTurns") }}
            </div>
          </div>
        </div>

        <div v-if="collapsed" v-loading="observeTurnsLoading" class="compact-history-list">
          <CompactSidebarHistoryItem
            v-for="ot in orderedObserveTurns"
            :key="turnIdentity(ot)"
            :title="formatTurnTitle(ot)"
            :subtitle="formatTurnSubtitle(ot)"
            :status="
              ot.status === 'collecting' ? 'running' : ot.status === 'failed' ? 'failed' : undefined
            "
            :active="selectedTurnKey === turnIdentity(ot) && observeActiveView === 'turns'"
            :kept="ot.kept"
            @click="emit('select-turn', turnIdentity(ot))"
          />
        </div>
      </div>
    </template>

    <template v-else-if="activeGroup === 'autotest'">
      <div class="observe-sidebar-content">
        <div class="observe-fixed">
          <div class="aside-top-row">
            <div
              :class="[
                'diagnosis-action-item',
                'no-margin',
                { active: autotestActiveView === 'test' && !selectedRunId, collapsed },
              ]"
              @click="emit('select-autotest-view', 'test')"
            >
              <el-icon><List /></el-icon>
              <span v-if="!collapsed" class="action-label">
                {{ t("program.testExecution") }}
              </span>
            </div>
          </div>
          <div
            :class="[
              'diagnosis-action-item',
              { active: autotestActiveView === 'cases' && !selectedRunId, collapsed },
            ]"
            @click="emit('select-autotest-view', 'cases')"
          >
            <el-icon><BookOpen /></el-icon>
            <span v-if="!collapsed" class="action-label">{{ t("nav.testCases") }}</span>
          </div>
        </div>

        <div v-if="!collapsed" class="observe-turns">
          <div class="sessions-divider">
            <span class="sessions-divider-text">{{ t("observe.testBatch") }}</span>
          </div>
          <div v-loading="autotestRunsLoading" class="sessions-scroll">
            <SidebarListItem
              v-for="run in orderedAutotestRuns"
              :key="run.runId"
              :title="run.caseSetName || run.runId.substring(0, 8)"
              :subtitle="formatRunSubtitle(run)"
              :status="isAutotestRunBusy(run) ? 'running' : undefined"
              :active="selectedRunId === run.runId && autotestActiveView === 'run'"
              keepable
              :kept="run.kept"
              :keep-loading="retentionUpdating('autotest-run', run.runId)"
              deletable
              :delete-disabled="isAutotestRunBusy(run)"
              :delete-loading="deletingRunId === run.runId"
              :delete-tooltip="
                isAutotestRunBusy(run) ? t('observe.cannotDeleteRunning') : t('observe.deleteBatch')
              "
              @click="emit('select-autotest-run', run.runId)"
              @toggle-keep="emit('toggle-autotest-run-retention', run)"
              @delete-item="emit('delete-autotest-run', run)"
            />
            <div v-if="autotestRuns.length === 0 && !autotestRunsLoading" class="sessions-empty">
              {{ t("observe.noTestBatches") }}
            </div>
          </div>
        </div>

        <div v-if="collapsed" v-loading="autotestRunsLoading" class="compact-history-list">
          <CompactSidebarHistoryItem
            v-for="run in orderedAutotestRuns"
            :key="run.runId"
            :title="run.caseSetName || run.runId.substring(0, 8)"
            :subtitle="formatRunSubtitle(run)"
            :status="isAutotestRunBusy(run) ? 'running' : undefined"
            :active="selectedRunId === run.runId && autotestActiveView === 'run'"
            :kept="run.kept"
            @click="emit('select-autotest-run', run.runId)"
          />
        </div>
      </div>
    </template>

    <div class="aside-collapse-toggle">
      <el-tooltip
        :content="collapsed ? t('observe.expandSidebar') : t('observe.collapseSidebar')"
        placement="right"
        :disabled="!collapsed"
      >
        <div :class="['diagnosis-action-item', { collapsed }]" @click="emit('toggle-collapsed')">
          <el-icon><component :is="collapsed ? PanelLeftOpen : PanelLeftClose" /></el-icon>
          <span v-if="!collapsed" class="action-label">{{ t("observe.collapse") }}</span>
        </div>
      </el-tooltip>
    </div>
  </aside>
</template>

<style scoped>
.observe-aside {
  width: 220px;
  background: var(--observe-bg-sidebar);
  border-right: 1px solid var(--observe-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: width 0.3s ease;
}

.observe-aside.collapsed {
  width: 64px;
}

.aside-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.observe-aside.collapsed .aside-top-row {
  flex-direction: column;
  align-items: center;
}

.aside-top-row .diagnosis-action-item {
  flex: 1;
  min-width: 0;
}

.observe-aside.collapsed .aside-top-row .diagnosis-action-item {
  flex: none;
}

.aside-collapse-toggle {
  margin-top: auto;
  padding: 8px;
  border-top: 1px solid var(--observe-border, var(--el-border-color-light));
}

.diagnosis-action-item.no-margin {
  margin-bottom: 0;
}

.diagnosis-sidebar-content,
.observe-sidebar-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.diagnosis-fixed,
.observe-fixed {
  padding: 8px 8px 0;
  flex-shrink: 0;
}

.diagnosis-action-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--el-text-color-regular);
  transition: all 0.2s;
  user-select: none;
  margin-bottom: 2px;
}

.diagnosis-action-item:hover {
  color: var(--el-text-color-primary);
  background: var(--observe-bg-hover);
}

.diagnosis-action-item.active {
  background: var(--observe-bg-active);
  color: var(--el-color-primary);
  font-weight: 500;
}

.diagnosis-action-item.collapsed {
  justify-content: center;
  width: 44px;
  height: 44px;
  min-height: 44px;
  padding: 0;
  margin-right: auto;
  margin-left: auto;
  box-sizing: border-box;
}

.diagnosis-action-item .el-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.action-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.diagnosis-sessions,
.observe-turns {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.sessions-divider {
  padding: 8px 12px 4px;
  flex-shrink: 0;
}

.sessions-divider-text {
  font-size: 11px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.sessions-scroll {
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 4px 8px 8px;
  min-height: 0;
}

.session-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 2px;
  transition: background 0.15s;
  position: relative;
}

.session-item:hover {
  background: var(--observe-bg-hover);
}

.session-item.active {
  background: var(--observe-bg-active);
}

.session-item-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 20px;
}

.session-item-meta {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}

.session-item-context {
  display: inline-flex;
  max-width: calc(100% - 24px);
  margin-top: 4px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-size: 10px;
  line-height: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-delete-btn {
  position: absolute;
  right: 4px;
  top: 6px;
  opacity: 0;
  transition: opacity 0.15s;
  color: var(--el-color-danger) !important;
  font-size: 12px;
  padding: 2px !important;
}

.session-item:hover .session-delete-btn {
  opacity: 1;
}

.sessions-empty {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  text-align: center;
  padding: 16px 0;
}

.compact-history-list {
  flex: 1;
  min-height: 0;
  padding: 8px 10px;
  border-top: 1px solid var(--observe-border, var(--el-border-color-light));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

.observe-search {
  padding: 6px 4px 8px;
}

.observe-search :deep(.el-input__wrapper) {
  border-radius: 6px;
}

@media (max-width: 768px) {
  .observe-aside {
    width: 64px;
  }
}
</style>
