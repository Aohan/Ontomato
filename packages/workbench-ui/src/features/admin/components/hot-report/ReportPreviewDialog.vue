<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  visible: boolean;
  loading: boolean;
  title: string;
  content: string;
}>();

const emit = defineEmits<{
  "update:visible": [value: boolean];
}>();

const { t } = useI18n();

const modelVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit("update:visible", value),
});
</script>

<template>
  <el-dialog v-model="modelVisible" :title="t('report.preview')" width="860px" destroy-on-close>
    <div v-loading="loading" class="report-preview">
      <div class="report-preview-title">{{ title }}</div>
      <div class="report-preview-content">{{ content }}</div>
    </div>
    <template #footer>
      <el-button @click="modelVisible = false">{{ t("common.close") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.report-preview {
  max-height: 560px;
  overflow: auto;
}

.report-preview-title {
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  margin-bottom: var(--spacing-md);
  color: var(--el-text-color-primary);
}

.report-preview-content {
  padding: var(--spacing-md);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-lg);
  background: var(--el-fill-color-lighter);
  font-size: var(--text-sm);
  line-height: 1.6;
  white-space: pre-wrap;
}
</style>
