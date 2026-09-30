<script setup lang="ts">
import type {
  CaseSetListItem as CaseSetItem,
  RunSummary,
} from "@ontomato/contracts/autotest";
import { useI18n } from "vue-i18n";

defineProps<{
  width: number;
  executeMode: "caseset" | "temporary";
  caseSets: CaseSetItem[];
  selectedCaseSetId: string;
  concurrency: number;
  runRounds: number;
  caseTimeoutSeconds: number;
  defaultJudgment: string;
  tempQuestion: string;
  tempExpectedAnswer: string;
  tempExpectedLogic: string;
  tempJudgment: string;
  repeatCount: number;
  isRunning: boolean;
  isActive: boolean;
  loading: boolean;
  errorText: string;
  progressStatusText: string;
  progressPercent: number;
  displayCompletedCases: number;
  displayTotalCases: number;
  runSummary: RunSummary;
  accuracyRate: string;
}>();

const emit = defineEmits<{
  start: [];
  stop: [];
  "clear-error": [];
  "update:executeMode": [value: "caseset" | "temporary"];
  "update:selectedCaseSetId": [value: string];
  "update:concurrency": [value: number];
  "update:runRounds": [value: number];
  "update:caseTimeoutSeconds": [value: number];
  "update:tempQuestion": [value: string];
  "update:tempExpectedAnswer": [value: string];
  "update:tempExpectedLogic": [value: string];
  "update:tempJudgment": [value: string];
  "update:repeatCount": [value: number];
}>();

const { t } = useI18n();
</script>

<template>
  <div class="left-panel" :style="{ width: width + 'px' }">
    <div class="left-controls">
      <el-button
        type="primary"
        size="small"
        :disabled="isActive"
        :loading="loading"
        @click="emit('start')"
      >
        {{ t("common.start") }}
      </el-button>
      <el-button type="danger" size="small" :disabled="!isRunning" @click="emit('stop')">
        {{ t("common.stop") }}
      </el-button>
    </div>

    <div class="run-options">
      <label class="run-option">
        <span class="config-hint">{{ t("common.parallel") }}</span>
        <el-input-number
          :model-value="concurrency"
          :min="1"
          :max="20"
          :disabled="isActive"
          size="small"
          class="number-input"
          @update:model-value="emit('update:concurrency', Number($event))"
        />
      </label>
      <label class="run-option">
        <span class="config-hint">{{ t("diagnosis.roundCount") }}</span>
        <el-input-number
          :model-value="runRounds"
          :min="1"
          :max="20"
          :disabled="isActive"
          size="small"
          class="number-input"
          @update:model-value="emit('update:runRounds', Number($event))"
        />
      </label>
      <label class="run-option">
        <span class="config-hint">{{ t("diagnosis.caseTimeoutSeconds") }}</span>
        <el-input-number
          :model-value="caseTimeoutSeconds"
          :min="1"
          :step="60"
          :disabled="isActive"
          size="small"
          class="number-input"
          @update:model-value="emit('update:caseTimeoutSeconds', Number($event))"
        />
      </label>
    </div>

    <el-alert
      v-if="errorText"
      :title="errorText"
      type="error"
      :closable="true"
      @close="emit('clear-error')"
    />

    <div class="left-mode">
      <el-radio-group
        :model-value="executeMode"
        :disabled="isActive"
        size="small"
        @update:model-value="emit('update:executeMode', $event as 'caseset' | 'temporary')"
      >
        <el-radio-button value="caseset">{{ t("diagnosis.testCaseset") }}</el-radio-button>
        <el-radio-button value="temporary">{{ t("diagnosis.testTemporary") }}</el-radio-button>
      </el-radio-group>
    </div>

    <div class="left-content">
      <div v-if="executeMode === 'caseset'" class="left-config">
        <el-select
          :model-value="selectedCaseSetId"
          :placeholder="t('diagnosis.selectCaseSet')"
          :disabled="isActive"
          class="case-set-select"
          @update:model-value="emit('update:selectedCaseSetId', String($event))"
        >
          <el-option
            v-for="cs in caseSets"
            :key="cs.id"
            :label="`${cs.name} (${cs.caseCount})`"
            :value="cs.id"
          />
        </el-select>
      </div>

      <div v-else class="left-form">
        <el-form label-position="top" size="small">
          <el-form-item :label="t('hotData.question')">
            <el-input
              :model-value="tempQuestion"
              type="textarea"
              :rows="3"
              :placeholder="t('diagnosis.enterTestQuestion')"
              :disabled="isActive"
              @update:model-value="emit('update:tempQuestion', String($event))"
            />
          </el-form-item>
          <el-form-item :label="t('hotData.expectedAnswer')">
            <el-input
              :model-value="tempExpectedAnswer"
              type="textarea"
              :rows="3"
              :placeholder="t('diagnosis.expectedAnswerPlaceholder')"
              :disabled="isActive"
              @update:model-value="emit('update:tempExpectedAnswer', String($event))"
            />
          </el-form-item>
          <el-form-item :label="t('hotData.judgmentCondition')">
            <el-input
              :model-value="tempJudgment"
              type="textarea"
              :rows="2"
              :placeholder="`${t('diagnosis.defaultPrefix')}${defaultJudgment}`"
              :disabled="isActive"
              @update:model-value="emit('update:tempJudgment', String($event))"
            />
          </el-form-item>
          <el-form-item :label="t('hotData.expectedLogic')">
            <el-input
              :model-value="tempExpectedLogic"
              type="textarea"
              :rows="3"
              :placeholder="t('diagnosis.expectedLogicPlaceholder')"
              :disabled="isActive"
              @update:model-value="emit('update:tempExpectedLogic', String($event))"
            />
          </el-form-item>
          <el-form-item :label="t('diagnosis.repeatCount')">
            <el-input-number
              :model-value="repeatCount"
              :min="1"
              :max="20"
              :disabled="isActive"
              @update:model-value="emit('update:repeatCount', Number($event))"
            />
          </el-form-item>
        </el-form>
      </div>
    </div>

    <div class="progress-section">
      <div class="progress-head">
        <span class="progress-state">{{ progressStatusText }}</span>
        <span class="progress-percent">{{ progressPercent }}%</span>
      </div>
      <el-progress
        class="run-progress"
        color="var(--el-color-primary)"
        :percentage="progressPercent"
        :stroke-width="8"
        :show-text="false"
      />
      <div class="progress-stats">
        <span class="stat-pill">{{ displayCompletedCases }}/{{ displayTotalCases }}</span>
        <span class="stat-pill stat-ok">{{ runSummary.correct }} {{ t("autotest.correct") }}</span>
        <span class="stat-pill stat-fail">{{ runSummary.wrong }} {{ t("autotest.wrong") }}</span>
        <span class="stat-pill stat-err">
          {{ runSummary.abnormal }} {{ t("autotest.abnormal") }}
        </span>
        <span class="stat-pill stat-rate">
          {{ t("autotest.accuracyRate", { rate: accuracyRate }) }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.left-panel {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  overflow: hidden;
  min-width: 260px;
}

.left-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.run-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  flex-shrink: 0;
}

.run-option {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.number-input {
  width: 118px;
}

.left-mode {
  flex-shrink: 0;
}

.left-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.left-config {
  height: 100%;
}

.case-set-select {
  width: 100%;
}

.left-form {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
}

.left-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.left-form :deep(.el-form-item__label) {
  font-size: 12px;
  padding-bottom: 4px;
}

.config-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.progress-section {
  flex-shrink: 0;
  padding: 10px;
  border: 1px solid var(--observe-border, var(--el-border-color-lighter));
  border-radius: 8px;
  background: var(--el-bg-color-overlay);
}

.progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.progress-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
  margin-top: 7px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.progress-state {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.progress-percent {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.run-progress :deep(.el-progress-bar__outer) {
  background: color-mix(in srgb, var(--el-color-primary) 14%, var(--el-fill-color-light));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--el-color-primary) 18%, transparent);
}

.stat-pill {
  min-width: 0;
  padding: 2px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-blank);
}

.stat-rate {
  grid-column: span 2;
}

.stat-ok {
  color: var(--el-color-success);
}

.stat-fail {
  color: var(--el-color-warning);
}

.stat-err {
  color: var(--el-color-danger);
}
</style>
