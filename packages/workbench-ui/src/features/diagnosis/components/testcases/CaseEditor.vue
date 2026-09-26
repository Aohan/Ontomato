<script setup lang="ts">
import type { TestCase } from "@ontomato/contracts/autotest";
import { useI18n } from "vue-i18n";

defineProps<{
  selectedCase: TestCase | null;
  defaultJudgment: string;
}>();

const emit = defineEmits<{
  "update-field": [field: keyof TestCase, value: string];
}>();

const { t } = useI18n();
</script>

<template>
  <div v-if="selectedCase" class="form-card">
    <div class="form-section">
      <div class="section-title">{{ t("common.basicInfo") }}</div>
      <div class="form-field">
        <label class="field-label">
          <span class="label-main">{{ t("hotData.caseId") }}</span>
          <code class="label-key">caseId</code>
        </label>
        <el-input
          :model-value="selectedCase.caseId"
          class="input-short"
          @update:model-value="emit('update-field', 'caseId', String($event))"
        />
      </div>
      <div class="form-field">
        <label class="field-label">
          <span class="label-main">{{ t("hotData.question") }}</span>
          <code class="label-key">question</code>
        </label>
        <el-input
          :model-value="selectedCase.question"
          type="textarea"
          :rows="3"
          @update:model-value="emit('update-field', 'question', String($event))"
        />
      </div>
    </div>

    <div class="section-divider" />

    <div class="form-section">
      <div class="section-title">{{ t("hotData.expectedResult") }}</div>
      <div class="form-field">
        <label class="field-label">
          <span class="label-main">{{ t("hotData.expectedAnswer") }}</span>
          <code class="label-key">expectedAnswer</code>
        </label>
        <el-input
          :model-value="selectedCase.expectedAnswer"
          type="textarea"
          :rows="2"
          :placeholder="t('hotData.leaveBlankAsRef')"
          @update:model-value="emit('update-field', 'expectedAnswer', String($event))"
        />
      </div>
      <div class="form-field">
        <label class="field-label">
          <span class="label-main">{{ t("hotData.judgmentCondition") }}</span>
          <code class="label-key">judgment</code>
        </label>
        <el-input
          :model-value="selectedCase.judgment"
          type="textarea"
          :rows="3"
          :placeholder="t('diagnosis.defaultPrefix') + defaultJudgment"
          @update:model-value="emit('update-field', 'judgment', String($event))"
        />
      </div>
      <div class="form-field">
        <label class="field-label">
          <span class="label-main">{{ t("hotData.expectedLogic") }}</span>
          <code class="label-key">expectedLogic</code>
        </label>
        <el-input
          :model-value="selectedCase.expectedLogic"
          type="textarea"
          :rows="6"
          class="field-mono"
          :placeholder="t('hotData.leaveBlankForLogic')"
          @update:model-value="emit('update-field', 'expectedLogic', String($event))"
        />
      </div>
    </div>
  </div>

  <div v-else class="empty-case">
    <el-empty :description="t('hotData.selectCaseToEdit')" :image-size="50" />
  </div>
</template>

<style scoped>
.empty-case {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.form-card {
  width: min(760px, 100%);
  padding: 4px 0;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-title {
  font-size: 11px;
  font-weight: 500;
  color: var(--el-text-color-tertiary);
  letter-spacing: 0;
}

.section-divider {
  height: 0;
  border: none;
  border-top: 0.5px solid var(--observe-border, var(--el-border-color));
  margin: 24px 0;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.label-main {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.label-key {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--el-text-color-tertiary);
  padding: 1px 4px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

.input-short {
  max-width: 160px;
}

.field-mono :deep(.el-textarea__inner) {
  font-family: var(--font-mono);
  font-size: 13px;
}
</style>
