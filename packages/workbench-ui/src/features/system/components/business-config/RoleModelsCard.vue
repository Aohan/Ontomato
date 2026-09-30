<script setup lang="ts">
import type { ModelRole } from "@ontomato/contracts/model-settings";
import { Info, Users } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { modelLabel, type ModelEntry, type RoleModels } from "../../types";

const { t } = useI18n();

const props = defineProps<{
  /** The saved models: a model can be selected once its dialog has saved it. */
  models: Pick<ModelEntry, "name" | "displayName">[];
  saving: boolean;
  /** Whether the role draft differs from the saved roles. */
  dirty: boolean;
}>();

// Role draft: submitted only by this card's save.
const roles = defineModel<RoleModels>("roles", { required: true });

const emit = defineEmits<{
  save: [];
}>();

// Query engine roles are consumed by Java and agent roles by Node; both groups choose from all models.
const roleGroups: { titleKey: string; roles: ModelRole[] }[] = [
  { titleKey: "admin.modelRoleGroups.queryEngine", roles: ["query", "coding"] },
  {
    titleKey: "admin.modelRoleGroups.agents",
    roles: ["general", "diagnosis", "knowledgeGovernance"],
  },
];

// Clearing means "not configured": the role value is null in the save request.
const unsetRole = () => null;
</script>

<template>
  <div class="admin-card config-card">
    <div class="card-header">
      <el-icon :size="20"><Users /></el-icon>
      <span>{{ t("admin.roleModels") }}</span>
      <div class="card-header-actions">
        <el-tag v-if="props.dirty" type="warning" size="small">{{ t("admin.unsaved") }}</el-tag>
        <el-button type="primary" size="small" :loading="props.saving" @click="emit('save')">
          {{ t("common.save") }}
        </el-button>
      </div>
    </div>
    <div class="card-body">
      <section v-for="group in roleGroups" :key="group.titleKey" class="role-group">
        <h4 class="dialog-section">{{ t(group.titleKey) }}</h4>
        <ul class="role-grid">
          <li v-for="role in group.roles" :key="role" class="role-cell">
            <div class="role-heading">
              <span class="role-name">{{ t(`admin.modelRoleNames.${role}`) }}</span>
              <el-tooltip
                :content="t(`admin.modelRoleDescriptions.${role}`)"
                :trigger="['hover', 'focus']"
                placement="top"
              >
                <button
                  type="button"
                  class="role-info"
                  :aria-label="t(`admin.modelRoleDescriptions.${role}`)"
                >
                  <Info :size="14" />
                </button>
              </el-tooltip>
            </div>
            <el-select
              v-model="roles[role]"
              clearable
              :value-on-clear="unsetRole"
              :placeholder="t('admin.roleNotConfigured')"
              :aria-label="t(`admin.modelRoleNames.${role}`)"
              :disabled="props.saving"
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
      </section>
    </div>
  </div>
</template>

<style scoped src="./business-config.css"></style>
