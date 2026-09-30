<template>
  <el-drawer v-model="open" size="520px" :with-header="false" body-class="ai-insight-drawer">
    <div class="ai-drawer">
      <!-- header (sticky) -->
      <div class="ai-head">
        <div class="ai-head-top">
          <div class="ai-title" :title="chart?.title || ''">
            <el-icon class="ai-title-icon"><Sparkles /></el-icon>
            <span class="ai-title-text">
              {{ t("analysis.aiInterpretation") }} · {{ chart?.title || "" }}
            </span>
          </div>
        </div>

        <div class="ai-sub">
          <span>
            {{ t("analysis.dataVolume") }}{{ detailSeparator }}{{ (chart?.rows || []).length }}
            {{ t("analysis.rowUnit") }}
          </span>
        </div>
      </div>

      <!-- body -->
      <div ref="bodyRef" class="ai-body">
        <!-- error -->
        <el-alert
          v-if="error"
          type="error"
          :title="error"
          :closable="false"
          show-icon
          class="ai-alert"
        />

        <!-- skeleton -->
        <div v-if="loading" class="ai-skeleton">
          <el-skeleton animated :rows="10" />
        </div>

        <!-- result -->
        <template v-else-if="result">
          <div class="ai-card">
            <div class="ai-card-title">{{ t("analysis.keyConclusions") }}</div>
            <ul class="ai-list">
              <li v-for="(item, i) in result.summary" :key="i">{{ item }}</li>
            </ul>
          </div>

          <div v-if="result.insights?.length" class="ai-card">
            <div class="ai-card-title">{{ t("analysis.chartInterpretation") }}</div>

            <div v-for="(ins, i) in result.insights" :key="i" class="ai-insight">
              <div class="ai-insight-title">{{ ins.title }}</div>
              <div class="ai-insight-detail">{{ ins.detail }}</div>
            </div>
          </div>

          <div v-if="result.anomalies?.length" class="ai-card">
            <div class="ai-card-title">{{ t("analysis.anomalies") }}</div>
            <ul class="ai-list">
              <li v-for="(item, i) in result.anomalies" :key="i">{{ item }}</li>
            </ul>
          </div>

          <div v-if="result.suggestions?.length" class="ai-card">
            <div class="ai-card-title">{{ t("analysis.actionSuggestions") }}</div>
            <ul class="ai-list">
              <li v-for="(item, i) in result.suggestions" :key="i">{{ item }}</li>
            </ul>
          </div>
        </template>
      </div>

      <!-- Input box fixed at the bottom -->
      <div class="ai-ask-fixed">
        <div class="ai-ask-inner">
          <el-input
            v-model="ask"
            type="textarea"
            :placeholder="t('analysis.chartInterpretExample')"
            :rows="2"
          />
          <div class="ai-ask-actions">
            <el-button
              size="small"
              type="primary"
              :disabled="!ask.trim()"
              :loading="loading"
              @click="run(ask)"
            >
              {{ t("analysis.ask") }}
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </el-drawer>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";

import { Sparkles } from "lucide-vue-next";
import { buildTableProfile, stableJsonStringify, hashString } from "./utils/chartAiProfile";
import { analyzeChart } from "../api";
import { useI18n } from "vue-i18n";
import { errorPunctuation } from "../../../utils/error-punctuation";

const { detailSeparator } = errorPunctuation();

const { t } = useI18n();

const props = defineProps({
  modelValue: Boolean,
  chart: { type: Object, default: null },
});
const emit = defineEmits(["update:modelValue"]);

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});

// Watch chart switches: clear old analysis results when the chart changes
watch(
  () => [props.chart?.id, props.chart?.title],
  () => {
    resetUiState();
    if (!props.modelValue) return;
    nextTick(() => run(defaultAsk.value));
  }
);

watch(
  () => props.modelValue,
  (v) => {
    if (!v) return;
    if (!props.chart) return;
    if (loading.value) return;
    if (result.value) return;
    nextTick(() => run(defaultAsk.value));
  }
);

const bodyRef = ref(null);
const loading = ref(false);
const error = ref("");
const result = ref(null);
const ask = ref("");

const defaultAsk = computed(() => t("analysis.chartInterpretHint"));

const cache = new Map();

function scrollBodyToTop() {
  const el = bodyRef.value;
  if (!el) return;
  el.scrollTo?.({ top: 0 });
  if (typeof el.scrollTop === "number") el.scrollTop = 0;
}

function resetUiState() {
  loading.value = false;
  error.value = "";
  result.value = null;
  ask.value = "";
  nextTick(scrollBodyToTop);
}

function buildPayload(userAsk) {
  const tableProfile = buildTableProfile(props.chart?.rows || [], {
    maxProfileRows: 100,
  });

  return {
    chart: {
      title: props.chart?.title,
      type: props.chart?.chartType,
      chartId: props.chart?.id,
      source: props.chart?.source,
      dsl: props.chart?.dsl,
    },
    userAsk,
    tableProfile,
    rows: props.chart?.rows || [],
  };
}

async function run(userAsk) {
  const q = String(userAsk || "").trim();
  if (!q) return;

  if (q === ask.value.trim()) {
    ask.value = "";
  }

  if (!props.chart?.rows?.length) {
    error.value = t("analysis.noDataToAnalyze");
    return;
  }

  loading.value = true;
  error.value = "";
  result.value = null;

  const payload = buildPayload(userAsk);
  const key = hashString(stableJsonStringify(payload));

  if (cache.has(key)) {
    result.value = cache.get(key);
    loading.value = false;
    return;
  }

  try {
    const resp = await analyzeChart(payload);
    const data = resp?.data || resp;

    result.value = {
      summary: Array.isArray(data.summary) ? data.summary : [],
      insights: Array.isArray(data.insights) ? data.insights : [],
      anomalies: Array.isArray(data.anomalies) ? data.anomalies : [],
      suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
    };

    cache.set(key, result.value);
  } catch (e) {
    error.value = e?.message || t("analysis.generationFailed");
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.ai-drawer {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color-page);
}

/* Header: sticky + clear hierarchy */
.ai-head {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 16px 20px;
  background: color-mix(in srgb, var(--el-bg-color) 92%, transparent);
  backdrop-filter: saturate(180%) blur(10px);
  border-bottom: 1px solid var(--el-border-color-light);
}

.ai-head-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ai-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ai-title-icon {
  font-size: 16px;
  opacity: 0.9;
}

.ai-title-text {
  font-size: 14px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-sub {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.ai-sub-split {
  margin: 0 6px;
}

/* body: scroll area */
.ai-body {
  flex: 1;
  overflow: auto;
  padding: 14px;
}

/* alert / skeleton */
.ai-alert {
  margin-bottom: 12px;
}
.ai-skeleton {
  padding: 6px 2px;
}

/* card: unified card styles */
.ai-card {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 14px;
  padding: 12px 12px;
  margin-bottom: 12px;
  box-shadow: var(--shadow-card);
}

.ai-card:last-child {
  margin-bottom: 0;
}

.ai-card-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  margin-bottom: 10px;
}

/* List styles */
.ai-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 20px;
}
.ai-list li {
  margin: 6px 0;
}

/* Insight separator */
.ai-insight {
  padding: 10px 0;
  border-top: 1px dashed var(--el-border-color-light);
}
.ai-insight:first-of-type {
  padding-top: 0;
  border-top: none;
}
.ai-insight-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}
.ai-insight-detail {
  margin-top: 6px;
  font-size: 13px;
  line-height: 20px;
  color: var(--el-text-color-regular);
}

/* Empty state */
.ai-empty {
  background: var(--el-bg-color);
  border: 1px dashed var(--el-border-color);
  border-radius: 14px;
  padding: 14px;
  margin-bottom: 12px;
}
.ai-empty-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}
.ai-empty-sub {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* Question box */
.ai-ask-fixed {
  position: sticky;
  bottom: 0;
  z-index: 3;

  background: color-mix(in srgb, var(--el-bg-color) 95%, transparent);
  backdrop-filter: saturate(180%) blur(8px);

  border-top: 1px solid var(--el-border-color);
  box-shadow: 0 -6px 16px rgba(0, 0, 0, 0.04);
}

.ai-ask-inner {
  padding: 14px 16px;
}

.ai-ask-actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}

.el-button + .el-button {
  margin-left: 0;
}
</style>

<style>
.ai-insight-drawer {
  padding: 0;
}
</style>
