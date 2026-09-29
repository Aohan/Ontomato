<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { BarChart3 } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { formatTimeout, parseTimeoutSeconds, type EmbeddingModelConfig } from "../../types";
import { workbenchContent } from "../../../../content";

const { t } = useI18n();
const { businessConfigSeparator } = workbenchContent().text;

const props = defineProps<{
  loading: boolean;
  saving: boolean;
  loadError: string;
}>();

const model = defineModel<EmbeddingModelConfig | null>("model", { required: true });

const emit = defineEmits<{
  save: [];
  test: [];
  retry: [];
}>();

// 加载中或加载失败时既不渲染模型行，也不允许测试/编辑/保存。
const writable = computed(() => !props.loading && !props.loadError);

const dialogVisible = ref(false);

function emptyDraft() {
  return { baseUrl: "", apiKey: "", modelName: "", timeoutSeconds: 300 };
}

const draft = reactive(emptyDraft());

function openEditDialog() {
  if (!writable.value || props.saving) return;
  const current = model.value;
  Object.assign(
    draft,
    current
      ? {
          baseUrl: current.baseUrl,
          apiKey: current.apiKey,
          modelName: current.modelName,
          timeoutSeconds: parseTimeoutSeconds(current.timeout),
        }
      : emptyDraft()
  );
  dialogVisible.value = true;
}

function confirmDialog() {
  // 完整快照：只覆盖弹窗里的4个字段，GET 中未展示的字段（如 customHeaders）原样保留。
  model.value = {
    ...model.value,
    baseUrl: draft.baseUrl,
    apiKey: draft.apiKey,
    modelName: draft.modelName,
    timeout: formatTimeout(draft.timeoutSeconds),
  };
  dialogVisible.value = false;
}
</script>

<template>
  <div class="admin-card config-card">
    <div class="card-header">
      <el-icon :size="20"><BarChart3 /></el-icon>
      <span>{{ t("admin.embeddingModelConfig") }}</span>
    </div>
    <div class="card-body">
      <el-skeleton v-if="props.loading" :rows="2" animated />
      <div v-else-if="props.loadError" class="load-error" role="alert">
        <span>{{ t("admin.modelListLoadFailed") }}{{ businessConfigSeparator }}{{ props.loadError }}</span>
        <el-button size="small" @click="emit('retry')">{{ t("common.retry") }}</el-button>
      </div>
      <template v-else>
        <el-empty v-if="!model" :description="t('admin.modelListEmpty')">
          <el-button type="primary" @click="openEditDialog">{{ t("admin.addModel") }}</el-button>
        </el-empty>
        <ul v-else class="model-list">
          <li class="model-item">
            <div class="model-main">
              <span class="model-name">{{ model.modelName }}</span>
              <code class="model-id">{{ model.baseUrl }}</code>
            </div>
            <div class="model-sub">
              <span class="model-keys">
                {{ model.apiKey ? t("admin.keyCountConfigured", { n: 1 }) : t("admin.keyMissing") }}
              </span>
              <span class="model-keys">
                {{ t("common.timeoutSec") }}{{ businessConfigSeparator }}{{ parseTimeoutSeconds(model.timeout) }}
              </span>
            </div>
            <div class="model-actions">
              <el-button link type="primary" :disabled="props.saving" @click="emit('test')">
                {{ t("common.testModel") }}
              </el-button>
              <el-button link type="primary" :disabled="props.saving" @click="openEditDialog">
                {{ t("common.edit") }}
              </el-button>
            </div>
          </li>
        </ul>
      </template>

      <el-form-item class="form-actions">
        <el-button
          type="primary"
          :loading="props.saving"
          :disabled="!writable || !model"
          @click="emit('save')"
        >
          {{ t("common.save") }}
        </el-button>
      </el-form-item>

      <el-dialog
        v-model="dialogVisible"
        :title="t('admin.embeddingModelConfig')"
        width="min(720px, calc(100vw - 32px))"
        class="model-dialog"
        destroy-on-close
      >
        <el-form class="model-editor-form" label-width="140px" label-position="left" size="default">
          <el-form-item label="Base URL">
            <el-input
              v-model="draft.baseUrl"
              placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
            />
          </el-form-item>
          <el-form-item label="API Key">
            <el-input v-model="draft.apiKey" type="password" placeholder="sk-..." show-password />
          </el-form-item>
          <el-form-item :label="t('admin.modelName')">
            <el-input v-model="draft.modelName" placeholder="text-embedding-v3" />
          </el-form-item>
          <el-form-item :label="t('admin.timeoutSec')">
            <el-input-number
              v-model="draft.timeoutSeconds"
              :min="1"
              :step="10"
              controls-position="right"
            />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="dialogVisible = false">{{ t("common.cancel") }}</el-button>
          <el-button type="primary" @click="confirmDialog">
            {{ t("admin.doneEdit") }}
          </el-button>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<style scoped src="./business-config.css"></style>
