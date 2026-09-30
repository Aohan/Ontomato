<script setup lang="ts">
import { parseIsoDurationSeconds } from "@ontomato/contracts/model-settings";
import { computed, reactive, ref, shallowRef } from "vue";
import { Cpu, Plus, Trash2 } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { formatTimeout, type ModelEntry } from "../../types";
import CustomRequestParametersEditor from "./CustomRequestParametersEditor.vue";

const { t } = useI18n();

const props = defineProps<{
  disabled: boolean;
}>();

// 条目是普通对象：父页以浅引用持有列表，新增与编辑都整表替换，不就地修改。
const models = defineModel<ModelEntry[]>("models", { required: true });

const emit = defineEmits<{
  remove: [index: number];
  test: [model: ModelEntry];
}>();

const dialogVisible = ref(false);
const editingIndex = ref(-1);
const customRequestParametersValid = ref(true);
// 原条目的完整快照（含未上控件的字段），编辑时展开回写，保证往返保真。
let editingBaseline: ModelEntry | null = null;
// 自定义对象不进 reactive：Vue 深层代理会吞掉保留键，用浅引用持有原始对象。
const customParams = shallowRef<Record<string, unknown>>({});

function updateCustomParameters(value: Record<string, unknown>) {
  // 显式写入 ref，避免模板将含 __v_isRef 的普通 JSON 当成新的 ref 绑定。
  customParams.value = value;
}

// 数值项为 null 表示不设置：maxTokens / contextWindow 由 Java 补默认值，其余不下发。
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
  editingIndex.value = -1;
  editingBaseline = null;
  Object.assign(draft, emptyDraft());
  customParams.value = {};
  customRequestParametersValid.value = true;
  dialogVisible.value = true;
}

function openEditDialog(index: number) {
  const entry = models.value[index]!;
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
    // 超时读取为 ISO-8601 时长（如 PT5M），缺失即空。
    timeoutSeconds: entry.timeout ? parseIsoDurationSeconds(entry.timeout) : null,
    maxRetries: entry.maxRetries ?? null,
    temperature: entry.temperature ?? null,
    topP: entry.topP ?? null,
    maxCompletionTokens: entry.maxCompletionTokens ?? null,
  });
  // custom 是不透明 JSON，原样引用，编辑器整件替换、不就地改。
  customParams.value = entry.customRequestParameters ?? {};
  customRequestParametersValid.value = true;
  dialogVisible.value = true;
}

function confirmDialog() {
  const staged: ModelEntry = {
    ...editingBaseline,
    // 配置 ID 是角色引用的身份，已有条目不可改；显示名可随时改，不影响引用。
    name: draft.name.trim(),
    displayName: draft.displayName.trim(),
    baseUrl: draft.baseUrl,
    // 密钥是原值普通数组：删除即删项，保存与测试都按草稿原样提交。
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
  models.value = isNew.value
    ? [...models.value, staged]
    : models.value.map((entry, index) => (index === editingIndex.value ? staged : entry));
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
        :disabled="props.disabled"
        @click="openAddDialog"
      >
        {{ t("admin.addModel") }}
      </el-button>
    </div>
    <div class="card-body">
      <el-empty v-if="models.length === 0" :description="t('admin.modelListEmpty')">
        <el-button type="primary" :disabled="props.disabled" @click="openAddDialog">
          {{ t("admin.addModel") }}
        </el-button>
      </el-empty>
      <ul v-else class="model-list">
        <li v-for="(entry, index) in models" :key="entry.name" class="model-item">
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
            <el-button link type="primary" :disabled="props.disabled" @click="emit('test', entry)">
              {{ t("common.testModel") }}
            </el-button>
            <el-button
              link
              type="primary"
              :disabled="props.disabled"
              @click="openEditDialog(index)"
            >
              {{ t("common.edit") }}
            </el-button>
            <el-button
              link
              type="danger"
              :disabled="props.disabled"
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
