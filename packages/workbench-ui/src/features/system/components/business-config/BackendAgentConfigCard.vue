<script setup lang="ts">
import { computed } from "vue";
import { Cpu } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import {
  agentKeys,
  modelLabel,
  type AgentKey,
  type BackendAgentConfig,
  type BackendModelConfig,
} from "../../types";

const { t } = useI18n();

const props = defineProps<{
  models: Pick<BackendModelConfig, "name" | "displayName">[];
  saving: boolean;
  disabled: boolean;
}>();

const agents = defineModel<Record<AgentKey, BackendAgentConfig>>("agents", { required: true });

const emit = defineEmits<{
  save: [];
}>();

// 五个键必须完整；选项只来自已保存模型，值始终是配置 ID，未选角色不允许提交。
const incomplete = computed(() => agentKeys.some((key) => !agents.value[key].model));
</script>

<template>
  <div class="admin-card config-card">
    <div class="card-header">
      <el-icon :size="20"><Cpu /></el-icon>
      <span>{{ t("admin.backendAgentConfig") }}</span>
    </div>
    <div class="card-body">
      <ul class="model-list">
        <li v-for="key in agentKeys" :key="key" class="model-item">
          <span class="role-name">{{ t(`admin.agentRoles.${key}`) }}</span>
          <el-select
            v-model="agents[key].model"
            class="role-model-select"
            :aria-label="t(`admin.agentRoles.${key}`)"
            :disabled="props.disabled || props.saving"
          >
            <el-option
              v-for="model in props.models"
              :key="model.name"
              :label="modelLabel(model)"
              :value="model.name"
            />
          </el-select>
        </li>
      </ul>

      <el-form-item class="form-actions">
        <el-button
          type="primary"
          :loading="props.saving"
          :disabled="props.disabled || incomplete"
          @click="emit('save')"
        >
          {{ t("admin.saveAgentModels") }}
        </el-button>
      </el-form-item>
    </div>
  </div>
</template>

<style scoped src="./business-config.css"></style>
