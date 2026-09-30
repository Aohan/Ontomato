<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElOption,
  ElSelect,
  ElSwitch,
  usePopperContainerId,
} from "element-plus";
import { useManagerFeedback } from "../feedback";
import type { OntologyObject } from "../api";
import { useManagerClient, useOntologyText } from "../context";

const { ot } = useOntologyText();
// The dialog, originally appended to body, mounts in the popper container inside this instance's root (shared with dropdowns) and follows this instance's theme and lifecycle.
const { selector: overlayTarget } = usePopperContainerId();
const { message } = useManagerFeedback();
const { createOntologyAttribute } = useManagerClient();

const props = defineProps<{
  modelValue: boolean;
  className?: string;
  objects?: OntologyObject[];
}>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  created: [className: string, attributeName: string];
}>();

const saving = ref(false);
const apiNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});
const form = reactive({
  className: "",
  name: "",
  type: "varchar",
  showName: "",
  attrDesc: "",
  enable: true,
  bizzKey: false,
  primaryKey: false,
});

function resetForm() {
  Object.assign(form, {
    className: props.className || "",
    name: "",
    type: "varchar",
    showName: "",
    attrDesc: "",
    enable: true,
    bizzKey: false,
    primaryKey: false,
  });
}

async function create() {
  const className = (props.className || form.className).trim();
  const name = form.name.trim();
  const showName = form.showName.trim();
  if (!className) {
    message.warning(ot("selectOwnerObjectType"));
    return;
  }
  if (!name) {
    message.warning(ot("fillAttributeName"));
    return;
  }
  if (!apiNamePattern.test(name)) {
    message.warning(ot("invalidAttributeName"));
    return;
  }
  if (!showName) {
    message.warning(ot("fillDisplayName"));
    return;
  }
  const owner = (props.objects || []).find((object) => object.className === className);
  if (owner?.attrs.some((attribute) => attribute.name === name)) {
    message.warning(ot("duplicateAttributeName"));
    return;
  }

  saving.value = true;
  try {
    await createOntologyAttribute({
      className,
      name,
      showName,
      type: form.type,
      attrDesc: form.attrDesc.trim(),
      enable: form.enable,
      bizzKey: form.bizzKey,
      primaryKey: form.primaryKey,
    });
    message.success(ot("attributeCreated"));
    visible.value = false;
    emit("created", className, name);
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("attributeCreateFailed"));
  } finally {
    saving.value = false;
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) resetForm();
  }
);
</script>

<template>
  <el-dialog
    v-model="visible"
    :lock-scroll="false"
    :title="ot('createAttribute')"
    :append-to="overlayTarget"
  >
    <el-form label-position="top" class="attribute-create-form">
      <el-form-item :label="ot('ownerObjectType')">
        <el-input v-if="className" :model-value="className" disabled />
        <el-select
          v-else
          v-model="form.className"
          :placeholder="ot('selectOwnerObjectType')"
          style="width: 100%"
        >
          <el-option
            v-for="object in objects || []"
            :key="object.className"
            :label="`${object.showName} (${object.className})`"
            :value="object.className"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="ot('attributeName')" required>
        <el-input
          v-model="form.name"
          :placeholder="ot('exampleSerialNumber')"
          maxlength="80"
          show-word-limit
        />
      </el-form-item>
      <el-form-item :label="ot('dataType')" required>
        <el-select v-model="form.type" style="width: 100%">
          <el-option label="varchar" value="varchar" />
          <el-option label="int" value="int" />
          <el-option label="float" value="float" />
          <el-option label="datetime" value="datetime" />
          <el-option label="boolean" value="boolean" />
          <el-option label="text" value="text" />
        </el-select>
      </el-form-item>
      <el-form-item :label="ot('displayName')" required>
        <el-input
          v-model="form.showName"
          :placeholder="ot('exampleSerialNumberZh')"
          maxlength="80"
          show-word-limit
        />
      </el-form-item>
      <el-form-item :label="ot('description')">
        <el-input
          v-model="form.attrDesc"
          type="textarea"
          :rows="3"
          maxlength="400"
          show-word-limit
        />
      </el-form-item>
      <div class="switch-grid">
        <el-form-item :label="ot('enableAttribute')">
          <el-switch v-model="form.enable" />
        </el-form-item>
        <el-form-item :label="ot('businessKey')">
          <el-switch v-model="form.bizzKey" />
        </el-form-item>
        <el-form-item :label="ot('primaryKey')">
          <el-switch v-model="form.primaryKey" />
        </el-form-item>
      </div>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ ot("cancel") }}</el-button>
      <el-button type="primary" :loading="saving" @click="create">{{ ot("create") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.attribute-create-form :deep(.el-form-item) {
  margin-bottom: var(--spacing-lg);
}
.switch-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--spacing-md);
}
@container ontology-manager (max-width: 560px) {
  .switch-grid {
    grid-template-columns: 1fr;
  }
}
</style>
