<template>
  <div class="deep-analysis-result" :class="{ compact: props.compact }">
    <!-- Thinking panel: shows the dimension tree and query status -->
    <div v-if="thinkingTree.length > 0" class="thinking-tree">
      <div class="thinking-header">
        <el-icon><Folder /></el-icon>
        <span class="thinking-title">{{ t("analysis.analysisProgress") }}</span>
        <span v-if="allDimensionsDone && !skillsStopped" class="thinking-status success">
          <el-icon><CircleCheck /></el-icon>
          {{ t("analysis.queryComplete") }}
        </span>
        <span v-else-if="skillsStopped" class="thinking-status stopped">
          <el-icon><Folder /></el-icon>
          {{ t("common.stopped") }}
        </span>
        <span v-else class="thinking-status processing">
          <el-icon><Loader2 /></el-icon>
          {{ t("analysis.querying") }}...
        </span>
      </div>
      <div class="tree-container">
        <div
          v-for="(dim, dimIndex) in thinkingTree"
          :key="dim.dimensionId || dim.dimName"
          class="tree-dimension"
        >
          <div class="dim-header" @click="toggleDimension(dimIndex)">
            <span v-if="props.compact && isDimensionDone(dim)" class="dim-index compact-done">
              <el-icon><CircleCheck /></el-icon>
            </span>
            <span v-else class="dim-index">{{ Number(dimIndex) + 1 }}</span>
            <span class="dim-name">{{ dim.dimName }}</span>
            <span v-if="isDimensionDone(dim)" class="dim-status">
              <el-icon><CircleCheck /></el-icon>
            </span>
            <span v-else-if="dim.status === 'partial'" class="dim-status partial">
              {{ t("analysis.partiallyComplete") }}
            </span>
            <button class="expand-btn" @click.stop="toggleDimension(dimIndex)">
              <ChevronDown v-if="expandedDimensions[dimIndex]" :size="16" />
              <ChevronRight v-else :size="16" />
            </button>
          </div>
          <div v-if="dim.reason" class="dim-reason">{{ dim.reason }}</div>
          <div v-show="expandedDimensions[dimIndex]" class="dim-questions">
            <div
              v-for="(q, qIndex) in dim.questions"
              :key="q.id || qIndex"
              class="question-item"
              :class="{ done: q.done, failed: q.status === 'failed' }"
            >
              <div class="question-left" @click="toggleQuestion(dimIndex, qIndex)">
                <el-icon v-if="q.status === 'failed'" class="failed-icon">
                  <CircleX />
                </el-icon>
                <el-icon v-else-if="q.status === 'stopped'" class="pending-icon">
                  <Folder />
                </el-icon>
                <el-icon v-else-if="q.done" class="done-icon"><CircleCheck /></el-icon>
                <el-icon v-else-if="q.status === 'running'" class="loading-icon">
                  <Loader2 />
                </el-icon>
                <el-icon v-else class="pending-icon"><Folder /></el-icon>
                <span class="question-text">{{ q.text }}</span>
                <button
                  v-if="q.execution"
                  class="expand-btn small"
                  @click.stop="toggleQuestion(dimIndex, qIndex)"
                >
                  <ChevronDown v-if="expandedQuestions[dimIndex + '-' + qIndex]" :size="14" />
                  <ChevronRight v-else :size="14" />
                </button>
              </div>
              <span
                v-if="q.statusText"
                class="status-text"
                :class="{ error: q.status === 'failed' }"
              >
                {{ q.statusText }}
              </span>
              <!-- Execution display view: shared with the standard Q&A conversation -->
              <QueryExecutionView
                v-if="expandedQuestions[dimIndex + '-' + qIndex]"
                :facts="q.execution"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Skill execution status -->
    <div v-if="showSkillStatus" class="skill-execution-status">
      <div class="skill-status-header">
        <el-icon><Cog /></el-icon>
        <span>{{ t("analysis.analysisSkillExecution") }}</span>
      </div>
      <div class="skill-status-content">
        <div v-if="skillsExecuting" class="skill-status-item executing">
          <el-icon><Loader2 /></el-icon>
          <span>{{ t("analysis.executingSkills") }}</span>
        </div>
        <div v-else-if="skillsStopped" class="skill-status-item stopped">
          <el-icon><Folder /></el-icon>
          <span>{{ t("common.stopped") }}</span>
        </div>
        <div v-else-if="skillsComplete" class="skill-status-item complete">
          <el-icon><CircleCheck /></el-icon>
          <span>{{ t("analysis.completedSkills", { n: skillSuccessCount }) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { QueryExecutionView } from "../../query-view";
import {
  Folder,
  CircleCheck,
  CircleX,
  Loader2,
  Cog,
  ChevronDown,
  ChevronRight,
} from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import type { DeepAnalysisDimension } from "../../../types/chat";
import type {
  AnalysisActivity,
  AnalysisRunState,
} from "@ontomato/contracts/analysis-presentation";
import { buildDimensionTree } from "../utils/dimension-view";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  activities: AnalysisActivity[];
  runState?: AnalysisRunState;
  archived?: boolean;
  compact?: boolean;
}>();

const thinkingTree = computed(() => buildDimensionTree(props.activities));
const skillActivities = computed(() => props.activities.filter((a) => a.kind === "skill"));
const skillSuccessCount = computed(
  () =>
    skillActivities.value.flatMap((a) => a.skills || []).filter((s) => s.status === "completed")
      .length
);

const expandedDimensions = ref<Record<number, boolean>>({});
const expandedQuestions = ref<Record<string, boolean>>({});

const toggleDimension = (index: number) => {
  expandedDimensions.value[index] = !expandedDimensions.value[index];
};

const toggleQuestion = (dimIndex: number, qIndex: number) => {
  const key = `${dimIndex}-${qIndex}`;
  expandedQuestions.value[key] = !expandedQuestions.value[key];
};

// Expand the first dimension by default
let initialExpandDone = false;
watch(
  () => thinkingTree.value,
  (tree) => {
    if (!initialExpandDone && tree.length > 0) {
      if (props.compact) {
        tree.forEach((_, index) => {
          expandedDimensions.value[index] = true;
        });
      } else {
        expandedDimensions.value[0] = true;
      }
      initialExpandDone = true;
    }
  },
  { immediate: true }
);

// Skill execution status
const skillsExecuting = computed(
  () =>
    skillActivities.value.some((a) => a.status === "running") &&
    props.runState?.status === "running"
);
const skillsComplete = computed(
  () =>
    skillActivities.value.length > 0 && skillActivities.value.every((a) => a.status !== "running")
);
const skillsStopped = computed(() => props.runState?.status === "cancelled");
const showSkillStatus = computed(
  () => skillsExecuting.value || skillsComplete.value || skillsStopped.value
);

// Dimension query status
const allDimensionsDone = computed(() => {
  if (!thinkingTree.value.length) return false;
  return thinkingTree.value.every((dim) =>
    dim.questions.every(
      (q) => q.status === "completed" || q.status === "failed" || q.status === "stopped"
    )
  );
});

const isDimensionDone = (dim: DeepAnalysisDimension) => {
  return dim.questions.every((q) => q.status === "completed" || q.status === "stopped");
};
</script>

<style scoped>
.deep-analysis-result {
  margin-bottom: 16px;
}

.thinking-tree {
  border-radius: var(--radius-xl);
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  transition: all var(--transition-base);
}

.thinking-tree:hover {
  border-color: var(--el-border-color-dark);
}

.thinking-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--el-color-primary) 4%, transparent) 0%,
    transparent 100%
  );
  border-bottom: 1px solid var(--el-border-color-light);
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.thinking-title {
  flex: 1;
}

.thinking-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.thinking-status.processing {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.thinking-status.success {
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}

.thinking-status.stopped {
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
}

.tree-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tree-dimension {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 18px;
  padding: 12px 14px;
  box-shadow: var(--shadow-card);
  transition: all var(--transition-fast);
}

.tree-dimension:hover {
  border-color: var(--el-border-color-dark);
  box-shadow: var(--shadow-card-hover);
}

.dim-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  cursor: pointer;
  user-select: none;
}

.dim-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--el-color-primary) 10%, transparent) 0%,
    color-mix(in srgb, var(--el-color-primary) 5%, transparent) 100%
  );
  color: var(--el-color-primary);
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.dim-name {
  flex: 1;
}

.dim-reason {
  margin: -4px 0 12px 32px;
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.dim-status {
  color: var(--el-color-success);
  font-size: 16px;
}

.dim-status.partial {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
  font-weight: 600;
}

.expand-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-placeholder);
  flex-shrink: 0;
  padding: 0;
}
.expand-btn:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}
.expand-btn.small {
  width: 20px;
  height: 20px;
  margin-left: auto;
}

.dim-questions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-left: 32px;
}

.dim-questions .table-section {
  margin: 0;
}

.question-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--text-sm);
  color: var(--el-text-color-regular);
  line-height: 1.5;
}

.question-item.done .question-left,
.question-item.done .status-text {
  color: var(--el-color-success);
}

.question-item.failed .question-left,
.question-item.failed .status-text {
  color: var(--el-color-danger);
}

.question-left {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
  user-select: none;
}

.question-text {
  word-break: break-word;
  flex: 1;
}

.done-icon {
  color: var(--el-color-success);
  font-size: 16px;
  flex-shrink: 0;
  margin-top: 1px;
}

.loading-icon {
  animation: spin 1s linear infinite;
  color: var(--el-color-primary);
  font-size: 16px;
  flex-shrink: 0;
  margin-top: 1px;
}

.failed-icon {
  color: var(--el-color-danger);
  font-size: 16px;
  flex-shrink: 0;
  margin-top: 1px;
}

.pending-icon {
  color: var(--el-text-color-secondary);
  font-size: 14px;
  flex-shrink: 0;
  margin-top: 2px;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.status-text {
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-execution-status {
  margin-top: 10px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-xl);
  overflow: hidden;
  background: var(--el-bg-color);
}

.skill-status-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--el-color-primary) 4%, transparent) 0%,
    transparent 100%
  );
  border-bottom: 1px solid var(--el-border-color-light);
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.skill-status-content {
  padding: 12px 16px;
  background: var(--el-bg-color-overlay);
}

.skill-status-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.skill-status-item.executing {
  color: var(--el-color-warning);
}

.skill-status-item.complete {
  color: var(--el-color-success);
}
/* Preserve the compact conversation-list hierarchy while retaining expandable data details. */
.deep-analysis-result.compact :deep(.thinking-tree) {
  background: transparent;
  border: none;
}

.deep-analysis-result.compact :deep(.tree-container) {
  gap: 10px;
}

.deep-analysis-result.compact :deep(.tree-dimension) {
  padding: 12px 14px;
  border-radius: 18px;
  box-shadow: var(--shadow-card);
}

.deep-analysis-result.compact :deep(.dim-header) {
  gap: 8px;
  margin-bottom: 0;
  font-size: 13px;
}

.deep-analysis-result.compact :deep(.dim-index.compact-done) {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
  font-size: 15px;
}

.deep-analysis-result.compact :deep(.dim-name) {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.deep-analysis-result.compact :deep(.dim-status) {
  display: none;
}

.deep-analysis-result.compact :deep(.dim-header > .expand-btn) {
  display: none;
}

.deep-analysis-result.compact :deep(.dim-reason) {
  margin: 4px 0 0;
  padding-left: 28px;
  font-size: 11px;
  line-height: 1.5;
}

.deep-analysis-result.compact :deep(.dim-questions) {
  margin-top: 8px;
  padding-left: 28px;
  gap: 4px;
}

.deep-analysis-result.compact :deep(.question-item) {
  gap: 0;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
}

.deep-analysis-result.compact :deep(.question-left) {
  align-items: center;
  gap: 6px;
}

.deep-analysis-result.compact :deep(.question-text) {
  color: var(--el-color-success);
  font-size: 12px;
  font-weight: 400;
}

.deep-analysis-result.compact :deep(.done-icon) {
  width: 12px;
  height: 12px;
  margin-top: 0;
}
</style>
