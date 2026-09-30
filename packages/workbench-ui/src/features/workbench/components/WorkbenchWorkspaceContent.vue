<script setup lang="ts">
import { storeToRefs } from "pinia";
import { Clock, FileText, MessageSquare } from "lucide-vue-next";
import { useLocale } from "../../../composables/useLocale";
import type { WorkbenchSelectionMode } from "../types";
import { AnalysisChatView, AnalysisReportView, useAnalysisStore } from "../../analysis";
import { ChatView } from "../../chat";
import WorkbenchInputBar from "./WorkbenchInputBar.vue";

type WorkspaceView = "chat" | "report";

defineProps<{
  selectionMode: WorkbenchSelectionMode;
  currentView: WorkspaceView;
}>();

const emit = defineEmits<{
  "update:currentView": [value: WorkspaceView];
}>();

const { t } = useLocale();
const { currentTask, hasReportArtifact, showPendingTaskNotice, isSelectedLatestRun } =
  storeToRefs(useAnalysisStore());
</script>

<template>
  <div v-if="selectionMode !== 'qa'" class="view-tabs">
    <button
      class="view-tab"
      :class="{ active: currentView === 'chat' }"
      @click="emit('update:currentView', 'chat')"
    >
      <MessageSquare :size="14" class="view-tab-icon" />
      {{ t("analysis.conversationView") }}
    </button>
    <button
      v-if="hasReportArtifact"
      class="view-tab"
      :class="{ active: currentView === 'report' }"
      @click="emit('update:currentView', 'report')"
    >
      <FileText :size="14" class="view-tab-icon" />
      {{ t("analysis.reportView") }}
    </button>
  </div>

  <div v-if="showPendingTaskNotice" class="pending-task-notice">
    <div class="notice-icon-wrapper">
      <Clock :size="32" class="notice-icon" />
    </div>
    <div class="notice-title">
      {{ t("analysis.taskWaitingSchedule", { name: currentTask?.name }) }}
    </div>
    <div class="notice-desc">{{ t("analysis.taskWaitingScheduleHint") }}</div>
  </div>

  <template v-else>
    <div v-show="currentView === 'chat' || selectionMode === 'qa'" class="chat-stream-content">
      <div v-show="currentView === 'chat' || selectionMode === 'qa'" class="right-body">
        <template v-if="selectionMode === 'qa'">
          <ChatView />
        </template>
        <template v-else>
          <AnalysisChatView />
        </template>
      </div>
      <!-- Sending is not allowed while reviewing a historical run, to avoid writing new instructions into an old turn. -->
      <WorkbenchInputBar v-if="isSelectedLatestRun" :selection-mode="selectionMode" />
    </div>

    <div
      v-if="hasReportArtifact && currentView === 'report' && selectionMode !== 'qa'"
      class="right-body report-body"
    >
      <AnalysisReportView />
    </div>
  </template>
</template>

<style scoped>
.view-tabs {
  display: flex;
  padding: 0 24px;
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
  background: var(--el-bg-color);
}
.view-tab {
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-tertiary);
  cursor: pointer;
  border: none;
  background: none;
  border-bottom: 3px solid transparent;
  transition: all 0.2s;
}
.view-tab.active {
  color: var(--el-color-primary);
  border-bottom-color: var(--el-color-primary);
  font-weight: 600;
}
.view-tab:not(.active):hover {
  color: var(--el-text-color-regular);
}
.view-tab-icon {
  vertical-align: -0.15em;
  margin-right: 4px;
}
.chat-stream-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.right-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--el-bg-color) 30%, var(--el-bg-color-page) 70%);
}
.report-body {
  overflow-y: auto;
  padding: 20px 24px;
}
.pending-task-notice {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
}
.notice-icon-wrapper {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: var(--el-color-primary-light-9);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
}
.notice-icon {
  color: var(--el-color-primary);
}
.notice-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 8px;
}
.notice-desc {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.right-body::-webkit-scrollbar {
  width: 4px;
}
.right-body::-webkit-scrollbar-track {
  background: transparent;
}
.right-body::-webkit-scrollbar-thumb {
  background: var(--el-border-color-dark);
  border-radius: 4px;
}
.right-body::-webkit-scrollbar-thumb:hover {
  background: var(--el-text-color-secondary);
}
@media (max-width: 700px) {
  :where(html.workbench-mobile-navigation) .view-tabs {
    padding: 0 8px;
  }
  :where(html.workbench-mobile-navigation) .view-tab {
    flex: 1;
    padding: 10px 8px;
  }
  :where(html.workbench-mobile-navigation) .report-body {
    padding: 14px 12px calc(14px + env(safe-area-inset-bottom));
    overflow-x: auto;
  }
  :where(html.workbench-mobile-navigation) .pending-task-notice {
    padding: 32px 18px;
  }
}
</style>
