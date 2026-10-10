<template>
  <QueryExecutionView v-if="facts" :facts="facts" />
  <div v-else class="question-execution-status">
    {{ failed ? t("common.loadFailed") : t("common.loading") }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { QueryExecutionDisplayFact } from "@ontomato/contracts/query-execution";
import { QueryExecutionView } from "../../query-view";
import type { QueryExecutionFacts } from "../../../types/chat";
import { analysisTaskApi } from "../api";

/** Where a question's full facts live: the task plus a historical report run or a regular-session turn. */
export interface QuestionExecutionScope {
  taskId: string;
  runId?: string;
  requestSeq?: number;
}

const props = defineProps<{
  question: {
    questionId: string;
    execution?: QueryExecutionDisplayFact | QueryExecutionFacts;
    executionDeferred?: true;
  };
  /** Required for deferred questions; inline facts (including legacy history) need none. */
  scope?: QuestionExecutionScope;
}>();

const { t } = useI18n();

// Inline facts render as they are; a deferred question reads its persisted facts once mounted.
const requestKey = computed(() =>
  [props.scope?.taskId, props.scope?.runId, props.scope?.requestSeq, props.question.questionId].join("|")
);
const loaded = ref<{ key: string; facts: QueryExecutionFacts } | null>(null);
const failed = ref(false);

const facts = computed(() =>
  props.question.executionDeferred
    ? loaded.value?.key === requestKey.value
      ? loaded.value.facts
      : null
    : (props.question.execution as QueryExecutionFacts | undefined)
);

watch(
  [requestKey, () => props.question.executionDeferred],
  async () => {
    if (!props.question.executionDeferred || loaded.value?.key === requestKey.value) return;
    // Deferred questions come only from task reads and task-scoped live runs, which bind a scope.
    const scope = props.scope!;
    const key = requestKey.value;
    failed.value = false;
    try {
      const execution = await analysisTaskApi.getQuestionExecution(
        scope.taskId,
        props.question.questionId,
        { runId: scope.runId, requestSeq: scope.requestSeq }
      );
      // A response for a scope the view has already left is discarded.
      if (key === requestKey.value) loaded.value = { key, facts: execution as QueryExecutionFacts };
    } catch {
      if (key === requestKey.value) failed.value = true;
    }
  },
  { immediate: true }
);
</script>

<style scoped>
.question-execution-status {
  padding: 6px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
