<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const model = defineModel<Record<string, unknown>>({ required: true });
const valid = defineModel<boolean>("valid", { default: true });
const placeholder = '{\n  "chat_template_kwargs": {\n    "enable_thinking": false\n  }\n}';

const draft = ref("");
const error = ref("");
const expandedSections = ref<string[]>([]);
const summary = computed(() =>
  error.value ? t("admin.invalidJson") : JSON.stringify(model.value)
);
let updatingModel = false;

function applyDraft(nextDraft: string) {
  draft.value = nextDraft;
  try {
    const parsed = nextDraft.trim() ? (JSON.parse(nextDraft) as unknown) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError(t("admin.customRequestParametersMustBeObject"));
    }
    error.value = "";
    valid.value = true;
    updatingModel = true;
    model.value = parsed as Record<string, unknown>;
    updatingModel = false;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t("admin.invalidJson");
    valid.value = false;
    expandedSections.value = ["parameters"];
  }
}

watch(
  () => model.value,
  (value) => {
    if (!updatingModel) draft.value = JSON.stringify(value, null, 2);
  },
  { flush: "sync", immediate: true }
);
</script>

<template>
  <el-form-item :error="error" class="custom-request-parameters-item">
    <el-collapse
      v-model="expandedSections"
      class="custom-request-parameters-editor"
      :class="{ 'is-invalid': error }"
    >
      <el-collapse-item name="parameters">
        <template #title>
          <span class="custom-request-parameters-heading">
            <span class="custom-request-parameters-title">
              {{ t("admin.customRequestParameters") }}
            </span>
            <code class="custom-request-parameters-summary">{{ summary }}</code>
          </span>
        </template>
        <el-input
          :model-value="draft"
          type="textarea"
          :rows="7"
          resize="vertical"
          :placeholder="placeholder"
          :spellcheck="false"
          @update:model-value="applyDraft"
        />
        <p class="custom-request-parameters-hint">
          {{ t("admin.customRequestParametersHint") }}
        </p>
      </el-collapse-item>
    </el-collapse>
  </el-form-item>
</template>

<style scoped src="./business-config.css"></style>
