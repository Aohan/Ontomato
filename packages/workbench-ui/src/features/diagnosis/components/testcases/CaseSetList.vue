<script setup lang="ts">
import type { TestCase } from "@ontomato/contracts/autotest";
import { useI18n } from "vue-i18n";

defineProps<{
  cases: TestCase[];
  selectedCaseIndex: number;
  width: number;
}>();

const emit = defineEmits<{
  select: [index: number];
  remove: [index: number];
  add: [];
}>();

const { t } = useI18n();

function caseDisplayName(c: TestCase): string {
  if (c.question) {
    return c.question.length > 30 ? `${c.question.slice(0, 30)}...` : c.question;
  }
  return t("diagnosis.emptyQuestion");
}
</script>

<template>
  <aside class="panel-left" :style="{ width: width + 'px' }">
    <div class="panel-header">
      <span class="panel-title">{{ t("hotData.caseList") }}</span>
      <span class="panel-count">{{ cases.length }}{{ t("hotData.entries") }}</span>
    </div>
    <div class="panel-body">
      <div
        v-for="(c, i) in cases"
        :key="i"
        :class="['case-item', { active: selectedCaseIndex === i }]"
        @click="emit('select', i)"
      >
        <div class="case-item-main">
          <span class="case-item-question">{{ caseDisplayName(c) }}</span>
          <span class="case-item-id">{{ c.caseId }}</span>
        </div>
        <el-button
          class="case-item-delete"
          type="danger"
          text
          size="small"
          @click.stop="emit('remove', i)"
        >
          {{ t("common.delete") }}
        </el-button>
      </div>
      <el-empty v-if="cases.length === 0" :description="t('hotData.noCases')" :image-size="40" />
    </div>
    <div class="panel-footer">
      <button class="add-case-btn" type="button" @click="emit('add')">
        {{ t("hotData.addCaseButton") }}
      </button>
    </div>
  </aside>
</template>

<style scoped>
.panel-left {
  display: flex;
  flex-direction: column;
  flex: 0 1 auto;
  min-width: 180px;
  max-width: 560px;
  background: var(--observe-bg-card, var(--el-bg-color));
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 0.5px solid var(--observe-border, var(--el-border-color));
  flex-shrink: 0;
}

.panel-title {
  font-size: 11px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
  letter-spacing: 0;
}

.panel-count {
  font-size: 11px;
  color: var(--el-text-color-tertiary);
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.panel-footer {
  padding: 8px;
  border-top: 0.5px solid var(--observe-border, var(--el-border-color));
  flex-shrink: 0;
}

.add-case-btn {
  width: 100%;
  padding: 6px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border: 0.5px dashed var(--el-border-color-dark);
  border-radius: 8px;
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
}

.add-case-btn:hover {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.case-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: all var(--transition-fast);
  border: 0.5px solid transparent;
  margin-bottom: 2px;
}

.case-item:hover {
  background: var(--observe-bg-hover, var(--el-fill-color-light));
}

.case-item.active {
  background: var(--observe-bg-active, var(--el-color-primary-light-9));
  border-color: var(--observe-border, var(--el-color-primary-light-5));
}

.case-item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.case-item-question {
  font-size: 13px;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-item-id {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--el-text-color-tertiary);
}

.case-item-delete {
  opacity: 0;
  transition: opacity var(--transition-fast);
  flex-shrink: 0;
}

.case-item:hover .case-item-delete {
  opacity: 1;
}
</style>
