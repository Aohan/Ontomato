<script setup lang="ts">
import { Cog } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { GeneralConfigKey, SystemSettings } from "../../types";
import type { BusinessConfigLanguageOption } from "../../business-config";

const { t } = useI18n();

defineProps<{
  saving: Record<string, boolean>;
  disabled: boolean;
  languageOptions: readonly BusinessConfigLanguageOption[];
  defaultLanguage: string;
}>();

const config = defineModel<SystemSettings>("config", { required: true });

const emit = defineEmits<{
  save: [key: GeneralConfigKey];
}>();
</script>

<template>
  <div class="admin-card config-card">
    <div class="card-header">
      <el-icon :size="20"><Cog /></el-icon>
      <span>{{ t("admin.generalParamConfig") }}</span>
    </div>
    <div class="card-body">
      <el-form
        class="config-form"
        :disabled="disabled"
        label-width="220px"
        label-position="left"
        size="default"
      >
        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item :label="t('admin.knowledgeMaxResults')">
              <div class="inline-control">
                <el-input-number
                  v-model="config.knowledgeMaxResult"
                  :min="1"
                  :step="1"
                  controls-position="right"
                />
                <el-button
                  type="primary"
                  size="small"
                  :loading="saving.knowledgeMaxResult"
                  :disabled="disabled"
                  @click="emit('save', 'knowledgeMaxResult')"
                >
                  {{ t("common.save") }}
                </el-button>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="t('admin.postCalcRetries')">
              <div class="inline-control">
                <el-input-number
                  v-model="config.toolAndPythonRetry"
                  :min="0"
                  :step="1"
                  controls-position="right"
                />
                <el-button
                  type="primary"
                  size="small"
                  :loading="saving.toolAndPythonRetry"
                  :disabled="disabled"
                  @click="emit('save', 'toolAndPythonRetry')"
                >
                  {{ t("common.save") }}
                </el-button>
              </div>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item :label="t('admin.dslCookerTries')">
              <div class="inline-control">
                <el-input-number
                  v-model="config.dslCookerTries"
                  :min="1"
                  :step="1"
                  controls-position="right"
                />
                <el-button
                  type="primary"
                  size="small"
                  :loading="saving.dslCookerTries"
                  :disabled="disabled"
                  @click="emit('save', 'dslCookerTries')"
                >
                  {{ t("common.save") }}
                </el-button>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="t('admin.dslCookerTimeout')">
              <div class="inline-control">
                <el-input-number
                  v-model="config.dslCookerTimeout"
                  :min="1000"
                  :step="10000"
                  controls-position="right"
                />
                <el-button
                  type="primary"
                  size="small"
                  :loading="saving.dslCookerTimeout"
                  :disabled="disabled"
                  @click="emit('save', 'dslCookerTimeout')"
                >
                  {{ t("common.save") }}
                </el-button>
              </div>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item :label="t('admin.questionSpliterTries')">
              <div class="inline-control">
                <el-input-number
                  v-model="config.questionSpliterTries"
                  :min="1"
                  :step="1"
                  controls-position="right"
                />
                <el-button
                  type="primary"
                  size="small"
                  :loading="saving.questionSpliterTries"
                  :disabled="disabled"
                  @click="emit('save', 'questionSpliterTries')"
                >
                  {{ t("common.save") }}
                </el-button>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="t('admin.questionSpliterTimeout')">
              <div class="inline-control">
                <el-input-number
                  v-model="config.questionSpliterTimeout"
                  :min="1000"
                  :step="10000"
                  controls-position="right"
                />
                <el-button
                  type="primary"
                  size="small"
                  :loading="saving.questionSpliterTimeout"
                  :disabled="disabled"
                  @click="emit('save', 'questionSpliterTimeout')"
                >
                  {{ t("common.save") }}
                </el-button>
              </div>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item :label="t('admin.backendLanguage')">
              <div class="inline-control">
                <el-select v-model="config.lang" :placeholder="defaultLanguage" style="width: 160px">
                  <el-option
                    v-for="option in languageOptions"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>
                <el-button
                  type="primary"
                  size="small"
                  :loading="saving.lang"
                  :disabled="disabled"
                  @click="emit('save', 'lang')"
                >
                  {{ t("common.save") }}
                </el-button>
              </div>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
    </div>
  </div>
</template>

<style scoped src="./business-config.css"></style>
