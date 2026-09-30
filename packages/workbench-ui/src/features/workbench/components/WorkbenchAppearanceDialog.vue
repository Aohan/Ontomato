<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import type {
  AppearanceSection,
  WorkbenchAppearance,
} from "@ontomato/contracts/workbench-appearance";
import { getWorkbenchAppearance, saveWorkbenchAppearance } from "../api";
import AgentBasicInfoFields from "./AgentBasicInfoFields.vue";
import { workbenchContent } from "../../../content";

const { serviceDisplayName } = workbenchContent();

const props = defineProps<{ section: AppearanceSection; defaultLogo: string }>();
const emit = defineEmits<{ close: []; saved: [value: WorkbenchAppearance] }>();
const { t } = useI18n();
const draft = ref<WorkbenchAppearance | null>(null);
const loading = ref(true);
const saving = ref(false);
const imageLoading = ref(false);
const failed = ref(false);
const title = computed(() => t(`appearance.${props.section}`));
let active = true;
let imageSelection = 0;
onUnmounted(() => {
  active = false;
  imageSelection++;
});

function showError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  ElMessage.error(message.startsWith("appearance.") ? t(message) : message);
}

async function load() {
  loading.value = true;
  failed.value = false;
  try {
    const value = await getWorkbenchAppearance();
    if (active) draft.value = value;
  } catch (error) {
    if (active) {
      failed.value = true;
      showError(error, t("appearance.loadFailed"));
    }
  } finally {
    if (active) loading.value = false;
  }
}
onMounted(load);

function reset() {
  if (!draft.value) return;
  imageSelection++;
  imageLoading.value = false;
  if (props.section === "brand") draft.value.brand = { name: "", subtitle: "", logo: "" };
  else if (props.section === "qa")
    draft.value.qa = { name: "", description: "", avatarKey: "", avatarColor: "" };
  else draft.value.addAgentLabel = "";
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !draft.value) return;
  const selection = ++imageSelection;
  imageLoading.value = true;
  try {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 1024 * 1024) {
      throw new Error(t("appearance.imageHint"));
    }
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width !== bitmap.height) throw new Error(t("appearance.imageHint"));
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      const context = canvas.getContext("2d");
      if (!context) throw new Error(t("appearance.imageFailed"));
      context.drawImage(bitmap, 0, 0, 128, 128);
      if (active && selection === imageSelection)
        draft.value.brand.logo = canvas.toDataURL("image/png");
    } finally {
      bitmap.close();
    }
  } catch (error) {
    if (active && selection === imageSelection) showError(error, t("appearance.imageFailed"));
  } finally {
    if (active && selection === imageSelection) imageLoading.value = false;
  }
}

async function save() {
  if (!draft.value || saving.value || imageLoading.value) return;
  saving.value = true;
  try {
    const saved = await saveWorkbenchAppearance(draft.value);
    if (active) {
      emit("saved", saved);
      ElMessage.success(t("appearance.saved"));
    }
  } catch (error) {
    if (active) showError(error, t("appearance.saveFailed"));
  } finally {
    if (active) saving.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="true"
    :title="title"
    width="min(520px, calc(100vw - 24px))"
    align-center
    :close-on-click-modal="false"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @update:model-value="emit('close')"
  >
    <div v-loading="loading">
      <el-button v-if="failed" @click="load">{{ t("common.retry") }}</el-button>
      <el-form v-if="draft" label-position="top" :disabled="saving" @submit.prevent="save">
        <fieldset :disabled="saving">
          <p class="appearance-hint">{{ t("appearance.defaultHint") }}</p>
          <template v-if="section === 'brand'">
            <div class="brand-preview">
              <img :src="draft.brand.logo || defaultLogo" alt="Logo" />
              <div>
                <strong>{{ draft.brand.name.trim() || serviceDisplayName }}</strong>
                <small>{{ draft.brand.subtitle.trim() || t("app.subtitle") }}</small>
              </div>
            </div>
            <el-form-item label="Logo">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                :aria-label="t('appearance.uploadLogo')"
                :disabled="saving || imageLoading"
                @change="upload"
              />
              <p class="appearance-hint">{{ t("appearance.imageHint") }}</p>
              <el-button
                :disabled="saving"
                text
                @click="
                  imageSelection++;
                  imageLoading = false;
                  draft.brand.logo = '';
                "
              >
                {{ t("appearance.defaultLogo") }}
              </el-button>
            </el-form-item>
            <el-form-item :label="t('common.name')">
              <el-input v-model="draft.brand.name" maxlength="40" :placeholder="serviceDisplayName" />
            </el-form-item>
            <el-form-item :label="t('appearance.subtitle')">
              <el-input
                v-model="draft.brand.subtitle"
                maxlength="120"
                :placeholder="t('app.subtitle')"
              />
            </el-form-item>
          </template>
          <AgentBasicInfoFields
            v-else-if="section === 'qa'"
            v-model:name="draft.qa.name"
            v-model:description="draft.qa.description"
            v-model:avatar-key="draft.qa.avatarKey"
            v-model:avatar-color="draft.qa.avatarColor"
            :name-required="false"
            :name-maxlength="40"
            :description-maxlength="120"
            :name-placeholder="t('chat.queryAgent')"
            :description-placeholder="t('chat.queryAgentDesc')"
            default-avatar-key="MessageSquare"
          />
          <el-form-item v-else :label="t('appearance.buttonText')">
            <el-input
              v-model="draft.addAgentLabel"
              maxlength="40"
              :placeholder="t('analysis.addAgent')"
              autofocus
            />
          </el-form-item>
        </fieldset>
      </el-form>
    </div>
    <template #footer>
      <div class="appearance-footer">
        <el-button :disabled="!draft || saving" @click="reset">
          {{ t("appearance.reset") }}
        </el-button>
        <span />
        <el-button :disabled="saving" @click="emit('close')">{{ t("common.cancel") }}</el-button>
        <el-button
          type="primary"
          :loading="saving"
          :disabled="!draft || loading || imageLoading"
          @click="save"
        >
          {{ t("common.save") }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.appearance-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  width: 100%;
}
.brand-preview {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
}
.brand-preview img {
  width: 38px;
  height: 38px;
  object-fit: contain;
}
.brand-preview div {
  min-width: 0;
}
.brand-preview strong,
.brand-preview small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.brand-preview small {
  color: var(--el-text-color-secondary);
}
.appearance-footer {
  display: flex;
  gap: 8px;
}
.appearance-footer span {
  flex: 1;
}
</style>
