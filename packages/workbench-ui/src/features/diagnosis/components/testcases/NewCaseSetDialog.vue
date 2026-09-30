<script setup lang="ts">
import { useI18n } from "vue-i18n";

defineProps<{
  visible: boolean;
  name: string;
  creating: boolean;
}>();

const emit = defineEmits<{
  "update:visible": [value: boolean];
  "update:name": [value: string];
  create: [];
}>();

const { t } = useI18n();
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="t('hotData.newCaseSet')"
    width="400px"
    :close-on-click-modal="false"
    @update:model-value="emit('update:visible', Boolean($event))"
  >
    <el-form label-position="top">
      <el-form-item :label="t('hotData.caseSetName')">
        <el-input
          :model-value="name"
          :placeholder="t('hotData.enterName')"
          @update:model-value="emit('update:name', String($event))"
          @keyup.enter="emit('create')"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:visible', false)">{{ t("common.cancel") }}</el-button>
      <el-button type="primary" :loading="creating" @click="emit('create')">
        {{ t("common.create") }}
      </el-button>
    </template>
  </el-dialog>
</template>
