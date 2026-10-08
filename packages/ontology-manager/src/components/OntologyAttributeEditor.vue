<script setup lang="ts">
import { reactive, ref } from "vue";
import { Save, Trash2 } from "lucide-vue-next";
import { ElButton, ElForm, ElFormItem, ElInput, ElSwitch } from "element-plus";
import { useManagerFeedback } from "../feedback";
import type { OntologyAttribute } from "../api";
import { useManagerClient, useOntologyText } from "../context";

const { ot } = useOntologyText();
const { message, confirm } = useManagerFeedback();
const { deleteOntologyAttribute, updateOntologyAttribute } = useManagerClient();

const props = defineProps<{ className: string; attribute: OntologyAttribute }>();
const emit = defineEmits<{ saved: []; deleted: [] }>();

const saving = ref(false);
const deleting = ref(false);
const form = reactive({
  showName: "",
  attrDesc: "",
  enable: true,
  bizzkeyBool: false,
  primaryKey: false,
});

function syncForm() {
  form.showName = props.attribute.showName || "";
  form.attrDesc = props.attribute.attrDesc || "";
  form.enable = props.attribute.enable !== false;
  form.bizzkeyBool = Boolean(props.attribute.bizzkeyBool);
  form.primaryKey = Boolean(props.attribute.primaryKey);
}
syncForm();

async function save() {
  const showName = form.showName.trim();
  if (!showName) {
    message.warning(ot("fillDisplayName"));
    return;
  }
  const attribute = props.attribute;
  const changes: Parameters<typeof updateOntologyAttribute>[2] = {};
  if (showName !== attribute.showName) changes.showName = showName;
  if (form.attrDesc.trim() !== (attribute.attrDesc || ""))
    changes.attrDesc = form.attrDesc.trim();
  if (form.enable !== (attribute.enable !== false)) changes.enable = form.enable;
  if (form.bizzkeyBool !== Boolean(attribute.bizzkeyBool))
    changes.bizzkeyBool = form.bizzkeyBool;
  if (form.primaryKey && !attribute.primaryKey) changes.primaryKey = true;
  if (!Object.keys(changes).length) return;

  saving.value = true;
  try {
    await updateOntologyAttribute(props.className, attribute, changes);
    Object.assign(attribute, { ...changes, showName, attrDesc: form.attrDesc.trim() });
    message.success(ot("attributeSaved"));
    emit("saved");
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("attributeSaveFailed"));
  } finally {
    saving.value = false;
  }
}

async function remove() {
  try {
    await confirm(
      ot("deleteAttributeConfirm", { name: props.attribute.showName }),
      ot("deleteConfirmTitle")
    );
    deleting.value = true;
    await deleteOntologyAttribute(props.className, props.attribute.name);
    message.success(ot("attributeDeleted"));
    emit("deleted");
  } catch (error) {
    if (error !== "cancel")
      message.error(error instanceof Error ? error.message : ot("attributeDeleteFailed"));
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <div class="attribute-editor">
    <el-form label-position="top" class="attribute-editor-form">
      <el-form-item :label="ot('displayName')">
        <el-input v-model="form.showName" maxlength="80" show-word-limit />
      </el-form-item>
      <el-form-item :label="ot('description')">
        <el-input
          v-model="form.attrDesc"
          type="textarea"
          :rows="2"
          maxlength="400"
          show-word-limit
        />
      </el-form-item>
      <div class="attribute-editor-switches">
        <el-form-item :label="ot('enableAttribute')">
          <el-switch v-model="form.enable" />
        </el-form-item>
        <el-form-item :label="ot('businessKey')">
          <el-switch v-model="form.bizzkeyBool" />
        </el-form-item>
        <el-form-item :label="ot('primaryKey')">
          <el-switch v-model="form.primaryKey" :disabled="attribute.primaryKey" />
        </el-form-item>
      </div>
    </el-form>
    <div class="attribute-editor-actions">
      <el-button type="danger" plain :icon="Trash2" :loading="deleting" @click="remove">
        {{ ot("delete") }}
      </el-button>
      <el-button type="primary" :icon="Save" :loading="saving" @click="save">
        {{ ot("save") }}
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.attribute-editor {
  padding: var(--spacing-lg);
  border-top: 1px solid var(--el-border-color-light);
  background: var(--el-fill-color-lighter);
}
.attribute-editor-form :deep(.el-form-item) {
  margin-bottom: var(--spacing-md);
}
.attribute-editor-form :deep(.el-form-item__label) {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.attribute-editor-switches {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xl);
}
.attribute-editor-switches :deep(.el-form-item) {
  margin-bottom: 0;
}
.attribute-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-lg);
}
</style>
