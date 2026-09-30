<script setup lang="ts">
import { parseIsoDurationSeconds } from "@ontomato/contracts/model-settings";
import { computed, reactive, ref, shallowRef } from "vue";
import { Cpu, Plus, Trash2 } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { formatTimeout, type ModelEntry, type SaveAction } from "../../types";
import CustomRequestParametersEditor from "./CustomRequestParametersEditor.vue";

const { t } = useI18n();

const props = defineProps<{
  /** The saved list. Entries are plain objects; adding or editing hands a whole new list to save instead of mutating it. */
  models: ModelEntry[];
  saving: boolean;
  save: SaveAction<ModelEntry[]>;
}>();

const emit = defineEmits<{
  remove: [index: number];
  test: [model: ModelEntry];
}>();

const dialogVisible = ref(false);
const editingIndex = ref(-1);
const customRequestParametersValid = ref(true);
// Complete snapshot of the original entry (including fields without controls), spread back when editing to keep round trips lossless.
let editingBaseline: ModelEntry | null = null;
// Custom objects stay out of reactive: Vue's deep proxy would swallow reserved keys, so a shallow ref holds the raw object.
const customParams = shallowRef<Record<string, unknown>>({});

function updateCustomParameters(value: Record<string, unknown>) {
  // Write the ref explicitly so the template does not treat plain JSON containing __v_isRef as a new ref binding.
  customParams.value = value;
}

// A null number means unset: Java fills maxTokens / contextWindow defaults and the rest are not sent.
function emptyDraft() {
  return {
    name: "",
    displayName: "",
    baseUrl: "",
    apiKeys: [] as string[],
    modelName: "",
    maxTokens: null as number | null,
    contextWindow: null as number | null,
    timeoutSeconds: null as number | null,
    maxRetries: null as number | null,
    temperature: null as number | null,
    topP: null as number | null,
    maxCompletionTokens: null as number | null,
  };
}

const draft = reactive(emptyDraft());
// Key rows render by position; incrementing after a delete rebuilds the remaining password inputs so their visibility resets to hidden.
const keyRowsVersion = ref(0);

function removeKey(index: number) {
  draft.apiKeys.splice(index, 1);
  keyRowsVersion.value += 1;
}

const isNew = computed(() => editingIndex.value < 0);
const dialogTitle = computed(() => (isNew.value ? t("admin.addModel") : t("admin.editModel")));
// ID, display name and the three connection fields (URL, at least one non-empty key, API model id) are required, matching the server's save rules.
const draftComplete = computed(
  () =>
    [draft.name, draft.displayName, draft.baseUrl, draft.modelName].every(
      (value) => !!value.trim()
    ) && draft.apiKeys.some((key) => !!key.trim())
);

function openAddDialog() {
  editingIndex.value = -1;
  editingBaseline = null;
  Object.assign(draft, emptyDraft());
  customParams.value = {};
  customRequestParametersValid.value = true;
  dialogVisible.value = true;
}

function openEditDialog(index: number) {
  const entry = props.models[index]!;
  editingIndex.value = index;
  editingBaseline = entry;
  Object.assign(draft, {
    name: entry.name,
    displayName: entry.displayName,
    baseUrl: entry.baseUrl,
    apiKeys: [...entry.apiKeys],
    modelName: entry.modelName,
    maxTokens: entry.maxTokens,
    contextWindow: entry.contextWindow,
    // The timeout is read as an ISO-8601 duration (e.g. PT5M); missing means empty.
    timeoutSeconds: entry.timeout ? parseIsoDurationSeconds(entry.timeout) : null,
    maxRetries: entry.maxRetries ?? null,
    temperature: entry.temperature ?? null,
    topP: entry.topP ?? null,
    maxCompletionTokens: entry.maxCompletionTokens ?? null,
  });
  // custom is opaque JSON referenced as-is; the editor replaces it whole instead of mutating it.
  customParams.value = entry.customRequestParameters ?? {};
  customRequestParametersValid.value = true;
  dialogVisible.value = true;
}

async function saveDialog() {
  const staged: ModelEntry = {
    ...editingBaseline,
    // The config ID is the identity roles refer to, so existing entries cannot change it; the display name can change at any time without affecting references.
    name: draft.name.trim(),
    displayName: draft.displayName.trim(),
    baseUrl: draft.baseUrl,
    // Keys are a plain array of original values: deleting removes the item and the rest is submitted as-is.
    apiKeys: [...draft.apiKeys],
    modelName: draft.modelName,
    maxTokens: draft.maxTokens,
    contextWindow: draft.contextWindow,
    timeout: draft.timeoutSeconds === null ? null : formatTimeout(draft.timeoutSeconds),
    maxRetries: draft.maxRetries,
    temperature: draft.temperature,
    topP: draft.topP,
    maxCompletionTokens: draft.maxCompletionTokens,
    customRequestParameters: customParams.value,
  };
  const saved = await props.save(
    isNew.value
      ? [...props.models, staged]
      : props.models.map((entry, index) => (index === editingIndex.value ? staged : entry))
  );
  if (!saved) return;
  customParams.value = {};
  dialogVisible.value = false;
}

function keyStatus(entry: ModelEntry): string {
  const count = entry.apiKeys.length;
  return count > 0 ? t("admin.keyCountConfigured", { n: count }) : t("admin.keyMissing");
}
</script>

<template>
  <div class="admin-card config-card">
    <div class="card-header">
      <el-icon :size="20"><Cpu /></el-icon>
      <span>{{ t("admin.modelList") }}</span>
      <el-button
        type="primary"
        :icon="Plus"
        size="small"
        class="header-action"
        :disabled="props.saving"
        @click="openAddDialog"
      >
        {{ t("admin.addModel") }}
      </el-button>
    </div>
    <div class="card-body">
      <el-empty v-if="props.models.length === 0" :description="t('admin.modelListEmpty')">
        <el-button type="primary" :disabled="props.saving" @click="openAddDialog">
          {{ t("admin.addModel") }}
        </el-button>
      </el-empty>
      <ul v-else class="model-list">
        <li v-for="(entry, index) in props.models" :key="entry.name" class="model-item">
          <div class="model-info">
            <span class="model-name">{{ entry.displayName }}</span>
            <code
              v-if="entry.displayName !== entry.name"
              class="model-id"
              :title="t('admin.configId')"
            >
              {{ entry.name }}
            </code>
            <code class="model-id">{{ entry.modelName }}</code>
            <el-tooltip :content="entry.baseUrl" placement="top" :disabled="!entry.baseUrl">
              <span class="model-url">{{ entry.baseUrl }}</span>
            </el-tooltip>
            <span class="model-keys">{{ keyStatus(entry) }}</span>
          </div>
          <div class="model-actions">
            <el-button link type="primary" :disabled="props.saving" @click="emit('test', entry)">
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
            <el-button
              link
              type="danger"
              :disabled="props.saving"
              @click="emit('remove', index)"
            >
              {{ t("common.delete") }}
            </el-button>
          </div>
        </li>
      </ul>

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
            <el-input v-model="draft.name" placeholder="qwen-main" :disabled="!isNew" />
          </el-form-item>
          <el-form-item :label="t('admin.displayName')" required>
            <el-input v-model="draft.displayName" placeholder="Qwen" />
          </el-form-item>
          <el-form-item label="Base URL" required>
            <el-input
              v-model="draft.baseUrl"
              placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
            />
          </el-form-item>
          <el-form-item label="API Keys" required>
            <div class="api-keys-wrap">
              <div
                v-for="(_, idx) in draft.apiKeys"
                :key="`${keyRowsVersion}-${idx}`"
                class="api-key-row"
              >
                <el-input
                  v-model="draft.apiKeys[idx]"
                  type="password"
                  placeholder="sk-..."
                  show-password
                  class="api-key-input"
                />
                <el-button
                  type="danger"
                  :icon="Trash2"
                  circle
                  size="small"
                  :aria-label="t('common.delete')"
                  @click="removeKey(idx)"
                />
              </div>
              <el-button type="primary" link @click="draft.apiKeys.push('')">
                + {{ t("admin.addApiKey") }}
              </el-button>
            </div>
          </el-form-item>
          <el-form-item :label="t('admin.apiModelId')" required>
            <el-input v-model="draft.modelName" placeholder="deepseek-v3" />
          </el-form-item>
          <el-row :gutter="24">
            <el-col :xs="24" :sm="12">
              <el-form-item label="maxTokens">
                <el-input-number
                  v-model="draft.maxTokens"
                  :min="1"
                  :precision="0"
                  :placeholder="t('admin.defaultWhenEmpty')"
                  controls-position="right"
                />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item :label="t('admin.contextWindow')">
                <el-input-number
                  v-model="draft.contextWindow"
                  :min="1"
                  :precision="0"
                  :placeholder="t('admin.defaultWhenEmpty')"
                  controls-position="right"
                />
              </el-form-item>
            </el-col>
          </el-row>
          <h4 class="dialog-section">{{ t("admin.advancedSettings") }}</h4>
          <el-row :gutter="24">
            <el-col :xs="24" :sm="12">
              <el-form-item :label="t('common.timeoutSec')">
                <el-input-number
                  v-model="draft.timeoutSeconds"
                  :min="1"
                  :precision="0"
                  :step="10"
                  controls-position="right"
                />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item :label="t('admin.maxRetries')">
                <el-input-number
                  v-model="draft.maxRetries"
                  :min="0"
                  :precision="0"
                  controls-position="right"
                />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="24">
            <el-col :xs="24" :sm="12">
              <el-form-item label="temperature">
                <el-input-number v-model="draft.temperature" controls-position="right" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="topP">
                <el-input-number v-model="draft.topP" controls-position="right" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="24">
            <el-col :xs="24" :sm="12">
              <el-form-item label="maxCompletionTokens">
                <el-input-number
                  v-model="draft.maxCompletionTokens"
                  :min="1"
                  :precision="0"
                  controls-position="right"
                />
              </el-form-item>
            </el-col>
          </el-row>
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
            :loading="props.saving"
            :disabled="!draftComplete || !customRequestParametersValid"
            @click="saveDialog"
          >
            {{ t("common.save") }}
          </el-button>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<style scoped src="./business-config.css"></style>
