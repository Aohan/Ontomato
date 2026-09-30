<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput } from "element-plus";
import { useManagerFeedback } from "../feedback";
import { useManagerClient, useOntologyText } from "../context";

const { ot } = useOntologyText();
const { message } = useManagerFeedback();
const { createOntologyObject, loadOntology } = useManagerClient();

const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ created: [className: string] }>();
const saving = ref(false);
const form = reactive({ className: "", primaryKeyName: "", showName: "", classDesc: "" });
const apiNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

watch(visible, (open) => {
  if (open) Object.assign(form, { className: "", primaryKeyName: "", showName: "", classDesc: "" });
});

async function create() {
  const className = form.className.trim();
  const primaryKeyName = form.primaryKeyName.trim();
  const showName = form.showName.trim();
  if (!className || !showName) {
    message.warning(ot("fillApiAndDisplayName"));
    return;
  }
  if (!apiNamePattern.test(className)) {
    message.warning(ot("invalidApiName"));
    return;
  }
  if (!primaryKeyName) {
    message.warning(ot("fillPrimaryKeyName"));
    return;
  }
  if (!apiNamePattern.test(primaryKeyName)) {
    message.warning(ot("invalidAttributeName"));
    return;
  }
  saving.value = true;
  try {
    const ontology = await loadOntology();
    if (ontology.objects.some((object) => object.className === className)) {
      message.warning(ot("objectApiExists"));
      return;
    }
    await createOntologyObject({
      className,
      primaryKeyName,
      showName,
      classDesc: form.classDesc.trim(),
    });
    message.success(ot("objectCreated"));
    visible.value = false;
    emit("created", className);
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("objectCreateFailed"));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :lock-scroll="false"
    :title="ot('createObjectType')"
    width="520px"
    class="object-create-dialog"
  >
    <el-form label-position="top">
      <el-form-item :label="ot('apiName')" required>
        <el-input
          v-model="form.className"
          :placeholder="ot('exampleEquipment')"
          maxlength="80"
          show-word-limit
        />
      </el-form-item>
      <el-form-item :label="ot('primaryKey')" required>
        <el-input
          v-model="form.primaryKeyName"
          :placeholder="ot('examplePrimaryKey')"
          maxlength="80"
          show-word-limit
        />
      </el-form-item>
      <el-form-item :label="ot('displayName')" required>
        <el-input
          v-model="form.showName"
          :placeholder="ot('exampleDevice')"
          maxlength="80"
          show-word-limit
        />
      </el-form-item>
      <el-form-item :label="ot('businessDescription')">
        <el-input
          v-model="form.classDesc"
          type="textarea"
          :rows="3"
          :placeholder="ot('objectDescriptionPlaceholder')"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ ot("cancel") }}</el-button>
      <el-button type="primary" :loading="saving" @click="create">{{ ot("create") }}</el-button>
    </template>
  </el-dialog>
</template>
