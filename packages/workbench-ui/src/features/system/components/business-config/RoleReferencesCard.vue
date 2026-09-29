<script setup lang="ts">
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

const systemAgents = defineModel<Record<"default" | "diagnosis", { model: string }>>(
  "systemAgents",
  { required: true }
);
const queryAgents = defineModel<Record<AgentKey, BackendAgentConfig>>("queryAgents", {
  required: true,
});

const emit = defineEmits<{
  save: [];
}>();

const systemRoles = [
  { key: "default" as const, label: "admin.systemModel" },
  { key: "diagnosis" as const, label: "admin.diagnosisModel" },
];
</script>

<template>
  <div class="admin-card config-card">
    <div class="card-header">
      <el-icon :size="20"><Cpu /></el-icon>
      <span>{{ t("admin.backendAgentConfig") }}</span>
    </div>
    <div class="card-body">
      <ul class="model-list">
        <li v-for="role in systemRoles" :key="role.key" class="model-item">
          <span class="role-name">{{ t(role.label) }}</span>
          <el-select
            v-model="systemAgents[role.key].model"
            class="role-model-select"
            :aria-label="t(role.label)"
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
        <li v-for="key in agentKeys" :key="key" class="model-item">
          <span class="role-name">{{ t(`admin.agentRoles.${key}`) }}</span>
          <el-select
            v-model="queryAgents[key].model"
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
          :disabled="props.disabled"
          @click="emit('save')"
        >
          {{ t("common.save") }}
        </el-button>
      </el-form-item>
    </div>
  </div>
</template>

<style scoped src="./business-config.css"></style>
