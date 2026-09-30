<script setup lang="ts">
import { useI18n } from "vue-i18n";

defineProps<{
  collapsed: boolean;
  width: number;
  casesCount: number;
  jsonText: string;
  jsonError: string;
}>();

const emit = defineEmits<{
  "update:collapsed": [value: boolean];
  "json-focus": [];
  "json-blur": [];
  "json-input": [value: string];
}>();

const { t } = useI18n();
</script>

<template>
  <aside v-if="!collapsed" class="panel-right" :style="{ width: width + 'px' }">
    <div class="panel-header json-header">
      <div class="panel-header-title">
        <span class="panel-title">{{ t("hotData.jsonEdit") }}</span>
        <span class="panel-count">{{ casesCount }}{{ t("hotData.entries") }}</span>
      </div>
      <el-button
        class="json-toggle-button"
        text
        size="small"
        @click="emit('update:collapsed', true)"
      >
        {{ t("common.collapse") }}
      </el-button>
    </div>
    <div class="json-editor-body">
      <el-input
        :model-value="jsonText"
        class="json-editor"
        type="textarea"
        resize="none"
        :autosize="false"
        placeholder='[{"caseId":"1","question":"..."}]'
        @focus="emit('json-focus')"
        @blur="emit('json-blur')"
        @input="emit('json-input', String($event))"
      />
      <div v-if="jsonError" class="json-error">{{ jsonError }}</div>
    </div>
  </aside>

  <button v-else class="json-expand-button" type="button" @click="emit('update:collapsed', false)">
    <span class="json-expand-icon">{ }</span>
    <span>JSON</span>
  </button>
</template>

<style scoped>
.panel-right {
  display: flex;
  flex-direction: column;
  flex: 0 1 auto;
  min-width: 220px;
  max-width: 760px;
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

.panel-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.json-header {
  gap: 8px;
}

.json-toggle-button {
  flex-shrink: 0;
}

.json-editor-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  background: var(--el-bg-color);
}

.json-editor {
  flex: 1;
  min-height: 0;
}

.json-editor :deep(.el-textarea__inner) {
  height: 100%;
  min-height: 100%;
  padding: 14px;
  border: none;
  border-radius: 0;
  box-shadow: none;
  resize: none;
  background: var(--el-bg-color);
  font-size: 12px;
  font-family: var(--font-mono);
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.json-editor :deep(.el-textarea__inner:focus) {
  box-shadow: inset 0 0 0 1px var(--el-color-primary-light-5);
}

.json-error {
  flex-shrink: 0;
  padding: 0 12px 10px;
  font-size: 12px;
  color: var(--el-color-danger);
}

.json-expand-button {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  color: var(--el-text-color-regular);
  background: var(--observe-bg-card, var(--el-bg-color));
  border: 0.5px solid var(--observe-border, var(--el-border-color));
  border-radius: 8px;
  box-shadow: 0 6px 18px rgb(15 23 42 / 8%);
  cursor: pointer;
  transition:
    color var(--transition-fast),
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
  font-family: inherit;
  font-size: 12px;
}

.json-expand-button:hover {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 8px 24px rgb(15 23 42 / 12%);
}

.json-expand-icon {
  font-family: var(--font-mono);
  color: var(--el-color-primary);
}
</style>
