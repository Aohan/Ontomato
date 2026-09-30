<script setup lang="ts">
import type { SkillInfo } from "@ontomato/contracts/skills";

import { ref, watch, computed } from "vue";
import { ElMessage } from "element-plus";
import { Pencil } from "lucide-vue-next";
import { skillsApi } from "../api";
import CodeEditorDialog from "./CodeEditorDialog.vue";
import MarkdownEditorDialog from "./MarkdownEditorDialog.vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const visible = defineModel<boolean>("visible");

const props = defineProps<{
  editSkill?: SkillInfo | null;
  /** Category preselected when creating (the list's current filter); editing keeps the skill's own category. */
  initialCategory: SkillInfo["category"];
}>();

const emit = defineEmits<{
  created: [skill: SkillInfo];
  updated: [skill: SkillInfo];
}>();

const isEditMode = computed(() => !!props.editSkill);

const dialogTitle = computed(() => (isEditMode.value ? t("admin.editSkill") : t("admin.addSkill")));

const submitButtonText = computed(() => (isEditMode.value ? t("common.save") : t("common.create")));

const form = ref({
  id: "",
  type: "knowledge" as SkillInfo["type"],
  category: "analysis" as SkillInfo["category"],
  title: "",
  description: "",
  tags: "",
  version: "1.0.0",
  timeout: 5000,
  outputType: "html" as "html" | "json" | "text",
  scriptCode: "",
  skillContent: "",
});

const loading = ref(false);
const showCodeEditor = ref(false);
const showMarkdownEditor = ref(false);

watch(visible, (val) => {
  if (val) {
    if (props.editSkill) {
      form.value = {
        id: props.editSkill.id,
        type: props.editSkill.type,
        category: props.editSkill.category,
        title: props.editSkill.title || "",
        description: props.editSkill.description || "",
        tags: props.editSkill.tags.join(", "),
        version: props.editSkill.version,
        timeout: 5000,
        outputType: (props.editSkill.outputType || "html") as "html" | "json" | "text",
        scriptCode: "",
        skillContent: "",
      };
      loadSkillData();
    } else {
      resetForm();
    }
  }
});

async function loadSkillData() {
  if (!props.editSkill) return;

  try {
    const [scriptData, contentData] = await Promise.all([
      skillsApi.getScript(props.editSkill.id),
      skillsApi.getContent(props.editSkill.id),
    ]);

    if (scriptData.success && scriptData.scriptCode) {
      form.value.scriptCode = scriptData.scriptCode;
    }
    if (contentData.success && contentData.skillContent) {
      form.value.skillContent = contentData.skillContent;
    }
  } catch {
    // ignore
  }
}

async function handleSubmit() {
  if (!form.value.id.trim()) {
    ElMessage.warning(t("admin.pleaseEnterSkillId"));
    return;
  }

  if (!/^[a-z0-9-]+$/.test(form.value.id)) {
    ElMessage.warning(t("admin.skillIdHint"));
    return;
  }

  loading.value = true;
  try {
    const tags = form.value.tags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t);

    if (isEditMode.value) {
      const data = await skillsApi.updateSkill(form.value.id.trim(), {
        title: form.value.title,
        description: form.value.description,
        tags,
        version: form.value.version,
        outputType: form.value.outputType,
        scriptCode: form.value.scriptCode,
        skillContent: form.value.skillContent,
      });
      if (data.success) {
        ElMessage.success(t("admin.skillUpdated"));
        emit("updated", data.skill);
        visible.value = false;
      } else {
        ElMessage.error(data.error || t("admin.updateFailed"));
      }
    } else {
      const data = await skillsApi.createSkill({
        id: form.value.id.trim(),
        type: form.value.type,
        category: form.value.category,
        title: form.value.title,
        description: form.value.description,
        tags,
        version: form.value.version,
        timeout: form.value.timeout,
        outputType: form.value.outputType,
        scriptCode: form.value.scriptCode,
        skillContent: form.value.skillContent,
      });
      if (data.success) {
        ElMessage.success(t("admin.skillCreated"));
        emit("created", data.skill);
        visible.value = false;
      } else {
        ElMessage.error(data.error || t("admin.createFailed"));
      }
    }
  } catch (error) {
    ElMessage.error(
      error instanceof Error
        ? error.message
        : isEditMode.value
          ? t("admin.updateFailed")
          : t("admin.createFailed")
    );
  } finally {
    loading.value = false;
  }
}

// Chart (visualization) skills can only be executable.
function typeForCategory(category: SkillInfo["category"]): SkillInfo["type"] {
  return category === "visualization" ? "executable" : "knowledge";
}

function resetForm() {
  form.value = {
    id: "",
    type: typeForCategory(props.initialCategory),
    category: props.initialCategory,
    title: "",
    description: "",
    tags: "",
    version: "1.0.0",
    timeout: 5000,
    outputType: "html",
    scriptCode: "",
    skillContent: "",
  };
}
</script>

<template>
  <el-dialog v-model="visible" :title="dialogTitle" width="600px" :close-on-click-modal="false">
    <el-form label-width="130px" label-position="right">
      <el-form-item :label="t('admin.skillId')" required>
        <el-input
          v-model="form.id"
          :placeholder="t('hotData.skillIdExample')"
          :disabled="loading || isEditMode"
        />
        <div class="form-tip">{{ t("admin.skillIdImmutable") }}</div>
      </el-form-item>

      <el-form-item :label="t('common.category')" required>
        <el-select
          v-model="form.category"
          :disabled="loading || isEditMode"
          @change="form.type = typeForCategory(form.category)"
        >
          <el-option :label="t('admin.analysis')" value="analysis" />
          <el-option :label="t('admin.visualization')" value="visualization" />
        </el-select>
      </el-form-item>

      <el-form-item :label="t('common.type')" required>
        <el-select
          v-model="form.type"
          :disabled="loading || isEditMode || form.category === 'visualization'"
        >
          <el-option
            v-if="form.category === 'analysis'"
            :label="t('admin.knowledge')"
            value="knowledge"
          />
          <el-option :label="t('admin.executable')" value="executable" />
        </el-select>
      </el-form-item>

      <el-form-item :label="t('common.title')" required>
        <el-input v-model="form.title" :placeholder="t('admin.skillTitle')" :disabled="loading" />
      </el-form-item>

      <el-form-item :label="t('common.description')">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="2"
          :placeholder="t('admin.skillDesc')"
          :disabled="loading"
        />
      </el-form-item>

      <el-form-item :label="t('common.tags')">
        <el-input
          v-model="form.tags"
          :placeholder="t('hotData.commaSeparatedExample')"
          :disabled="loading"
        />
      </el-form-item>

      <el-form-item :label="t('common.version')">
        <el-input v-model="form.version" placeholder="1.0.0" :disabled="loading" />
      </el-form-item>

      <el-form-item v-if="form.type === 'executable'" :label="t('admin.outputType')">
        <el-select v-model="form.outputType" :disabled="loading">
          <el-option label="HTML" value="html" />
          <el-option label="JSON" value="json" />
          <el-option label="Text" value="text" />
        </el-select>
      </el-form-item>

      <el-form-item :label="t('admin.detailedContent')">
        <div class="textarea-with-edit">
          <el-input
            v-model="form.skillContent"
            type="textarea"
            :rows="3"
            :placeholder="t('admin.skillDetail')"
            :disabled="loading"
          />
          <el-button
            type="primary"
            :icon="Pencil"
            circle
            size="small"
            class="edit-btn"
            @click="showMarkdownEditor = true"
          />
        </div>
        <div class="form-tip">{{ t("admin.skillMdHint") }}</div>
      </el-form-item>

      <el-form-item v-if="form.type === 'executable'" :label="t('admin.scriptCode')">
        <div class="textarea-with-edit">
          <el-input
            v-model="form.scriptCode"
            type="textarea"
            :rows="3"
            placeholder="export async function execute(input) { ... }"
            :disabled="loading"
          />
          <el-button
            type="primary"
            :icon="Pencil"
            circle
            size="small"
            class="edit-btn"
            @click="showCodeEditor = true"
          />
        </div>
        <div class="form-tip">{{ t("admin.skillExportHint") }}</div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">{{ t("common.cancel") }}</el-button>
      <el-button type="primary" :loading="loading" @click="handleSubmit">
        {{ submitButtonText }}
      </el-button>
    </template>
  </el-dialog>

  <CodeEditorDialog
    v-model:visible="showCodeEditor"
    v-model:code="form.scriptCode"
    :title="t('admin.editScript')"
    language="javascript"
  />

  <MarkdownEditorDialog
    v-model:visible="showMarkdownEditor"
    v-model:content="form.skillContent"
    :title="t('admin.editDetail')"
  />
</template>

<style scoped>
.form-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.textarea-with-edit {
  position: relative;
  width: 100%;
}

.textarea-with-edit .el-input {
  width: 100%;
}

.textarea-with-edit .edit-btn {
  position: absolute;
  right: 8px;
  bottom: 8px;
  opacity: 0.6;
  transition: opacity 0.2s;
}

.textarea-with-edit:hover .edit-btn {
  opacity: 1;
}
</style>
