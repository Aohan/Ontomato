<script setup lang="ts">
/**
 * The execution display view for a single query question.
 *
 * The standard query conversation and analysis report tracing share it: the same query question,
 * regardless of which entry it is entered from, shows this same view, in the same order as the 3.1.4
 * standard query — the query process comes first, the answer body and result are in the middle, and
 * QC follows the result. The content is determined by the facts this execution actually produced —
 * produced facts are presented, unproduced facts are not, without preset fixed blocks by entry or
 * query mode.
 *
 * The same answer is shown only once: the body takes the fullContent of the execution facts, and
 * the result is presented only by the tables in the body; the dataset name, row count, data/DSL
 * download, and on-demand-expanded details are provided by the owner of the result entry. Real
 * results with no body table to attach to (no body, body missing a table, or headers not matching)
 * are kept as result entries; historical records with only decomposition, code, and lineage facts
 * but no dataset go into the compact technical detail, deduplicating without losing output and
 * without disguising technical facts as datasets.
 * Turn-level appended analysis and charts are placed by the caller into the body card via the
 * appendix slot (in 3.1.4 they are in the same card, before QC), while clarification, dashboard,
 * and report export are still overlaid by the caller outside.
 * The dashboard entry is offered only when the caller provides dashboard context; a button with no
 * consumer is not rendered.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import MessageContent from "./MessageContent/index.vue";
import ThinkingPanel from "./ThinkingPanel.vue";
import PostThinkingPanel from "./PostThinkingPanel.vue";
import ResultTechnicalFacts from "./ResultTechnicalFacts.vue";
import {
  buildResultDatasets,
  buildTechnicalFacts,
  hasResultDatasets,
} from "../utils/result-datasets";
import { truncateErrorForDisplay } from "../utils/display-error";
import type { QueryExecutionFacts } from "../../../types/chat";

const props = defineProps<{
  /** Execution facts for this query question; the whole block is not rendered when there are no facts */
  facts?: QueryExecutionFacts;
  /** Whether the thinking panel expands by default: expanded when shown directly within a turn, collapsed in tracing */
  expandThinking?: boolean;
  /**
   * Dashboard context: only the standard Q&A entry can provide this turn's thread and request
   * sequence; analysis tracing without that context doesn't offer the dashboard entry, but
   * download and details are unaffected.
   */
  dashboardContext?: { threadId: string; requestSeq: number } | null;
}>();

const emit = defineEmits<{
  addToDashboard: [
    payload: { threadId: string; requestSeq: number; datasetIndex: number; datasetTitle?: string },
  ];
}>();

const { t } = useI18n();

const resultDatasets = computed(() => buildResultDatasets(props.facts, t));

/**
 * Only put existing technical output into the compact detail when there are no result datasets at
 * all: when datasets exist, the code, lineage, and DSL are already provided with the corresponding
 * table, and listing them again would be a duplicate.
 */
const technicalFacts = computed(() =>
  hasResultDatasets(props.facts) ? [] : buildTechnicalFacts(props.facts, t)
);

const hasTechnicalFacts = computed(() => technicalFacts.value.length > 0);

const onAddToDashboard = (payload: { datasetIndex: number; datasetTitle?: string }) => {
  if (!props.dashboardContext) return;
  emit("addToDashboard", { ...props.dashboardContext, ...payload });
};
</script>

<template>
  <div v-if="facts" class="query-execution-view">
    <ThinkingPanel
      v-if="facts.thinkingState || facts.thinkingSummary"
      :content="facts.thinkingState?.summary || facts.thinkingSummary || ''"
      :steps="facts.thinkingSteps"
      :thinking-state="facts.thinkingState"
      :branch-key="facts.winner || 'abc'"
      :default-expanded="expandThinking"
    />

    <div
      v-if="facts.error || facts.fullContent || resultDatasets.length > 0 || hasTechnicalFacts"
      class="execution-body"
    >
      <div v-if="facts.error" class="execution-error">
        {{ truncateErrorForDisplay(facts.error) }}
      </div>
      <MessageContent
        v-if="facts.fullContent || resultDatasets.length > 0"
        :content="facts.fullContent || ''"
        :result-datasets="resultDatasets"
        :show-dashboard-action="!!dashboardContext"
        @add-to-dashboard="onAddToDashboard"
      />
      <ResultTechnicalFacts v-if="hasTechnicalFacts" :facts="technicalFacts" />
      <slot name="appendix" />
    </div>

    <PostThinkingPanel
      v-if="facts.qcState || facts.qcResult"
      :content="facts.qcResult?.conclusion || ''"
      :label="t('thinking.qcResult')"
      :qc-state="facts.qcState"
    />
  </div>
</template>

<style scoped>
.execution-body {
  margin-bottom: 16px;
  padding: 18px 20px;
  border-radius: 18px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  box-shadow: var(--shadow-card);
}
.execution-error {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-color-danger);
}
.execution-error:last-child {
  margin-bottom: 0;
}

@media (max-width: 767px) {
  .execution-body {
    padding: 14px;
  }
}
</style>
