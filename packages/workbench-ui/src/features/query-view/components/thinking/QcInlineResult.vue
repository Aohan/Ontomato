<script setup lang="ts">
import { computed } from "vue";
import { marked } from "../../../../utils/marked";
import { formatCheckScore } from "../../utils/thinkingUtils";
import type { QcCheckResult } from "../../utils/thinkingUtils";
import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../../content";

const { t } = useI18n();

const props = defineProps<{
  checkResult: QcCheckResult;
}>();

const scoreDisplay = computed(() => {
  if (props.checkResult.score === undefined) return undefined;
  return formatCheckScore(props.checkResult.score);
});

const meaningfulSteps = computed(() => {
  return (props.checkResult.steps || []).filter((step) => {
    if (step.meaning) return true;
    const s = (step.summary || step.label || "").trim();
    if (!s) return false;
    if (workbenchContent().qcStepLabel.test(s)) return false;
    return true;
  });
});

function renderMd(src: string): string {
  return marked.parse(src) as string;
}
</script>

<template>
  <div class="qc-inline">
    <div class="block-label">{{ t("thinking.qcResult") }}</div>

    <div v-if="meaningfulSteps.length" class="qc-steps">
      <div v-for="(step, si) in meaningfulSteps" :key="si" class="qc-step">
        <div class="qc-step-title">
          {{ step.summary || step.label || t("thinking.stepN", { n: si + 1 }) }}
        </div>
        <div v-if="step.meaning" class="qc-step-meaning" v-html="renderMd(step.meaning)" />
      </div>
    </div>

    <div v-if="checkResult.conclusion || scoreDisplay !== undefined" class="qc-result-row">
      <div v-if="scoreDisplay !== undefined" class="qc-metric score-metric">
        <span class="qc-metric-label">{{ t("thinking.score") }}</span>
        <span class="qc-metric-value">
          {{ scoreDisplay }}
          <span class="qc-metric-unit">/100</span>
        </span>
      </div>
      <div v-if="checkResult.fittedQuestion" class="qc-metric question-metric">
        <span class="qc-metric-label">{{ t("thinking.preciseBusinessQuestion") }}</span>
        <span class="qc-metric-text">{{ checkResult.fittedQuestion }}</span>
      </div>
    </div>

    <div
      v-if="checkResult.conclusion"
      class="qc-conclusion markdown-body"
      v-html="renderMd(checkResult.conclusion)"
    />
  </div>
</template>

<style scoped>
.qc-inline {
  margin-top: 14px;
}
.block-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
  letter-spacing: 0.04em;
}
.qc-step {
  padding: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-extra-light);
}
.qc-step-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.qc-step-meaning {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  line-height: 1.7;
}
.qc-step-meaning :deep(h1),
.qc-step-meaning :deep(h2),
.qc-step-meaning :deep(h3),
.qc-step-meaning :deep(h4),
.qc-step-meaning :deep(h5),
.qc-step-meaning :deep(h6) {
  font-size: 13px;
  font-weight: 600;
  margin: 8px 0 4px;
}
.qc-step-meaning :deep(p) {
  margin: 4px 0;
}

.qc-result-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}
.qc-metric {
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-extra-light);
}
.score-metric {
  border-color: color-mix(in srgb, var(--el-color-success) 25%, transparent);
  background: color-mix(in srgb, var(--el-color-success) 4%, transparent);
}
.qc-metric-label {
  display: block;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}
.qc-metric-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--el-color-success);
}
.qc-metric-unit {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
}
.qc-metric-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  line-height: 1.6;
  word-break: break-word;
}
.qc-conclusion {
  margin-top: 10px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.7;
}
.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 13px;
}
.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 8px 12px;
  border: 1px solid var(--el-border-color-lighter);
}
.markdown-body :deep(th) {
  background: var(--el-fill-color-light);
  font-weight: 600;
  text-align: left;
}
.markdown-body :deep(td) {
  text-align: left;
}
.markdown-body :deep(tbody tr:nth-child(even)) {
  background: var(--el-fill-color-extra-light);
}
.markdown-body :deep(h1) {
  font-size: 16px;
  margin: 10px 0 6px;
}
.markdown-body :deep(h2) {
  font-size: 14px;
  margin: 8px 0 4px;
}
.markdown-body :deep(h3) {
  font-size: 13px;
  margin: 6px 0 4px;
}
.markdown-body :deep(h4) {
  font-size: 13px;
  margin: 6px 0 2px;
}
.markdown-body :deep(p) {
  margin: 6px 0;
}

@media (max-width: 768px) {
  .qc-result-row {
    grid-template-columns: 1fr;
  }
}
</style>
