<script setup lang="ts">
import type { ModelRole } from "@ontomato/contracts/model-settings";
import { Users } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { modelLabel, type ModelEntry, type RoleModels } from "../../types";

const { t } = useI18n();

const props = defineProps<{
  /** Models in the current draft: models and roles are saved together, so a newly added model can be selected immediately. */
  models: Pick<ModelEntry, "name" | "displayName">[];
  disabled: boolean;
}>();

const roles = defineModel<RoleModels>("roles", { required: true });

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
    </div>
    <div class="card-body">
      <section v-for="group in roleGroups" :key="group.titleKey" class="role-group">
        <h4 class="dialog-section">{{ t(group.titleKey) }}</h4>
        <ul class="model-list">
          <li v-for="role in group.roles" :key="role" class="model-item">
            <span class="role-name">{{ t(`admin.modelRoleNames.${role}`) }}</span>
            <el-select
              v-model="roles[role]"
              class="role-model-select"
              clearable
              :value-on-clear="unsetRole"
              :placeholder="t('admin.roleNotConfigured')"
              :aria-label="t(`admin.modelRoleNames.${role}`)"
              :disabled="props.disabled"
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
