<script setup lang="ts">
import { Globe } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

withDefaults(
  defineProps<{
    title: string;
    result: string;
    renderedResult?: string;
    running: boolean;
    placeholder: string;
    plainResult?: boolean;
  }>(),
  {
    renderedResult: "",
    plainResult: false,
  }
);

const visible = defineModel<boolean>("visible", { required: true });
const content = defineModel<string>("content", { required: true });

const emit = defineEmits<{
  submit: [];
}>();
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="min(680px, calc(100vw - 32px))"
    :close-on-click-modal="false"
  >
    <el-form label-width="100px">
      <el-form-item :label="t('common.testContent')">
        <el-input v-model="content" type="textarea" :rows="5" :placeholder="placeholder" />
      </el-form-item>
    </el-form>
    <div v-if="result" class="test-result-box">
      <div class="test-result-title">
        <el-icon :size="16"><Globe /></el-icon>
        <span>{{ t("common.responseResult") }}</span>
      </div>
      <pre v-if="plainResult" class="test-result-text">{{ result }}</pre>
      <div v-else class="test-result-text markdown-body" v-html="renderedResult"></div>
    </div>
    <template #footer>
      <el-button @click="visible = false">{{ t("common.close") }}</el-button>
      <el-button type="primary" :loading="running" @click="emit('submit')">
        {{ t("common.sendTest") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.test-result-box {
  margin-top: var(--spacing-lg);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.test-result-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--el-fill-color-light);
  font-weight: var(--font-medium);
  font-size: var(--text-sm);
  color: var(--el-text-color-regular);
  border-bottom: 1px solid var(--el-border-color-light);
}

.test-result-text {
  padding: var(--spacing-md);
  margin: 0;
  max-height: 300px;
  overflow: auto;
  font-size: var(--text-sm);
  line-height: 1.5;
  word-break: break-all;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
}

.test-result-text :deep(pre) {
  white-space: pre-wrap;
}

.test-result-text.markdown-body :deep(p),
.test-result-text.markdown-body :deep(ul),
.test-result-text.markdown-body :deep(ol),
.test-result-text.markdown-body :deep(blockquote),
.test-result-text.markdown-body :deep(table),
.test-result-text.markdown-body :deep(pre) {
  margin-block: 0.4em;
}

.test-result-text.markdown-body :deep(h1) {
  font-size: 1.2em;
}

.test-result-text.markdown-body :deep(h2) {
  font-size: 1.1em;
}

.test-result-text.markdown-body :deep(h3) {
  font-size: 1.05em;
}

.test-result-text.markdown-body :deep(h4),
.test-result-text.markdown-body :deep(h5),
.test-result-text.markdown-body :deep(h6) {
  font-size: 1em;
}

.test-result-text.markdown-body :deep(p),
.test-result-text.markdown-body :deep(li),
.test-result-text.markdown-body :deep(td),
.test-result-text.markdown-body :deep(th) {
  font-size: var(--text-sm);
}
</style>
