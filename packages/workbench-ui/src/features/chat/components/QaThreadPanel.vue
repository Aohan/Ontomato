<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useChatStore } from "../stores/chat";
import { useAnalysisStore } from "../../analysis";
import { useDashboardStore } from "../../dashboard";
import { ArrowLeft, MessageSquare, MessageSquarePlus, Pencil, Trash2 } from "lucide-vue-next";
import { useLocale } from "../../../composables/useLocale";
import { formatRelativeTime } from "../../../utils/relative-time";
import { getAgentColor, getAgentIcon, getAgentIconComponent } from "../../workbench";
import type { QAThread, WorkbenchAgent } from "../../workbench";

/** The Q&A entry's name, description, and avatar belong to the workbench appearance and are passed in after the workbench assembles them. */
defineProps<{ agent: WorkbenchAgent; mobile?: boolean }>();

const chatStore = useChatStore();
const analysisStore = useAnalysisStore();
const dashboardStore = useDashboardStore();
const {
  threads,
  threadsLoading: loading,
  hasMoreThreads: hasMore,
  currentThreadId,
} = storeToRefs(chatStore);

const emit = defineEmits<{
  "update:currentView": [view: "chat"];
  resetWorkspace: [];
  editAgent: [];
  back: [];
  openWorkspace: [];
}>();

function handleNewThread() {
  void dashboardStore.selectDashboard();
  analysisStore.closeCurrentTask();
  chatStore.startNewConversation();
  emit("update:currentView", "chat");
  emit("openWorkspace");
}

async function handleSelectThread(thread: QAThread) {
  void dashboardStore.selectDashboard();
  analysisStore.closeCurrentTask();
  await chatStore.selectThread(thread);
  emit("update:currentView", "chat");
  emit("openWorkspace");
}

const { t } = useLocale();
</script>

<template>
  <div class="mid-panel">
    <div class="mid-header">
      <button
        v-if="mobile"
        type="button"
        class="mobile-list-back"
        :aria-label="t('common.back')"
        @click="emit('back')"
      >
        <ArrowLeft :size="19" />
      </button>
      <div class="mid-agent-info">
        <div class="mid-agent-avatar" :style="{ background: getAgentColor(agent) }">
          <component :is="getAgentIconComponent(agent) || getAgentIcon(agent)" :size="22" />
        </div>
        <div class="mid-agent-text">
          <div class="mid-agent-name" :title="agent.name">{{ agent.name }}</div>
          <div class="mid-agent-desc" :title="agent.description">
            {{ agent.description }}
          </div>
        </div>
        <button
          class="qa-action-btn"
          :aria-label="t('appearance.qa')"
          :title="t('appearance.qa')"
          @click="emit('editAgent')"
        >
          <Pencil :size="16" />
        </button>
      </div>
      <button class="btn-create" type="button" @click="handleNewThread()">
        <MessageSquarePlus :size="16" />
        {{ t("chat.newSession") }}
      </button>
    </div>
    <div v-loading="loading" class="task-groups">
      <template v-if="threads.length === 0 && !loading">
        <div class="task-placeholder">
          <div class="placeholder-icon-wrapper">
            <MessageSquare class="placeholder-icon" :size="32" />
          </div>
          <div class="placeholder-text">{{ t("chat.noSessions") }}</div>
          <div class="placeholder-sub">{{ t("chat.noSessionsHint") }}</div>
        </div>
      </template>
      <div v-else class="task-group">
        <div v-if="threads.length > 0" class="history-list-heading">
          <span class="history-list-marker" aria-hidden="true"></span>
          {{ t("chat.historySession") }}
        </div>
        <div
          v-for="thread in threads"
          :key="thread.threadId"
          class="qa-history-card history-list-item"
          :class="{ active: currentThreadId === thread.threadId }"
          @click="handleSelectThread(thread)"
        >
          <div class="qa-history-title history-list-title" :title="thread.title">
            {{ thread.title || t("chat.unnamedSession") }}
          </div>
          <div class="history-list-meta">
            {{ formatRelativeTime(thread.createdAt) }}
          </div>
          <div class="qa-history-actions" @click.stop>
            <button
              class="qa-action-btn"
              :title="t('chat.rename')"
              @click="chatStore.renameThread(thread, chatStore.loadThreads)"
            >
              <Pencil :size="14" />
            </button>
            <button
              class="qa-action-btn qa-del-btn"
              :title="t('common.delete')"
              @click="
                chatStore.deleteThread(
                  thread.threadId,
                  () => emit('resetWorkspace'),
                  chatStore.loadThreads
                )
              "
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
        <div v-if="hasMore" class="load-more-row">
          <button class="load-more-btn" :disabled="loading" @click="chatStore.loadMoreThreads()">
            {{ t("common.loadMore") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="../../../styles/history-list.css"></style>
<style scoped>
.mid-panel {
  min-width: 0;
  min-height: 0;
  background: var(--el-fill-color-extra-light);
  border: none;
  border-radius: 24px;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
  box-shadow: var(--shadow-card);
}
.mid-header {
  flex-shrink: 0;
  padding: 20px 20px 16px;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.mobile-list-back {
  display: none;
}
.mid-agent-info {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.mid-agent-avatar {
  width: 46px;
  height: 46px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--el-color-primary) 6%, transparent);
  background: color-mix(in srgb, var(--el-color-primary) 10%, var(--el-bg-color));
  color: var(--el-color-primary);
}
.mid-agent-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}
.mid-agent-text {
  flex: 1;
  min-width: 0;
}
.mid-agent-name,
.mid-agent-desc {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mid-agent-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.btn-create {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 40px;
  padding: 10px;
  background: linear-gradient(135deg, var(--el-color-primary), var(--el-color-primary-light-3));
  color: var(--on-primary);
  border: none;
  border-radius: 14px;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s,
    box-shadow 0.15s,
    transform 0.15s;
  box-shadow: var(--shadow-primary);
}
.btn-create:hover {
  background: linear-gradient(135deg, var(--el-color-primary-dark-2), var(--el-color-primary));
  box-shadow: var(--shadow-primary-hover);
  transform: translateY(-1px);
}
.btn-create:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  .btn-create {
    transition: none;
  }
  .btn-create:hover {
    transform: none;
  }
}
.task-groups {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  background: color-mix(in srgb, var(--el-bg-color) 30%, var(--el-bg-color-page) 70%);
}
.task-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 12px;
  text-align: center;
}
.placeholder-icon-wrapper {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: var(--el-color-primary-light-9);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
}
.placeholder-icon {
  color: var(--el-color-primary);
}
.placeholder-text {
  font-size: 14px;
  color: var(--el-text-color-primary);
  font-weight: 500;
}
.placeholder-sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}
.task-group {
  margin-bottom: 16px;
}
.qa-history-title {
  padding-inline-end: 52px;
}
.qa-history-actions {
  position: absolute;
  top: 12px;
  right: 12px;
  opacity: 0;
  transition: opacity 0.15s ease;
  display: flex;
  gap: 4px;
}
.qa-history-card:hover .qa-history-actions,
.qa-history-card:focus-within .qa-history-actions {
  opacity: 1;
}
.qa-action-btn {
  border: none;
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.qa-action-btn:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.qa-action-btn.qa-del-btn:hover {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}
.load-more-row {
  display: flex;
  justify-content: center;
  padding: 6px 0 12px;
}
.load-more-btn {
  border: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 12px;
  cursor: pointer;
}
.load-more-btn:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--el-color-primary) 45%, transparent);
  color: var(--el-color-primary);
}
.load-more-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.task-groups::-webkit-scrollbar {
  width: 4px;
}
.task-groups::-webkit-scrollbar-track {
  background: transparent;
}
.task-groups::-webkit-scrollbar-thumb {
  background: var(--el-border-color-dark);
  border-radius: 4px;
}
@media (max-width: 700px) {
  :where(html.workbench-mobile-navigation) .mid-header {
    padding: calc(10px + env(safe-area-inset-top)) 14px 14px;
  }
  :where(html.workbench-mobile-navigation) .mobile-list-back {
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 8px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--el-text-color-regular);
  }
  :where(html.workbench-mobile-navigation) .mobile-list-back:active {
    background: var(--el-fill-color);
  }
  :where(html.workbench-mobile-navigation) .mid-agent-info {
    margin-bottom: 12px;
  }
  :where(html.workbench-mobile-navigation) .mid-agent-avatar {
    width: 40px;
    height: 40px;
    border-radius: 12px;
  }
  :where(html.workbench-mobile-navigation) .task-groups {
    padding: 12px;
    padding-bottom: calc(12px + env(safe-area-inset-bottom));
  }
  :where(html.workbench-mobile-navigation) .qa-history-actions {
    opacity: 1;
  }
  :where(html.workbench-mobile-navigation) .btn-create:hover {
    transform: none;
  }
}
.task-groups::-webkit-scrollbar-thumb:hover {
  background: var(--el-text-color-secondary);
}
</style>
