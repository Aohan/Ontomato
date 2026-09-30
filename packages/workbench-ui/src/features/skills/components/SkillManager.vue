<script setup lang="ts">
import type { AnalysisAgentSkillReference as SkillAgentReference } from "@ontomato/contracts/skills";

import type { SkillInfo } from "@ontomato/contracts/skills";

import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessageBox, ElMessage } from "element-plus";
import type { UploadFile } from "element-plus";
import { Search, Plus, Upload } from "lucide-vue-next";
import SkillCard from "./SkillCard.vue";
import SkillFormDialog from "./SkillFormDialog.vue";
import SkillDebugDialog from "./SkillDebugDialog.vue";
import { skillsApi } from "../api";
import { authHost } from "../../../utils/auth";
import { ApiRequestError } from "../../../utils/api";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const route = useRoute();
const router = useRouter();
const skills = ref<SkillInfo[]>([]);
const searchQuery = ref("");
const loading = ref(false);
const toggleLoading = ref<Record<string, boolean>>({});
const showFormDialog = ref(false);
const editingSkill = ref<SkillInfo | null>(null);
const showDebugDialog = ref(false);
const debuggingSkill = ref<SkillInfo | null>(null);
const importLoading = ref(false);

// Category filter kept in the category query (URL input): only the two category values filter, anything else shows all.
const categoryFilter = computed<SkillInfo["category"] | "all">({
  get: () => {
    const category = route.query.category;
    return category === "analysis" || category === "visualization" ? category : "all";
  },
  set: (category) => {
    router.replace({ query: category === "all" ? {} : { category } });
  },
});

const filteredByCategory = computed(() => {
  const category = categoryFilter.value;
  return category === "all" ? skills.value : skills.value.filter((s) => s.category === category);
});

const filteredSkills = computed(() => {
  const categorySkills = filteredByCategory.value;
  if (!searchQuery.value.trim()) return categorySkills;
  const query = searchQuery.value.toLowerCase();
  return categorySkills.filter(
    (s) =>
      s.title?.toLowerCase().includes(query) ||
      s.id.toLowerCase().includes(query) ||
      s.description?.toLowerCase().includes(query) ||
      s.tags.some((t) => t.toLowerCase().includes(query))
  );
});

async function loadSkills() {
  loading.value = true;
  try {
    const data = await skillsApi.fetchSkills();
    if (data.success) {
      skills.value = data.skills;
    }
  } catch {
    ElMessage.error(t("admin.skillLoadFailed"));
  } finally {
    loading.value = false;
  }
}

async function handleToggle(skillId: string) {
  toggleLoading.value[skillId] = true;
  try {
    const data = await skillsApi.toggleSkill(skillId);
    if (data.success) {
      const skill = skills.value.find((s) => s.id === skillId);
      if (skill) {
        skill.enabled = data.enabled;
      }
      ElMessage.success(data.enabled ? t("admin.skillEnabled") : t("admin.skillDisabled"));
    } else {
      ElMessage.warning(data.error || t("admin.operationFailed"));
    }
  } catch {
    ElMessage.error(t("admin.operationFailed"));
  } finally {
    toggleLoading.value[skillId] = false;
  }
}

function handleEdit(skillId: string) {
  const skill = skills.value.find((s) => s.id === skillId);
  if (skill) {
    editingSkill.value = skill;
    showFormDialog.value = true;
  }
}

async function handleDelete(skillId: string) {
  try {
    const referenceData = await skillsApi.getReferences(skillId);
    const affectedAgents: SkillAgentReference[] = Array.isArray(referenceData.affectedAgents)
      ? referenceData.affectedAgents
      : [];
    const confirmMessage = affectedAgents.length
      ? t("admin.deleteSkillAffectedConfirm", {
          id: skillId,
          agents: affectedAgents
            .map((agent) => {
              const usages = [
                agent.usesAnalysis ? t("admin.analysisSkills") : "",
                agent.usesVisualization ? t("admin.visualizationSkills") : "",
              ].filter(Boolean);
              return `${agent.name} (${usages.join("/")})`;
            })
            .join(", "),
        })
      : t("admin.deleteSkillConfirm", { id: skillId });

    await ElMessageBox.confirm(confirmMessage, t("common.deleteConfirm"), {
      type: "warning",
      confirmButtonText: t("common.delete"),
      cancelButtonText: t("common.cancel"),
    });

    const data = await skillsApi.deleteSkill(skillId);
    if (data.success) {
      skills.value = skills.value.filter((s) => s.id !== skillId);
      ElMessage.success(t("admin.skillDeleted"));
    }
  } catch (error) {
    if (error !== "cancel") {
      ElMessage.error(t("admin.deleteFailed"));
    }
  }
}

function handleAddClick() {
  editingSkill.value = null;
  showFormDialog.value = true;
}

function handleSkillCreated(skill: SkillInfo) {
  skills.value.push(skill);
  showFormDialog.value = false;
}

function handleSkillUpdated(skill: SkillInfo) {
  const index = skills.value.findIndex((s) => s.id === skill.id);
  if (index !== -1) {
    skills.value[index] = skill;
  }
  showFormDialog.value = false;
}

function handleDebug(skillId: string) {
  const skill = skills.value.find((s) => s.id === skillId);
  if (skill && skill.type === "executable") {
    debuggingSkill.value = skill;
    showDebugDialog.value = true;
  }
}

function handleExport(skillId: string) {
  const link = document.createElement("a");
  const params = new URLSearchParams();
  const token = authHost().getToken();
  const apiKey = authHost().getApiKey();
  if (token) params.set("tk", token);
  else if (apiKey) params.set("apiKey", apiKey);
  const query = params.toString();
  link.href = skillsApi.exportUrl(skillId, query);
  link.download = `${skillId}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function doImport(file: File, overwrite = false) {
  importLoading.value = true;
  try {
    const formData = new FormData();
    formData.append("file", file);

    const data = await skillsApi.importSkill(formData, overwrite);
    if (data.success) {
      if (overwrite) {
        const idx = skills.value.findIndex((s) => s.id === data.skill.id);
        if (idx !== -1) {
          skills.value[idx] = data.skill;
        } else {
          skills.value.push(data.skill);
        }
      } else {
        skills.value.push(data.skill);
      }
      ElMessage.success(
        t("admin.skillImportSuccess", {
          id: data.skill.id,
          action: overwrite ? t("admin.overwrite") : t("common.import"),
        })
      );
    } else {
      ElMessage.error(data.error || t("admin.importFailed"));
    }
  } catch (error: unknown) {
    if (error instanceof ApiRequestError && error.code === "SKILL_EXISTS") {
      try {
        await ElMessageBox.confirm(
          t("admin.skillExists", {
            id: String(
              (error.payload.details as { skillId?: unknown } | undefined)?.skillId ||
                t("common.unknown")
            ),
          }),
          t("common.tip"),
          {
            confirmButtonText: t("admin.overwrite"),
            cancelButtonText: t("common.cancel"),
            type: "warning",
          }
        );
        await doImport(file, true);
      } catch {
        // Cancelled by the user
      }
      return;
    }
    ElMessage.error(error instanceof Error ? error.message : t("admin.importFailed"));
  } finally {
    importLoading.value = false;
  }
}

async function handleImport(uploadFile: UploadFile) {
  const file = uploadFile.raw;
  if (!file) return;

  if (!file.name.endsWith(".zip")) {
    ElMessage.warning(t("admin.zipOnly"));
    return;
  }

  await doImport(file);
}

onMounted(() => {
  loadSkills();
});
</script>

<template>
  <div class="skill-manager">
    <div class="toolbar">
      <el-radio-group v-model="categoryFilter" :aria-label="t('common.category')">
        <el-radio-button value="all">{{ t("common.all") }}</el-radio-button>
        <el-radio-button value="analysis">{{ t("admin.analysis") }}</el-radio-button>
        <el-radio-button value="visualization">{{ t("admin.visualization") }}</el-radio-button>
      </el-radio-group>
      <el-input
        v-model="searchQuery"
        :placeholder="t('admin.searchSkill')"
        :prefix-icon="Search"
        clearable
        style="width: 300px"
      />
      <div class="toolbar-actions">
        <el-upload
          :show-file-list="false"
          accept=".zip"
          :auto-upload="false"
          :disabled="importLoading"
          :on-change="handleImport"
        >
          <el-button type="default" :icon="Upload" :loading="importLoading">
            {{ t("admin.importSkill") }}
          </el-button>
        </el-upload>
        <el-button type="primary" :icon="Plus" @click="handleAddClick">
          {{ t("admin.addSkill") }}
        </el-button>
      </div>
    </div>

    <div v-loading="loading" class="skills-container">
      <div class="skills-grid">
        <SkillCard
          v-for="skill in filteredSkills"
          :key="skill.id"
          :skill="skill"
          :loading="toggleLoading[skill.id]"
          @toggle="handleToggle"
          @edit="handleEdit"
          @delete="handleDelete"
          @debug="handleDebug"
          @export="handleExport"
        />
      </div>
      <div v-if="!loading && filteredSkills.length === 0" class="empty-state">
        <span v-if="searchQuery">{{ t("admin.noMatchingSkills") }}</span>
        <span v-else>{{ t("admin.noSkillsHint") }}</span>
      </div>
    </div>
  </div>

  <SkillFormDialog
    v-model:visible="showFormDialog"
    :edit-skill="editingSkill"
    :initial-category="categoryFilter === 'all' ? 'analysis' : categoryFilter"
    @created="handleSkillCreated"
    @updated="handleSkillUpdated"
  />

  <SkillDebugDialog v-model:visible="showDebugDialog" :skill="debuggingSkill" />
</template>

<style scoped>
.skill-manager {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.toolbar-actions {
  display: flex;
  gap: var(--spacing-sm);
}

.skills-container {
  flex: 1;
  overflow-y: auto;
}

.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--spacing-lg);
}

.empty-state {
  text-align: center;
  padding: var(--spacing-3xl) var(--spacing-xl);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  background: var(--el-fill-color-lighter);
  border-radius: var(--radius-xl);
  border: 2px dashed var(--el-border-color);
}

@media (max-width: 768px) {
  .toolbar {
    flex-direction: column;
    align-items: flex-start;
  }

  .toolbar .el-input {
    width: 100%;
  }

  .skills-grid {
    grid-template-columns: 1fr;
  }
}
</style>
