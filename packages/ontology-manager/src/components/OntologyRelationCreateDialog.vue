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
  usePopperContainerId,
} from "element-plus";
import { useManagerFeedback } from "../feedback";
import type { OntologyObject } from "../api";
import { useManagerClient, useOntologyText } from "../context";

const { ot } = useOntologyText();
// The dialog, originally appended to body, mounts in the popper container inside this instance's root (shared with dropdowns) and follows this instance's theme and lifecycle.
const { selector: overlayTarget } = usePopperContainerId();
const { message } = useManagerFeedback();
const { createOntologyRelation } = useManagerClient();

const props = defineProps<{
  modelValue: boolean;
  objects: OntologyObject[];
  relations?: string[];
}>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  created: [relationship: string];
}>();

const saving = ref(false);
const apiNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});
const form = reactive({
  relationship: "",
  fromclass: "",
  toclass: "",
  desc: "",
});

function resetForm() {
  Object.assign(form, {
    relationship: "",
    fromclass: "",
    toclass: "",
    desc: "",
  });
}

async function create() {
  const relationship = form.relationship.trim();
  const desc = form.desc.trim();
  if (!relationship) {
    message.warning(ot("fillRelationName"));
    return;
  }
  if (!apiNamePattern.test(relationship)) {
    message.warning(ot("invalidRelationName"));
    return;
  }
  if ((props.relations || []).includes(relationship)) {
    message.warning(ot("duplicateRelationName"));
    return;
  }
  if (!form.fromclass) {
    message.warning(ot("selectSourceObject"));
    return;
  }
  if (!form.toclass) {
    message.warning(ot("selectTargetObject"));
    return;
  }
  if (!desc) {
    message.warning(ot("fillRelationDescription"));
    return;
  }

  saving.value = true;
  try {
    await createOntologyRelation({
      relationship,
      fromclass: form.fromclass,
      toclass: form.toclass,
      desc,
    });
    message.success(ot("relationCreated"));
    visible.value = false;
    emit("created", relationship);
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("relationCreateFailed"));
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
    :title="ot('createRelationType')"
    :append-to="overlayTarget"
  >
    <el-form label-position="top" class="relation-create-form">
      <el-form-item :label="ot('relationName')" required>
        <el-input v-model="form.relationship" maxlength="80" show-word-limit />
      </el-form-item>
      <el-form-item :label="ot('sourceObject')" required>
        <el-select
          v-model="form.fromclass"
          :placeholder="ot('selectSourceObject')"
          style="width: 100%"
        >
          <el-option
            v-for="object in objects"
            :key="object.className"
            :label="`${object.showName} (${object.className})`"
            :value="object.className"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="ot('targetObject')" required>
        <el-select
          v-model="form.toclass"
          :placeholder="ot('selectTargetObject')"
          style="width: 100%"
        >
          <el-option
            v-for="object in objects"
            :key="object.className"
            :label="`${object.showName} (${object.className})`"
            :value="object.className"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="ot('relationDescription')" required>
        <el-input v-model="form.desc" type="textarea" :rows="3" maxlength="400" show-word-limit />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ ot("cancel") }}</el-button>
      <el-button type="primary" :loading="saving" @click="create">{{ ot("create") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.relation-create-form :deep(.el-form-item) {
  margin-bottom: var(--spacing-lg);
}
</style>
