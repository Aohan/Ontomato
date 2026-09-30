<script setup lang="ts">
import type { SkillInfo, SkillOutput } from "@ontomato/contracts/skills";

import { ref, computed, watch } from "vue";
import { ElMessage } from "element-plus";
import { skillsApi } from "../api";
import { useI18n } from "vue-i18n";
import { withSkillResourceCredentials } from "../utils/skill-resource";
import { workbenchContent } from "../../../content";

const { t } = useI18n();

const visible = defineModel<boolean>("visible");

const props = defineProps<{
  skill: SkillInfo | null;
}>();

const dialogTitle = computed(() => {
  if (!props.skill) return t("admin.debugSkill");
  return t("admin.debugSkillWithName", { name: props.skill.title || props.skill.id });
});

const defaultInputExamples: Record<string, string> = {
  echarts: workbenchContent().skillDebugEchartsInput,
  growth_rate_calc: JSON.stringify(
    {
      data: [
        { month: "2024-01", sales: 10000 },
        { month: "2024-02", sales: 12000 },
        { month: "2024-03", sales: 15000 },
        { month: "2024-04", sales: 13500 },
      ],
      timeField: "month",
      valueField: "sales",
    },
    null,
    2
  ),
};

function getDefaultInput(skillId: string): string {
  const normalizedId = skillId.replace(/-/g, "_");
  if (defaultInputExamples[normalizedId]) {
    return defaultInputExamples[normalizedId];
  }
  return JSON.stringify(
    {
      data: [
        { name: "A", value: 100 },
        { name: "B", value: 200 },
        { name: "C", value: 150 },
      ],
    },
    null,
    2
  );
}

const inputJson = ref("");
const result = ref<SkillOutput | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
const resultTab = ref("output");

watch(
  () => props.skill,
  (skill) => {
    if (skill) {
      inputJson.value = getDefaultInput(skill.id);
    }
  },
  { immediate: true }
);

function formatOutput(output: string | object | undefined): string {
  if (!output) return t("common.noOutput");
  if (typeof output === "object") {
    return JSON.stringify(output, null, 2);
  }
  return output;
}

async function handleExecute() {
  if (!props.skill) return;

  let input: object;
  try {
    input = JSON.parse(inputJson.value);
  } catch {
    ElMessage.warning(t("admin.invalidJson"));
    return;
  }

  loading.value = true;
  error.value = null;
  result.value = null;

  try {
    const data = await skillsApi.debugSkill(props.skill.id, input);
    if (data.success) {
      result.value = data.result;
      resultTab.value = data.result.html ? "html" : "json";
    } else {
      error.value = data.error || t("admin.executeFailed");
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("admin.requestFailed");
  } finally {
    loading.value = false;
  }
}

function handleClose() {
  visible.value = false;
  result.value = null;
  error.value = null;
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="800px"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <div class="debug-container">
      <div class="input-section">
        <div class="section-header">
          <span class="section-title">{{ t("admin.inputParams") }}</span>
        </div>
        <el-input
          v-model="inputJson"
          type="textarea"
          :rows="8"
          :placeholder="t('admin.jsonPlaceholder')"
        />
      </div>

      <div class="output-section">
        <div class="section-header">
          <span class="section-title">{{ t("common.executionResult") }}</span>
          <el-button type="primary" size="small" :loading="loading" @click="handleExecute">
            {{ t("common.execute") }}
          </el-button>
        </div>

        <div v-if="error" class="error-box">
          <el-alert type="error" :closable="false">
            {{ error }}
          </el-alert>
        </div>

        <div v-else-if="result" class="result-box">
          <el-tabs v-model="resultTab">
            <el-tab-pane v-if="result.html" :label="t('admin.htmlPreview')" name="html">
              <iframe
                :srcdoc="withSkillResourceCredentials(result.html)"
                class="html-preview-iframe"
                sandbox="allow-scripts allow-same-origin"
              ></iframe>
            </el-tab-pane>
            <el-tab-pane :label="t('admin.jsonOutput')" name="json">
              <pre class="json-output">{{ formatOutput(result.json) }}</pre>
            </el-tab-pane>
            <el-tab-pane v-if="result.text" :label="t('admin.textOutput')" name="text">
              <pre class="text-output">{{ result.text }}</pre>
            </el-tab-pane>
            <el-tab-pane :label="t('admin.metaInfo')" name="meta">
              <pre class="meta-output">{{ formatOutput(result.meta) }}</pre>
            </el-tab-pane>
          </el-tabs>
        </div>

        <div v-else class="empty-result">
          <span>{{ t("admin.clickExecuteHint") }}</span>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.debug-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.section-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.input-section,
.output-section {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 12px;
}

.error-box {
  margin-top: 8px;
}

.result-box {
  margin-top: 8px;
  min-height: 200px;
}

.empty-result {
  text-align: center;
  padding: 40px;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.html-preview-iframe {
  border: 1px solid var(--el-border-color-lighter);
  width: 100%;
  height: 400px;
  background: var(--el-fill-color-lighter);
}

.json-output,
.text-output,
.meta-output {
  background: var(--el-fill-color-lighter);
  padding: 12px;
  border-radius: 4px;
  font-size: 12px;
  overflow: auto;
  max-height: 400px;
  margin: 0;
}
</style>
