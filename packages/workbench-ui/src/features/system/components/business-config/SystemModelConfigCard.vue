<script setup lang="ts">
import type {
  SystemModelConfigResponse,
  SystemModelEntry,
} from "@ontomato/contracts/system-model";

import { computed, reactive, ref, shallowRef, watch } from "vue";
import { Cpu, Plus } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { JsonObject } from "@ontomato/contracts/system-model";

import CustomRequestParametersEditor from "./CustomRequestParametersEditor.vue";
import { plainOuter } from "../../utils/raw";
import { workbenchContent } from "../../../../content";
const { t } = useI18n();
const { businessConfigSeparator } = workbenchContent().text;

const props = defineProps<{
  loading: boolean;
  saving: boolean;
  loadError: string;
}>();

const model = defineModel<SystemModelConfigResponse>("model", { required: true });

const emit = defineEmits<{
  test: [entry: SystemModelEntry];
  retry: [];
}>();

const dialogVisible = ref(false);
const editingIndex = ref(-1);
const customRequestParametersValid = ref(true);
const savedSignature = ref("");
// Compare only the model library saved in this section; role references are maintained in the separate Role model references card.
function modelSignature(): string {
  return JSON.stringify({
    models: model.value.models.map((entry) => plainOuter(entry)),
  });
}
const dirty = computed(
  () => savedSignature.value !== "" && modelSignature() !== savedSignature.value
);
watch(
  () => props.loading,
  (loading) => {
    if (!loading && !props.loadError) markSaved();
  },
  { immediate: true }
);
// Complete snapshot of the original entry, spread back when editing to keep round trips lossless.
let editingBaseline: SystemModelEntry | null = null;

function emptyDraft(): Omit<SystemModelEntry, "customRequestParameters"> {
  return {
    name: "",
    displayName: "",
    baseUrl: "",
    apiKey: "",
    modelName: "",
    timeoutSeconds: 300,
    maxRetries: 3,
    contextWindow: 256000,
  };
}

const draft = reactive(emptyDraft());
// Custom objects stay out of reactive: Vue's deep proxy would swallow reserved keys, so a shallow ref holds the raw object.
const customParams = shallowRef<JsonObject>({});

function updateCustomParameters(value: JsonObject) {
  // Write the ref explicitly so the template does not treat plain JSON containing __v_isRef as a new ref binding.
  customParams.value = value;
}

const isNew = computed(() => editingIndex.value < 0);
const dialogTitle = computed(() => (isNew.value ? t("admin.addModel") : t("admin.editModel")));
// The three connection fields, ID and display name are required; optional fields such as timeout, retries and context window are pre-filled with defaults.
const draftComplete = computed(() =>
  [draft.name, draft.displayName, draft.baseUrl, draft.apiKey, draft.modelName].every(
    (value) => !!value.trim()
  )
);

function keyStatus(entry: SystemModelEntry): string {
  return entry.apiKey ? t("admin.keyCountConfigured", { n: 1 }) : t("admin.keyMissing");
}

function openAddDialog() {
  if (props.loading || props.saving || props.loadError) return;
  editingIndex.value = -1;
  editingBaseline = null;
  Object.assign(draft, emptyDraft());
  customParams.value = {};
  customRequestParametersValid.value = true;
  dialogVisible.value = true;
}

function openEditDialog(index: number) {
  if (props.loading || props.saving || props.loadError) return;
  const entry = model.value.models[index];
  if (!entry) return;
  editingIndex.value = index;
  // Unwrap only the outer proxy; custom is opaque JSON referenced as-is, and the editor replaces it whole instead of mutating it.
  const raw = plainOuter<SystemModelEntry>(entry);
  editingBaseline = raw;
  Object.assign(draft, {
    name: raw.name,
    displayName: raw.displayName,
    baseUrl: raw.baseUrl,
    apiKey: raw.apiKey,
    modelName: raw.modelName,
    timeoutSeconds: raw.timeoutSeconds,
    maxRetries: raw.maxRetries,
    contextWindow: raw.contextWindow,
  });
  customParams.value = raw.customRequestParameters ?? {};
  customRequestParametersValid.value = true;
  dialogVisible.value = true;
}

function confirmDialog() {
  if (!draftComplete.value) return;
  const snapshot: SystemModelEntry = {
    ...editingBaseline,
    // The config ID is the identity system model references use, so existing entries cannot change it; the display name can change at any time without affecting references.
    name: draft.name.trim(),
    displayName: draft.displayName.trim(),
    baseUrl: draft.baseUrl,
    apiKey: draft.apiKey,
    modelName: draft.modelName,
    customRequestParameters: customParams.value,
    timeoutSeconds: draft.timeoutSeconds,
    maxRetries: draft.maxRetries,
    contextWindow: draft.contextWindow,
  };
  if (editingIndex.value < 0) {
    model.value.models.push(snapshot);
  } else {
    model.value.models[editingIndex.value] = snapshot;
  }
  customParams.value = {};
  dialogVisible.value = false;
}

function removeModel(index: number) {
  model.value.models.splice(index, 1);
}

function markSaved() {
  savedSignature.value = modelSignature();
}

defineExpose({ markSaved });
</script>

<template>
  <div class="admin-card config-card">
    <div class="card-header">
      <el-icon :size="20"><Cpu /></el-icon>
      <span>{{ t("admin.modelList") }}</span>
      <el-tag
        v-if="dirty && !props.loadError && !props.loading"
        type="warning"
        size="small"
        class="dirty-tag"
      >
        {{ t("admin.unsaved") }}
      </el-tag>
      <el-button
        type="primary"
        :icon="Plus"
        size="small"
        class="header-action"
        :disabled="props.loading || props.saving || !!props.loadError"
        @click="openAddDialog"
      >
        {{ t("admin.addModel") }}
      </el-button>
    </div>
    <div class="card-body">
      <el-skeleton v-if="props.loading" :rows="3" animated />
      <div v-else-if="props.loadError" class="load-error" role="alert">
        <span>{{ t("admin.modelListLoadFailed") }}{{ businessConfigSeparator }}{{ props.loadError }}</span>
        <el-button size="small" @click="emit('retry')">{{ t("common.retry") }}</el-button>
      </div>
      <template v-else>
        <el-empty v-if="model.models.length === 0" :description="t('admin.modelListEmpty')">
          <el-button type="primary" @click="openAddDialog">{{ t("admin.addModel") }}</el-button>
        </el-empty>
        <ul v-else class="model-list">
          <li v-for="(entry, index) in model.models" :key="entry.name || index" class="model-item">
            <div class="model-main">
              <span class="model-name">{{ entry.displayName }}</span>
              <code
                v-if="entry.displayName !== entry.name"
                class="model-id"
                :title="t('admin.configId')"
              >
                {{ entry.name }}
              </code>
            </div>
            <div class="model-sub">
              <code class="model-id">{{ entry.modelName }}</code>
              <el-tooltip :content="entry.baseUrl" placement="top" :disabled="!entry.baseUrl">
                <span class="model-url">{{ entry.baseUrl }}</span>
              </el-tooltip>
              <span class="model-keys">{{ keyStatus(entry) }}</span>
            </div>
            <div class="model-actions">
              <el-button
                link
                type="primary"
                :disabled="props.saving"
                @click="emit('test', model.models[index]!)"
              >
                {{ t("common.testModel") }}
              </el-button>
              <el-button
                link
                type="primary"
                :disabled="props.saving"
                @click="openEditDialog(index)"
              >
                {{ t("common.edit") }}
              </el-button>
              <el-button link type="danger" :disabled="props.saving" @click="removeModel(index)">
                {{ t("common.delete") }}
              </el-button>
            </div>
          </li>
        </ul>
      </template>

      <el-dialog
        v-model="dialogVisible"
        :title="dialogTitle"
        width="min(720px, calc(100vw - 32px))"
        class="model-dialog"
        destroy-on-close
      >
        <h4 class="dialog-section">{{ t("admin.basicConnection") }}</h4>
        <el-form class="model-editor-form" label-width="140px" label-position="left" size="default">
          <el-form-item :label="t('admin.configId')" required>
            <el-input v-model="draft.name" placeholder="default" :disabled="!isNew" />
          </el-form-item>
          <el-form-item :label="t('admin.displayName')" required>
            <el-input v-model="draft.displayName" placeholder="GPT-4o" />
          </el-form-item>
          <el-form-item label="Base URL" required>
            <el-input v-model="draft.baseUrl" placeholder="https://api.openai.com/v1" />
          </el-form-item>
          <el-form-item label="API Key" required>
            <el-input v-model="draft.apiKey" type="password" placeholder="sk-..." show-password />
          </el-form-item>
          <el-form-item :label="t('admin.apiModelId')" required>
            <el-input v-model="draft.modelName" placeholder="gpt-4o" />
          </el-form-item>
          <el-row :gutter="24">
            <el-col :xs="24" :sm="12">
              <el-form-item :label="t('common.timeoutSec')">
                <el-input-number
                  v-model="draft.timeoutSeconds"
                  :min="1"
                  :step="30"
                  controls-position="right"
                />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item :label="t('admin.maxRetries')">
                <el-input-number
                  v-model="draft.maxRetries"
                  :min="0"
                  :step="1"
                  controls-position="right"
                />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item class="context-window-item" :label="t('admin.contextWindow')">
                <el-input-number
                  v-model="draft.contextWindow"
                  :min="1"
                  :step="1000"
                  :precision="0"
                  controls-position="right"
                />
              </el-form-item>
            </el-col>
          </el-row>
          <h4 class="dialog-section">{{ t("admin.advancedSettings") }}</h4>
          <CustomRequestParametersEditor
            v-model:valid="customRequestParametersValid"
            :model-value="customParams"
            @update:model-value="updateCustomParameters"
          />
        </el-form>
        <template #footer>
          <el-button @click="dialogVisible = false">{{ t("common.cancel") }}</el-button>
          <el-button
            type="primary"
            :disabled="!draftComplete || !customRequestParametersValid"
            @click="confirmDialog"
          >
            {{ isNew ? t("admin.addModel") : t("admin.doneEdit") }}
          </el-button>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<style scoped src="./business-config.css"></style>
<style scoped>
.context-window-item :deep(.el-form-item__label) {
  height: auto;
  min-height: 32px;
  line-height: 20px;
  align-items: center;
}
</style>
