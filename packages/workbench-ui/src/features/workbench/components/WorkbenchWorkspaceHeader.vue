<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useChatStore } from "../../chat";
import { useDashboardStore } from "../../dashboard";
import { Download, LayoutDashboard, Loader2, Presentation, Timer } from "lucide-vue-next";
import { useLocale } from "../../../composables/useLocale";
import { AnalysisTimerDropdown, useAnalysisStore } from "../../analysis";

defineProps<{
  isAnalysis: boolean;
  timerOpen: boolean;
}>();

const emit = defineEmits<{
  "update:timerOpen": [value: boolean];
}>();

const analysisStore = useAnalysisStore();
const dashboardStore = useDashboardStore();
const { currentThreadTitle } = storeToRefs(useChatStore());
const {
  currentTask,
  activeSession,
  hasReportArtifact,
  displayTaskStatus,
  isDownloadingReport: isDownloading,
  canCreatePpt: canCreateAnalysisPpt,
  isCreatingPpt: isCreatingAnalysisPpt,
} = storeToRefs(analysisStore);
const { creatingDashboardKey } = storeToRefs(dashboardStore);

const { t } = useLocale();

function taskStatusLabel(status?: string): string {
  if (status === "running") return t("analysis.executing");
  if (status === "completed") return t("analysis.completed");
  if (status === "pending") return t("analysis.pending");
  if (status === "failed") return t("common.failed");
  if (status === "cancelled") return t("analysis.cancelled");
  return t("common.unknown");
}
</script>

<template>
  <div class="right-header">
    <div class="right-title">
      <span class="title-text">
        {{
          isAnalysis
            ? currentTask?.name || t("chat.taskDetail")
            : currentThreadTitle || t("chat.askDataConversation")
        }}
      </span>
      <span
        v-if="displayTaskStatus"
        class="title-badge"
        :class="{
          'badge-running': displayTaskStatus === 'running',
          'badge-done': displayTaskStatus === 'completed',
          'badge-pending': displayTaskStatus === 'pending',
          'badge-failed': displayTaskStatus === 'failed',
          'badge-cancelled': displayTaskStatus === 'cancelled',
        }"
      >
        {{ taskStatusLabel(displayTaskStatus) }}
      </span>
    </div>
    <div class="right-actions">
      <!-- Actions appended by the app layout (e.g. a graph entry), placed first. -->
      <slot name="header-actions" />
      <template v-if="isAnalysis">
        <button
          v-if="hasReportArtifact"
          class="action-btn"
          :title="isDownloading ? t('analysis.reportGenerating') : t('analysis.downloadReport')"
          :disabled="isDownloading"
          @click="analysisStore.downloadReport()"
        >
          <Loader2 v-if="isDownloading" :size="14" class="spin-icon" />
          <Download v-else :size="14" />
          <span>
            {{ isDownloading ? t("analysis.reportGenerating") : t("analysis.downloadReport") }}
          </span>
        </button>
        <button
          v-if="dashboardStore.canCreateAnalysisDashboard(currentTask, activeSession)"
          class="action-btn"
          :title="
            dashboardStore.isCreatingAnalysisDashboard(currentTask, activeSession)
              ? t('common.generating')
              : t('analysis.generateDashboard')
          "
          :disabled="Boolean(creatingDashboardKey)"
          @click="dashboardStore.createCurrentTaskDashboard(currentTask, activeSession)"
        >
          <Loader2
            v-if="dashboardStore.isCreatingAnalysisDashboard(currentTask, activeSession)"
            :size="14"
            class="spin-icon"
          />
          <LayoutDashboard v-else :size="14" />
          <span>
            {{
              dashboardStore.isCreatingAnalysisDashboard(currentTask, activeSession)
                ? t("common.generating")
                : t("analysis.generateDashboard")
            }}
          </span>
        </button>
        <button
          v-if="canCreateAnalysisPpt"
          class="action-btn"
          :title="isCreatingAnalysisPpt ? t('common.generating') : t('analysis.generatePpt')"
          :disabled="isCreatingAnalysisPpt"
          @click="analysisStore.createPpt()"
        >
          <Loader2 v-if="isCreatingAnalysisPpt" :size="14" class="spin-icon" />
          <Presentation v-else :size="14" />
          <span>
            {{ isCreatingAnalysisPpt ? t("common.generating") : t("analysis.generatePpt") }}
          </span>
        </button>
        <div class="timer-wrapper">
          <button
            class="action-btn"
            :title="t('analysis.timerSettings')"
            @click="emit('update:timerOpen', !timerOpen)"
          >
            <Timer :size="14" />
            <span>{{ t("analysis.timerSettings") }}</span>
          </button>
          <AnalysisTimerDropdown
            :visible="timerOpen"
            @close="emit('update:timerOpen', false)"
            @save="
              emit('update:timerOpen', false);
              analysisStore.saveSchedule($event);
            "
          />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.right-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  container-type: inline-size;
  padding: 18px 26px;
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
  background: color-mix(in srgb, var(--el-bg-color) 88%, transparent);
}
.right-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}
.title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 360px;
}
.title-badge {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  white-space: nowrap;
}
.badge-running {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.badge-done {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}
.badge-pending {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
}
.badge-failed {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
.badge-cancelled {
  background: var(--el-fill-color);
  color: var(--el-text-color-regular);
}
.right-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.action-btn,
:slotted(.action-btn) {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 14px;
  font-size: 12px;
  border: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.action-btn:hover,
:slotted(.action-btn:hover) {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}
.timer-wrapper {
  position: relative;
}
@container (max-width: 900px) {
  .right-actions .action-btn,
  .right-actions :slotted(.action-btn) {
    gap: 0;
    padding: 6px 8px;
  }
  .right-actions .action-btn span,
  .right-actions :slotted(.action-btn) span {
    display: none;
  }
  .right-actions .timer-wrapper {
    flex-shrink: 0;
  }
}
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
.spin-icon {
  animation: spin 1s linear infinite;
}
@media (max-width: 700px) {
  :where(html.workbench-mobile-navigation) .right-header {
    min-height: 48px;
    padding: 8px 12px;
  }
  :where(html.workbench-mobile-navigation) .right-title {
    flex: 1;
    gap: 6px;
    font-size: 14px;
  }
  :where(html.workbench-mobile-navigation) .title-text {
    max-width: none;
  }
  :where(html.workbench-mobile-navigation) .title-badge {
    padding: 2px 6px;
  }
  :where(html.workbench-mobile-navigation) .right-actions {
    gap: 2px;
  }
  :where(html.workbench-mobile-navigation) .right-actions .action-btn {
    width: 34px;
    height: 34px;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 10px;
  }
  :where(html.workbench-mobile-navigation) .right-actions .action-btn span {
    display: none;
  }
}
</style>
