<script setup lang="ts">
import { computed, reactive, watch } from "vue";
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
import { useSharedText } from "../context";

interface AttrDef {
  name: string;
}

interface ClassDef {
  className: string;
  showName: string;
  attrs: AttrDef[];
}

export interface NewAttributeInput {
  className: string;
  attrName: string;
  showName: string;
  attrDesc: string;
  type: string;
  bizzKey: boolean;
  enable: boolean;
  primaryKey: boolean;
}

const props = defineProps<{
  modelValue: boolean;
  owner: ClassDef | null;
  saving: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  create: [input: NewAttributeInput];
}>();

const { t } = useSharedText();
// The dialog, originally appended to body, mounts in the popper container inside this instance's root (shared with dropdowns) and follows this instance's theme and lifecycle.
const { selector: overlayTarget } = usePopperContainerId();
const { message } = useManagerFeedback();
const apiNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});
const form = reactive({
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
    name: "",
    type: "varchar",
    showName: "",
    attrDesc: "",
    enable: true,
    bizzKey: false,
    primaryKey: false,
  });
}

function submit() {
  if (!props.owner) return;

  const attrName = form.name.trim();
  if (!attrName || !apiNamePattern.test(attrName)) {
    message.warning(t("hotData.enterAttrName"));
    return;
  }
  if (props.owner.attrs.some((attr) => attr.name === attrName)) {
    message.warning(t("hotData.attrNameExists"));
    return;
  }
  if (!form.showName.trim()) {
    message.warning(t("admin.enterDisplayName"));
    return;
  }

  emit("create", {
    className: props.owner.className,
    attrName,
    showName: form.showName.trim(),
    attrDesc: form.attrDesc.trim(),
    type: form.type,
    bizzKey: form.bizzKey,
    enable: form.enable,
    primaryKey: form.primaryKey,
  });
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
    :title="t('hotData.createAttr')"
    width="440px"
    :append-to="overlayTarget"
  >
    <el-form label-position="top">
      <el-form-item :label="t('hotData.belongClass')">
        <el-input :model-value="owner ? `${owner.showName} (${owner.className})` : ''" disabled />
      </el-form-item>
      <el-form-item :label="t('hotData.attrName')" required>
        <el-input
          v-model="form.name"
          :placeholder="t('hotData.enterAttrName')"
          maxlength="80"
          show-word-limit
        />
      </el-form-item>
      <el-form-item :label="t('hotData.dataType')" required>
        <el-select v-model="form.type" style="width: 100%">
          <el-option label="varchar" value="varchar" />
          <el-option label="int" value="int" />
          <el-option label="float" value="float" />
          <el-option label="datetime" value="datetime" />
          <el-option label="boolean" value="boolean" />
          <el-option label="text" value="text" />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('hotData.attrShowName')" required>
        <el-input v-model="form.showName" maxlength="80" show-word-limit />
      </el-form-item>
      <el-form-item :label="t('hotData.attrDesc')">
        <el-input
          v-model="form.attrDesc"
          type="textarea"
          :rows="3"
          maxlength="400"
          show-word-limit
        />
      </el-form-item>
      <div class="switch-grid">
        <el-form-item :label="t('common.enable')">
          <el-switch v-model="form.enable" />
        </el-form-item>
        <el-form-item :label="t('hotData.mustReturn')">
          <el-switch v-model="form.bizzKey" />
        </el-form-item>
        <el-form-item :label="t('hotData.primaryKey')">
          <el-switch v-model="form.primaryKey" />
        </el-form-item>
      </div>
    </el-form>
    <template #footer>
      <el-button :disabled="saving" @click="visible = false">{{ t("common.cancel") }}</el-button>
      <el-button type="primary" :loading="saving" @click="submit">{{ t("common.add") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
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
