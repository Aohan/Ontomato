<script setup lang="ts">
import type { CaseSetListItem as CaseSetItem } from "@ontomato/contracts/autotest";
import { ref } from "vue";
import { useI18n } from "vue-i18n";

defineProps<{
  caseSets: CaseSetItem[];
  loading: boolean;
  selectedCaseSetId: string;
  isDirty: boolean;
  draftCaseSetIds: string[];
}>();

const emit = defineEmits<{
  "update:selectedCaseSetId": [value: string];
  import: [];
  create: [];
  delete: [];
}>();

const { t } = useI18n();
const caseSetSelectRef = ref<any>();

function focus() {
  caseSetSelectRef.value?.focus?.();
}

defineExpose({ focus });
</script>

<template>
  <header class="page-header">
    <div class="header-left">
      <span class="header-label">{{ t("hotData.caseSet") }}</span>
      <div class="selector-wrap">
        <el-select
          ref="caseSetSelectRef"
          :model-value="selectedCaseSetId"
          :placeholder="t('hotData.selectCaseSet')"
          :loading="loading"
          filterable
          @update:model-value="emit('update:selectedCaseSetId', String($event))"
        >
          <el-option
            v-for="cs in caseSets"
            :key="cs.id"
            :label="`${cs.name} (${cs.caseCount})`"
            :value="cs.id"
          >
            <div class="option-content">
              <span>{{ cs.name }} ({{ cs.caseCount }})</span>
              <span v-if="draftCaseSetIds.includes(cs.id)" class="draft-dot" />
            </div>
          </el-option>
        </el-select>
        <span v-if="isDirty" class="dirty-indicator" :title="t('hotData.hasUnsavedChanges')" />
      </div>
    </div>
    <div class="header-right">
      <el-button size="small" @click="emit('import')">{{ t("common.import") }}</el-button>
      <el-button size="small" @click="emit('create')">{{ t("common.create") }}</el-button>
      <el-button size="small" type="danger" :disabled="!selectedCaseSetId" @click="emit('delete')">
        {{ t("common.delete") }}
      </el-button>
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 0.5px solid var(--observe-border, var(--el-border-color));
  flex-shrink: 0;
  background: var(--observe-bg-card, var(--el-bg-color));
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.selector-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.selector-wrap :deep(.el-select) {
  width: 240px;
}

.dirty-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-warning);
  margin-left: 8px;
  flex-shrink: 0;
}

.option-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.draft-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--el-color-warning);
  flex-shrink: 0;
}

.header-right {
  display: flex;
  gap: 8px;
}
</style>
