<script setup lang="ts">
/**
 * Compact detail of existing technical output with no dataset to attach to.
 *
 * Historical records may have only saved two-level decomposition and code/lineage facts without a
 * structured dataset; these already-produced technical details are expanded on demand here, without
 * rebuilding the large decomposition-list cards and without disguising them as datasets.
 */
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { ChevronDown, ChevronRight, Copy, FileText, List } from "lucide-vue-next";
import ResultDetailDialogs from "./MessageContent/ResultDetailDialogs.vue";
import type { ResultDetailRequest, ResultTechnicalFact } from "./MessageContent/types";

defineProps<{ facts: ResultTechnicalFact[] }>();

const { t } = useI18n();

const expanded = ref(false);
const detailRequest = ref<ResultDetailRequest | null>(null);

function openDetail(fact: ResultTechnicalFact, kind: ResultDetailRequest["kind"]) {
  detailRequest.value = {
    kind,
    title: fact.title,
    dsl: fact.dsl,
    code: fact.code,
    outKeyRefs: fact.outKeyRefs,
  };
}
</script>

<template>
  <div class="result-technical">
    <button
      type="button"
      class="ui-btn ui-btn-secondary result-technical-toggle"
      @click="expanded = !expanded"
    >
      <component :is="expanded ? ChevronDown : ChevronRight" :size="14" />
      <span>{{ expanded ? t("common.collapse") : t("common.detail") }}</span>
    </button>
    <div v-if="expanded" class="result-technical-list">
      <div v-for="fact in facts" :key="fact.key" class="result-technical-item">
        <span class="result-technical-title">{{ fact.title }}</span>
        <button
          v-if="fact.dsl"
          type="button"
          class="ui-btn ui-btn-secondary result-technical-btn"
          @click="openDetail(fact, 'dsl')"
        >
          <FileText :size="14" />
          <span>{{ t("common.viewDsl") }}</span>
        </button>
        <button
          v-if="fact.code"
          type="button"
          class="ui-btn ui-btn-secondary result-technical-btn"
          @click="openDetail(fact, 'code')"
        >
          <Copy :size="14" />
          <span>{{ t("common.code") }}</span>
        </button>
        <button
          v-if="(fact.outKeyRefs?.length || 0) > 0"
          type="button"
          class="ui-btn ui-btn-secondary result-technical-btn"
          @click="openDetail(fact, 'lineage')"
        >
          <List :size="14" />
          <span>{{ t("common.lineage") }}</span>
        </button>
      </div>
    </div>

    <ResultDetailDialogs :request="detailRequest" @close="detailRequest = null" />
  </div>
</template>

<style scoped>
.result-technical {
  margin-top: 12px;
}
.result-technical-toggle,
.result-technical-btn {
  font-size: 12px;
}
.result-technical-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-lg);
  background: var(--el-fill-color-extra-light);
  border: 1px solid var(--el-border-color-lighter);
}
.result-technical-item {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
}
.result-technical-title {
  color: var(--el-text-color-regular);
  word-break: break-word;
}
</style>
