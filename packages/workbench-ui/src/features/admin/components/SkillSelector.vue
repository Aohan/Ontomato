<template>
  <div class="skill-selector">
    <el-alert
      v-if="loadError"
      :title="`${t('admin.skillLoadFailed')}${detailSeparator}${loadError}`"
      type="error"
      show-icon
      :closable="false"
    />
    <div class="skill-list">
      <div
        v-for="skill in skills"
        :key="skill.id"
        class="skill-card"
        :class="{ selected: selectedSkills.includes(skill.id) }"
        @click="toggleSkill(skill.id)"
      >
        <div class="skill-header">
          <div class="skill-title-row">
            <div class="skill-title">{{ skill.title || skill.id }}</div>
            <el-tag v-if="!skill.enabled" size="small" type="warning">
              {{ t("common.disabled") }}
            </el-tag>
          </div>
          <el-checkbox
            :model-value="selectedSkills.includes(skill.id)"
            @click.stop="toggleSkill(skill.id)"
          />
        </div>
        <div v-if="skill.description" class="skill-description">
          {{ skill.description }}
        </div>
        <div v-if="skill.tags && skill.tags.length > 0" class="skill-tags">
          <el-tag v-for="tag in skill.tags" :key="tag" size="small" type="info">
            {{ tag }}
          </el-tag>
        </div>
      </div>

      <el-empty
        v-if="!loadError && skills.length === 0"
        :description="t('admin.noAvailableSkills')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { skillsApi, type AnalysisSkill } from "../../skills/api";
import { useI18n } from "vue-i18n";
import { errorPunctuation } from "../../../utils/error-punctuation";

const { detailSeparator } = errorPunctuation();

const { t } = useI18n();

const props = defineProps<{
  modelValue?: string[];
  title?: string;
  hint?: string;
  mode?: "analysis" | "visualization";
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string[]];
  loaded: [skills: AnalysisSkill[]];
}>();

const skills = ref<AnalysisSkill[]>([]);
const selectedSkills = ref<string[]>([]);
const loadError = ref("");

// Load the analysis skill list
async function loadSkills() {
  try {
    loadError.value = "";
    skills.value =
      props.mode === "visualization"
        ? await skillsApi.listVisualizationSkills()
        : await skillsApi.listAnalysisSkills();
    emit("loaded", skills.value);
  } catch (error) {
    skills.value = [];
    loadError.value = error instanceof Error ? error.message : String(error);
  }
}

// Toggle skill selection
function toggleSkill(skillId: string) {
  const index = selectedSkills.value.indexOf(skillId);
  if (index > -1) {
    selectedSkills.value = selectedSkills.value.filter((id) => id !== skillId);
  } else {
    selectedSkills.value = [...selectedSkills.value, skillId];
  }
  emit("update:modelValue", selectedSkills.value);
}

// Watch external value changes
watch(
  () => props.modelValue,
  (newValue) => {
    selectedSkills.value = [...(newValue ?? [])];
  },
  { immediate: true }
);

// Initialize
loadSkills();
</script>

<style scoped>
.skill-selector {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.skill-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--spacing-md);
}

.skill-card {
  padding: var(--spacing-md);
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.skill-card:hover {
  border-color: var(--el-color-primary-light-7);
  box-shadow: var(--el-shadow-sm);
}

.skill-card.selected {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.skill-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-xs);
}

.skill-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.skill-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.skill-description {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: var(--spacing-sm);
  line-height: 1.5;
}

.skill-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
