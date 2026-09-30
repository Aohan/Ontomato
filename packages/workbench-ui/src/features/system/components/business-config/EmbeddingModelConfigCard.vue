<script setup lang="ts">
import { parseIsoDurationSeconds } from "@ontomato/contracts/model-settings";
import { computed, reactive, ref } from "vue";
import { BarChart3 } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { formatTimeout, type EmbeddingModelConfig, type SaveAction } from "../../types";
import { workbenchContent } from "../../../../content";

const { t } = useI18n();
const { businessConfigSeparator } = workbenchContent().text;

const props = defineProps<{
  /** The saved Embedding model, or null when none is configured. */
  model: EmbeddingModelConfig | null;
  loading: boolean;
  saving: boolean;
  loadError: string;
  save: SaveAction<EmbeddingModelConfig>;
}>();

const emit = defineEmits<{
  test: [];
  retry: [];
}>();

// While loading or after a failed load, no model row is rendered and test/edit are not allowed.
const writable = computed(() => !props.loading && !props.loadError);

const dialogVisible = ref(false);

function emptyDraft() {
  return { baseUrl: "", apiKey: "", modelName: "", timeoutSeconds: 300 };
}

const draft = reactive(emptyDraft());

function openEditDialog() {
  if (!writable.value || props.saving) return;
  const current = props.model;
  Object.assign(
    draft,
    current
      ? {
          baseUrl: current.baseUrl,
          apiKey: current.apiKey,
          modelName: current.modelName,
          timeoutSeconds: parseIsoDurationSeconds(current.timeout),
        }
      : emptyDraft()
  );
  dialogVisible.value = true;
}

async function saveDialog() {
  // Complete snapshot: only the 4 fields in the dialog are overwritten; fields from GET that are not shown (such as customHeaders) are kept as-is.
  const saved = await props.save({
    ...props.model,
    baseUrl: draft.baseUrl,
    apiKey: draft.apiKey,
    modelName: draft.modelName,
    timeout: formatTimeout(draft.timeoutSeconds),
  });
  if (saved) dialogVisible.value = false;
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
        <el-empty v-if="!props.model" :description="t('admin.modelListEmpty')">
          <el-button type="primary" @click="openEditDialog">{{ t("admin.addModel") }}</el-button>
        </el-empty>
        <ul v-else class="model-list">
          <li class="model-item">
            <div class="model-info">
              <span class="model-name">{{ props.model.modelName }}</span>
              <el-tooltip :content="props.model.baseUrl" placement="top" :disabled="!props.model.baseUrl">
                <span class="model-url">{{ props.model.baseUrl }}</span>
              </el-tooltip>
              <span class="model-keys">
                {{ props.model.apiKey ? t("admin.keyCountConfigured", { n: 1 }) : t("admin.keyMissing") }}
              </span>
              <span class="model-keys">
                {{ t("common.timeoutSec") }}{{ businessConfigSeparator }}{{ parseIsoDurationSeconds(props.model.timeout) }}
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
          <el-button type="primary" :loading="props.saving" @click="saveDialog">
            {{ t("common.save") }}
          </el-button>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<style scoped src="./business-config.css"></style>
