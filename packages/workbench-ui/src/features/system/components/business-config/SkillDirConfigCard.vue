<script setup lang="ts">
import { FolderCog } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  saving: boolean;
  disabled: boolean;
}>();

const skilldir = defineModel<string>("skilldir", { required: true });

const emit = defineEmits<{
  save: [];
}>();
</script>

<template>
  <div class="admin-card config-card">
    <div class="card-header">
      <el-icon :size="20"><FolderCog /></el-icon>
      <span>{{ t("admin.skillDir") }}</span>
    </div>
    <div class="card-body">
      <el-form
        class="config-form"
        :disabled="props.disabled || props.saving"
        label-width="160px"
        label-position="left"
        size="default"
      >
        <el-form-item :label="t('admin.skillDir')">
          <el-input v-model="skilldir" placeholder="skills/aftercalculate" />
        </el-form-item>
        <el-form-item class="form-actions">
          <el-button
            type="primary"
            :loading="props.saving"
            :disabled="props.disabled"
            @click="emit('save')"
          >
            {{ t("common.saveConfig") }}
          </el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<style scoped src="./business-config.css"></style>
