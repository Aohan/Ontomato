<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import CodeMirrorEditor from "../../../components/CodeMirrorEditor.vue";

const { t } = useI18n();

const visible = defineModel<boolean>("visible");
const code = defineModel<string>("code");

const props = defineProps<{
  title?: string;
  language?: string;
}>();

const localCode = ref("");

const dialogTitle = computed(() => props.title || t("common.editCode"));

const placeholderText = computed(
  () => `export async function execute(input) {
  // ${t("common.codeEditorPlaceholder")}
  return { html: '<div>${t("common.result")}</div>' };
}`
);

watch(visible, (val) => {
  if (val) {
    localCode.value = code.value || "";
  }
});

watch(localCode, (val) => {
  if (visible.value) {
    code.value = val;
  }
});

function handleSave() {
  code.value = localCode.value;
  visible.value = false;
}

function handleCancel() {
  visible.value = false;
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="900px"
    :close-on-click-modal="false"
    class="code-editor-dialog"
  >
    <div class="editor-container">
      <div class="editor-header">
        <el-tag size="small" type="info">{{ language || "javascript" }}</el-tag>
        <span class="char-count">{{ localCode.length }} {{ t("common.characters") }}</span>
      </div>
      <CodeMirrorEditor
        v-model="localCode"
        language="javascript"
        :min-height="400"
        :placeholder="placeholderText"
      />
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
</style>
