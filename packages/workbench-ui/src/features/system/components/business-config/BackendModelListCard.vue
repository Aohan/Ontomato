<script setup lang="ts">
import { computed, reactive, ref, shallowRef, watch } from "vue";
import { Cpu, Plus, Trash2 } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { JsonObject } from "@ontomato/contracts/system-model";
import { formatTimeout, parseTimeoutSeconds, type BackendModelConfig } from "../../types";
import { plainOuter } from "../../utils/raw";
import CustomRequestParametersEditor from "./CustomRequestParametersEditor.vue";
import { workbenchContent } from "../../../../content";

const { t } = useI18n();
const { businessConfigSeparator } = workbenchContent().text;

const props = defineProps<{
  saving: boolean;
  loading: boolean;
  loadError: string;
}>();

const models = defineModel<BackendModelConfig[]>("models", { required: true });

const emit = defineEmits<{
  save: [];
  test: [model: BackendModelConfig];
  retry: [];
}>();

const dialogVisible = ref(false);
const editingIndex = ref(-1);
const customRequestParametersValid = ref(true);
const savedSignature = ref("");
const modelSignature = () => JSON.stringify(models.value.map((entry) => plainOuter(entry)));
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
// 原条目的完整快照（含隐藏连接字段与未上控件的参数），编辑时展开回写，保证往返保真。
let editingBaseline: BackendModelConfig | null = null;
// 自定义对象不进 reactive：Vue 深层代理会吞掉保留键，用浅引用 holding 原始对象。
const customParams = shallowRef<JsonObject>({});

function updateCustomParameters(value: JsonObject) {
  // 显式写入 ref，避免模板将含 __v_isRef 的普通 JSON 当成新的 ref 绑定。
  customParams.value = value;
}

function emptyDraft(): Omit<BackendModelConfig, "customRequestParameters"> {
  return {
    name: "",
    displayName: "",
    baseUrl: "",
    apiKeys: [],
    modelName: "",
    timeout: "PT300S",
    maxRetries: 3,
    temperature: null,
    topP: null,
    maxTokens: null,
    maxCompletionTokens: null,
  };
}

const draft = reactive(emptyDraft());
// 密钥行按位置渲染；删除后递增使剩余行的密码输入重建，显示状态回到默认隐藏。
const keyRowsVersion = ref(0);

function removeKey(index: number) {
  draft.apiKeys.splice(index, 1);
  keyRowsVersion.value += 1;
}

const isNew = computed(() => editingIndex.value < 0);
const dialogTitle = computed(() => (isNew.value ? t("admin.addModel") : t("admin.editModel")));
// ID、显示名与连接三项（地址、至少一条非空 Key、API 模型标识）必填，与服务端保存规则一致。
const draftComplete = computed(
  () =>
    [draft.name, draft.displayName, draft.baseUrl, draft.modelName].every(
      (value) => !!value.trim()
    ) && draft.apiKeys.some((key) => !!key.trim())
);

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
  const entry = models.value[index];
  if (!entry) return;
  editingIndex.value = index;
  // 只对外层解代理；custom 是不透明 JSON，原样引用，编辑器整件替换、不就地改。
  const raw = plainOuter<BackendModelConfig>(entry);
  editingBaseline = raw;
  Object.assign(draft, {
    name: raw.name,
    displayName: raw.displayName,
    baseUrl: raw.baseUrl,
    apiKeys: [...raw.apiKeys],
    modelName: raw.modelName,
    timeout: raw.timeout,
    maxRetries: raw.maxRetries,
    temperature: raw.temperature ?? null,
    topP: raw.topP ?? null,
    maxTokens: raw.maxTokens ?? null,
    maxCompletionTokens: raw.maxCompletionTokens ?? null,
  });
  customParams.value = raw.customRequestParameters ?? {};
  customRequestParametersValid.value = true;
  dialogVisible.value = true;
}

function confirmDialog() {
  if (!draftComplete.value) return;
  const staged: BackendModelConfig = {
    ...editingBaseline,
    // 配置 ID 是角色引用的身份，已有条目不可改；显示名可随时改，不影响引用。
    name: draft.name.trim(),
    displayName: draft.displayName.trim(),
    baseUrl: draft.baseUrl,
    // 密钥是原值普通数组：删除即删项，保存与测试都按草稿原样提交。
    apiKeys: [...draft.apiKeys],
    modelName: draft.modelName,
    timeout: draft.timeout,
    maxRetries: draft.maxRetries,
    temperature: draft.temperature,
    topP: draft.topP,
    maxTokens: draft.maxTokens,
    maxCompletionTokens: draft.maxCompletionTokens,
    customRequestParameters: customParams.value,
  };
  if (editingIndex.value < 0) {
    models.value.push(staged);
  } else {
    models.value[editingIndex.value] = staged;
  }
  customParams.value = {};
  dialogVisible.value = false;
}

function removeModel(index: number) {
  models.value.splice(index, 1);
}

function markSaved() {
  savedSignature.value = modelSignature();
}

defineExpose({ markSaved });

function keyStatus(entry: BackendModelConfig): string {
  const count = entry.apiKeys.length;
  return count > 0 ? t("admin.keyCountConfigured", { n: count }) : t("admin.keyMissing");
}
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
      <el-empty v-else-if="models.length === 0" :description="t('admin.modelListEmpty')">
        <el-button type="primary" @click="openAddDialog">{{ t("admin.addModel") }}</el-button>
      </el-empty>
      <ul v-else class="model-list">
        <li v-for="(entry, index) in models" :key="entry.name || index" class="model-item">
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
              @click="emit('test', models[index]!)"
            >
              {{ t("common.testModel") }}
            </el-button>
            <el-button link type="primary" :disabled="props.saving" @click="openEditDialog(index)">
              {{ t("common.edit") }}
            </el-button>
            <el-button link type="danger" :disabled="props.saving" @click="removeModel(index)">
              {{ t("common.delete") }}
            </el-button>
          </div>
        </li>
      </ul>

      <el-form-item class="form-actions">
        <el-button
          type="primary"
          :loading="props.saving"
          :disabled="!!props.loadError || props.loading"
          @click="emit('save')"
        >
          {{ t("admin.saveModelList") }}
        </el-button>
      </el-form-item>

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
              <el-form-item :label="t('common.timeoutSec')">
                <el-input-number
                  :model-value="parseTimeoutSeconds(draft.timeout)"
                  :min="1"
                  :step="10"
                  controls-position="right"
                  @update:model-value="draft.timeout = formatTimeout($event ?? 300)"
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
          </el-row>
          <h4 class="dialog-section">{{ t("admin.advancedSettings") }}</h4>
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
              <el-form-item label="maxTokens">
                <el-input-number v-model="draft.maxTokens" controls-position="right" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="maxCompletionTokens">
                <el-input-number v-model="draft.maxCompletionTokens" controls-position="right" />
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
