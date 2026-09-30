<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { marked } from "../../../utils/marked";
import CodeMirrorEditor from "../../../components/CodeMirrorEditor.vue";

const { t } = useI18n();

const visible = defineModel<boolean>("visible");
const content = defineModel<string>("content");

const props = defineProps<{
  title?: string;
}>();

const localContent = ref("");
const showPreview = ref(false);

const dialogTitle = computed(() => props.title || t("common.editMarkdown"));

const previewHtml = computed(() => {
  if (!localContent.value) return "";
  try {
    return marked.parse(localContent.value);
  } catch {
    return localContent.value;
  }
});

const markdownPlaceholder = computed(() => t("common.markdownEditorPlaceholder"));

watch(visible, (val) => {
  if (val) {
    localContent.value = content.value || "";
    showPreview.value = false;
  }
});

watch(localContent, (val) => {
  if (visible.value) {
    content.value = val;
  }
});

function handleSave() {
  content.value = localContent.value;
  visible.value = false;
}

function handleCancel() {
  visible.value = false;
}

function togglePreview() {
  showPreview.value = !showPreview.value;
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="900px"
    :close-on-click-modal="false"
    class="markdown-editor-dialog"
  >
    <div class="editor-container">
      <div class="editor-header">
        <el-button size="small" @click="togglePreview">
          {{ showPreview ? t("common.hidePreview") : t("common.showPreview") }}
        </el-button>
        <span class="char-count">{{ localContent.length }} {{ t("common.characters") }}</span>
      </div>

      <div class="editor-main" :class="{ 'with-preview': showPreview }">
        <div class="editor-panel">
          <CodeMirrorEditor
            v-model="localContent"
            language="markdown"
            :min-height="showPreview ? 350 : 400"
            :placeholder="markdownPlaceholder"
          />
        </div>

        <div v-if="showPreview" class="preview-panel">
          <div class="panel-label">{{ t("common.preview") }}</div>
          <div class="markdown-preview" v-html="previewHtml" />
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="handleCancel">{{ t("common.cancel") }}</el-button>
      <el-button type="primary" @click="handleSave">{{ t("common.save") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.editor-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.char-count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.editor-main {
  display: flex;
  gap: 12px;
}

.editor-main.with-preview {
  height: 400px;
}

.editor-panel,
.preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-label {
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color);
}

.preview-panel {
  background: var(--el-bg-color-page);
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
}

.markdown-preview {
  flex: 1;
  padding: 12px;
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.6;
}

.markdown-preview :deep(h1) {
  font-size: 24px;
  margin: 16px 0 8px;
  font-weight: 600;
}

.markdown-preview :deep(h2) {
  font-size: 20px;
  margin: 14px 0 6px;
  font-weight: 600;
}

.markdown-preview :deep(h3) {
  font-size: 16px;
  margin: 12px 0 4px;
  font-weight: 600;
}

.markdown-preview :deep(p) {
  margin: 8px 0;
}

.markdown-preview :deep(ul),
.markdown-preview :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.markdown-preview :deep(li) {
  margin: 4px 0;
}

.markdown-preview :deep(code) {
  background: var(--el-fill-color);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 13px;
}

.markdown-preview :deep(pre) {
  background: var(--el-fill-color-dark);
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
}

.markdown-preview :deep(pre code) {
  background: transparent;
  padding: 0;
}

.markdown-preview :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
}

.markdown-preview :deep(th),
.markdown-preview :deep(td) {
  border: 1px solid var(--el-border-color);
  padding: 8px 12px;
}

.markdown-preview :deep(th) {
  background: var(--el-fill-color-light);
}
</style>
