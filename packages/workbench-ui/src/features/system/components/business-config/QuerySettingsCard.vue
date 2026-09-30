<script setup lang="ts">
import type { SystemModelConfig } from "@ontomato/contracts/system-model";

import { computed, ref, watch } from "vue";
import { MessageSquareText } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../../content";

const { t } = useI18n();
const { businessConfigSeparator } = workbenchContent().text;

const abcQuestionModeOptions = [
  { label: "admin.queryModes.quick", value: "no_tool_fixed" },
  { label: "admin.queryModes.intelligent", value: "tool_fixed" },
  { label: "admin.queryModes.deep", value: "harness" },
] as const;

const props = defineProps<{
  loading: boolean;
  saving: boolean;
  loadError: string;
}>();

const model = defineModel<SystemModelConfig>("model", { required: true });

const emit = defineEmits<{
  save: [];
  retry: [];
}>();

const savedSignature = ref("");
const signature = () =>
  JSON.stringify([model.value.abcQuestionMode, model.value.queryTimeoutSeconds]);
const dirty = computed(() => savedSignature.value !== "" && signature() !== savedSignature.value);
watch(
  () => props.loading,
  (loading) => {
    if (!loading && !props.loadError) markSaved();
  },
  { immediate: true }
);

function markSaved() {
  savedSignature.value = signature();
}

defineExpose({ markSaved });
</script>

<template>
  <div class="admin-card config-card">
    <div class="card-header">
      <el-icon :size="20"><MessageSquareText /></el-icon>
      <span>{{ t("admin.querySettings") }}</span>
      <el-tag
        v-if="dirty && !props.loadError && !props.loading"
        type="warning"
        size="small"
        class="dirty-tag"
      >
        {{ t("admin.unsaved") }}
      </el-tag>
    </div>
    <div class="card-body">
      <el-skeleton v-if="props.loading" :rows="1" animated />
      <div v-else-if="props.loadError" class="load-error" role="alert">
        <span>{{ t("admin.loadConfigFailed") }}{{ businessConfigSeparator }}{{ props.loadError }}</span>
        <el-button size="small" @click="emit('retry')">{{ t("common.retry") }}</el-button>
      </div>
      <el-form
        v-else
        class="config-form"
        :disabled="props.saving"
        label-width="160px"
        label-position="left"
        size="default"
      >
        <el-row :gutter="24">
          <el-col :xs="24" :sm="12">
            <el-form-item :label="t('admin.queryMode')">
              <el-select v-model="model.abcQuestionMode" class="question-mode-select">
                <el-option
                  v-for="option in abcQuestionModeOptions"
                  :key="option.value"
                  :label="t(option.label)"
                  :value="option.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12">
            <el-form-item :label="t('admin.queryTimeoutSec')">
              <el-input-number
                v-model="model.queryTimeoutSeconds"
                :min="1"
                :precision="0"
                :step="30"
                controls-position="right"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <el-form-item class="form-actions">
        <el-button
          type="primary"
          :loading="props.saving"
          :disabled="!!props.loadError || props.loading"
          @click="emit('save')"
        >
          {{ t("common.saveConfig") }}
        </el-button>
      </el-form-item>
    </div>
  </div>
</template>

<style scoped src="./business-config.css"></style>
