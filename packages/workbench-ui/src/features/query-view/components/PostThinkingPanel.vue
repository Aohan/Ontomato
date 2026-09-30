<script setup lang="ts">
import type { QcState } from "@ontomato/contracts/query-thinking";
import { ChevronDown, ChevronRight, FlaskConical } from "lucide-vue-next";
import { ref, computed, watch } from "vue";
import MessageContent from "./MessageContent/index.vue";

import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  content?: string;
  label?: string;
  expanded?: boolean;
  qcState?: QcState | null;
}>();

const emit = defineEmits<{
  toggle: [];
}>();

const isExpanded = ref(props.expanded ?? false);

watch(
  () => props.expanded,
  (value) => {
    if (typeof value === "boolean") {
      isExpanded.value = value;
    }
  }
);

const statusLabel = computed(() => {
  if (props.qcState?.status === "completed") return t("task.completed");
  if (props.qcState?.status === "failed") return t("common.failed");
  if (props.qcState?.status === "running") return t("thinking.qcInProgress");
  // Not ready: still unsettled past the bounded time limit, neither completed nor failed; re-entering will show the full result.
  if (props.qcState?.status === "unsettled") return t("thinking.qcUnsettled");
  return "";
});

const hasStructuredState = computed(() => {
  return !!props.qcState && (props.qcState.steps.length > 0 || !!props.qcState.result);
});

function normalizeQcMarkdown(value?: string): string {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<\/?p>/gi, "")
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<b>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`")
    .trim();
}

const displayQcSteps = computed(() => {
  return (props.qcState?.steps || []).map((step) => ({
    ...step,
    summary: normalizeQcMarkdown(step.summary),
    meaning: normalizeQcMarkdown(step.meaning),
  }));
});

const handleClick = () => {
  isExpanded.value = !isExpanded.value;
  emit("toggle");
};
</script>

<template>
  <div v-if="qcState || content" class="post-thinking-panel" data-ai-table-enhancer="off">
    <div class="post-thinking-header" @click="handleClick">
      <div class="header-left">
        <div class="post-thinking-icon-wrapper">
          <FlaskConical :size="16" class="post-thinking-icon" />
        </div>
        <div class="header-copy">
          <span class="post-thinking-title">{{ label || t("thinking.qcProcess") }}</span>
          <span v-if="statusLabel" class="post-thinking-status">{{ statusLabel }}</span>
        </div>
      </div>

      <button class="expand-btn">
        <ChevronDown v-if="isExpanded" :size="16" />
        <ChevronRight v-else :size="16" />
      </button>
    </div>

    <Transition name="expand">
      <div v-if="isExpanded" class="post-thinking-body">
        <template v-if="hasStructuredState && qcState">
          <section v-if="displayQcSteps.length" class="qc-section">
            <div class="section-title">{{ t("thinking.checkSteps") }}</div>
            <div class="qc-step-list">
              <div
                v-for="step in displayQcSteps"
                :key="step.timestamp"
                class="qc-step"
                :class="step.status"
              >
                <div class="qc-step-copy">
                  <MessageContent
                    class="qc-step-title"
                    :content="step.summary || t('thinking.viewDetail')"
                  />
                  <MessageContent
                    v-if="step.meaning"
                    class="qc-step-detail"
                    :content="step.meaning"
                  />
                </div>
              </div>
            </div>
          </section>

          <section v-if="qcState.result" class="qc-section">
            <div class="section-title">{{ t("thinking.qcConclusion") }}</div>
            <div class="qc-result-card">
              <MessageContent
                v-if="qcState.result.conclusion"
                class="qc-result-line lead"
                :content="qcState.result.conclusion"
              />
              <div class="qc-result-grid">
                <div v-if="qcState.result.score !== undefined" class="metric-card score-card">
                  <span class="metric-label">{{ t("thinking.score") }}</span>
                  <div class="score-value-row">
                    <span class="metric-value score-number">{{ qcState.result.score }}</span>
                    <span class="score-unit">/ 100</span>
                  </div>
                </div>
                <div v-if="qcState.result.fittedQuestion" class="metric-card question-card">
                  <span class="metric-label">{{ t("thinking.preciseBusinessQuestion") }}</span>
                  <div class="question-copy">
                    <div class="metric-value text">{{ qcState.result.fittedQuestion }}</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </template>

        <MessageContent v-else class="post-thinking-content" :content="content || ''" />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.post-thinking-panel {
  margin-bottom: 16px;
  border-radius: 18px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.post-thinking-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--el-color-success) 5%, transparent) 0%,
    transparent 100%
  );
  border-bottom: 1px solid var(--el-border-color-light);
  cursor: pointer;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.post-thinking-icon-wrapper {
  width: 28px;
  height: 28px;
  border-radius: 9px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--el-color-success) 12%, transparent) 0%,
    color-mix(in srgb, var(--el-color-success) 5%, transparent) 100%
  );
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-color-success);
}

.post-thinking-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.post-thinking-status {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.expand-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-placeholder);
}

.post-thinking-body {
  padding: 14px 16px 16px;
  display: grid;
  gap: 18px;
  min-width: 0;
}

.qc-section {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.section-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
  letter-spacing: 0.04em;
}

.qc-step-list {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.qc-step {
  display: grid;
  gap: 0;
  min-width: 0;
}

.qc-step-copy {
  display: grid;
  gap: 7px;
  min-width: 0;
}

.qc-step-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.qc-step-detail,
.qc-result-line,
.post-thinking-content {
  min-width: 0;
  color: var(--el-text-color-regular);
}

.metric-value {
  font-size: 13px;
  line-height: 1.64;
  color: var(--el-text-color-regular);
  word-break: break-word;
}

.qc-result-card {
  border: 1px solid color-mix(in srgb, var(--el-color-success) 18%, transparent);
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--el-color-success) 5%, transparent) 0%,
      color-mix(in srgb, var(--el-color-success) 2%, transparent) 100%
    ),
    var(--el-bg-color);
  border-radius: 14px;
  padding: 16px;
  display: grid;
  gap: 12px;
  min-width: 0;
}

.qc-result-grid {
  display: grid;
  grid-template-columns: minmax(160px, 220px) minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
}

.metric-card {
  border-radius: 12px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  padding: 12px 14px;
  display: grid;
  gap: 6px;
  align-content: start;
  min-width: 0;
}

.metric-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
  letter-spacing: 0.04em;
}

.metric-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.score-card {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--el-color-success) 6%, transparent) 0%,
    var(--el-bg-color) 100%
  );
}

.score-value-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.score-number {
  font-size: 28px;
  line-height: 1;
  color: var(--el-color-success);
}

.score-unit {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-weight: 600;
}

.question-card {
  background: var(--el-bg-color);
}

.question-copy {
  display: grid;
  gap: 0;
}

.metric-value.text {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.6;
}

.done {
  color: var(--el-color-success);
}

.running {
  color: var(--el-color-primary);
}

.failed {
  color: var(--el-color-danger);
}

.expand-enter-active,
.expand-leave-active {
  transition: all 0.25s ease;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
}

.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 960px;
}

@media (max-width: 768px) {
  .post-thinking-body {
    padding: 14px;
  }

  .qc-result-card {
    padding: 14px;
    gap: 12px;
  }

  .qc-result-grid {
    grid-template-columns: 1fr;
  }

  .score-number {
    font-size: 24px;
  }
}
</style>
