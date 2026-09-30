<script setup lang="ts">
import { useI18n } from "vue-i18n";

defineProps<{
  visible: boolean;
  name: string;
  text: string;
  fileName: string;
  importing: boolean;
}>();

const emit = defineEmits<{
  "update:visible": [value: boolean];
  "update:name": [value: string];
  "update:text": [value: string];
  "select-file": [file: File];
  import: [];
}>();

const { t } = useI18n();

function handleBeforeUpload(file: File) {
  emit("select-file", file);
  return false;
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="t('hotData.importCaseSet')"
    width="560px"
    :close-on-click-modal="false"
    @update:model-value="emit('update:visible', Boolean($event))"
  >
    <el-form label-position="top">
      <el-form-item :label="t('common.name')">
        <el-input
          :model-value="name"
          :placeholder="t('hotData.caseSetName')"
          @update:model-value="emit('update:name', String($event))"
        />
      </el-form-item>
      <el-form-item :label="t('hotData.selectJsonFile')">
        <el-upload :show-file-list="false" accept=".json" :before-upload="handleBeforeUpload">
          <el-button>{{ t("hotData.selectFile") }}</el-button>
        </el-upload>
        <span v-if="fileName" class="selected-file-name">
          {{ fileName }}
        </span>
      </el-form-item>
      <el-form-item :label="t('hotData.jsonContent')">
        <el-input
          :model-value="text"
          type="textarea"
          :rows="10"
          placeholder='[{"caseId": "1", "question": "..."}]'
          @update:model-value="emit('update:text', String($event))"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:visible', false)">{{ t("common.cancel") }}</el-button>
      <el-button type="primary" :loading="importing" @click="emit('import')">
        {{ t("common.import") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.selected-file-name {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
