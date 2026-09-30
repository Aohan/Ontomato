<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import { FileJson, LayoutDashboard } from "lucide-vue-next";
import {
  MessageContent,
  QueryExecutionView,
  hasResultDatasets,
  hasTechnicalFacts,
  truncateErrorForDisplay,
} from "../../query-view";
import { DeepAnalysisResult } from "../../analysis";
import type { ClarificationOption } from "@ontomato/contracts/chat";
import type { ResponseSnapshot } from "../../../types/chat";
import { analysisReportApi } from "../../analysis";
import {
  buildReportSectionsFromDeepAnalysis,
  joinReportSections,
} from "../../../utils/analysis-report";
import { workbenchContent } from "../../../content";

const props = defineProps<{
  snapshot: ResponseSnapshot;
  archived?: boolean;
  creatingDashboardKey?: string;
}>();

const emit = defineEmits<{
  clarificationSelect: [option: ClarificationOption];
  addToDashboard: [
    payload: { threadId: string; requestSeq: number; datasetIndex: number; datasetTitle?: string },
  ];
  createDashboard: [payload: { threadId: string; requestSeq: number; name?: string }];
}>();

const { t } = useI18n();

const reportSections = computed(() =>
  props.snapshot.deepAnalysis
    ? buildReportSectionsFromDeepAnalysis(props.snapshot.deepAnalysis)
    : []
);
const hasDeepAnalysisVisualBlocks = computed(() =>
  reportSections.value.some((section) => !!section.content.trim())
);

const shouldShowPrimaryText = computed(
  () =>
    !!props.snapshot.primaryText &&
    (props.snapshot.mode !== "standard" || !props.snapshot.execution?.fullContent)
);

/** The error page's body is the error description itself, truncated for display; the snapshot still keeps the full original text. */
const primaryTextForDisplay = computed(() =>
  props.snapshot.mode === "error"
    ? truncateErrorForDisplay(props.snapshot.primaryText)
    : props.snapshot.primaryText
);

/** Result facts the execution view renders itself: result datasets or a decomposition detail with only technical output. */
const hasExecutionResultFacts = computed(() => {
  const execution = props.snapshot.execution;
  if (!execution) return false;
  return hasResultDatasets(execution) || hasTechnicalFacts(execution, t);
});

/**
 * Whether the execution view's body card renders: a failure description, a body, or result
 * facts render it as long as one is present. Once it owns a body, the appended analysis and
 * charts must go into its appendix instead of starting a separate card.
 */
const hasExecutionBody = computed(
  () =>
    props.snapshot.mode === "standard" &&
    !!props.snapshot.execution &&
    !!(
      props.snapshot.execution.error ||
      props.snapshot.execution.fullContent ||
      hasExecutionResultFacts.value
    )
);

/** Dashboard context: only provide the table's dashboard entry when this turn's thread and request sequence are both present. */
const dashboardContext = computed(() => {
  if (!props.snapshot.threadId || typeof props.snapshot.requestSeq !== "number") return null;
  return { threadId: props.snapshot.threadId, requestSeq: props.snapshot.requestSeq };
});

const shouldShowStandardPending = computed(() => {
  if (props.snapshot.mode !== "standard") return false;
  if (!props.snapshot.showPendingUnderstanding) return false;
  return (
    !props.snapshot.execution &&
    !props.snapshot.primaryText &&
    !props.snapshot.analysisText &&
    !props.snapshot.visualizationLoading &&
    !props.snapshot.visualizationHTML &&
    (props.snapshot.executionSteps?.length || 0) === 0
  );
});

const shouldShowDeepAnalysisPending = computed(
  () =>
    props.snapshot.deepAnalysis?.runState.status === "running" &&
    !props.snapshot.deepAnalysis.activities.length &&
    !hasDeepAnalysisVisualBlocks.value
);
const isDeepAnalysisComplete = computed(
  () => props.snapshot.deepAnalysis?.runState.status === "completed"
);

const canExportDeepAnalysisPdf = computed(
  () => isDeepAnalysisComplete.value && Boolean(getDeepAnalysisReportMarkdown())
);

const getStandardReportMarkdown = () => {
  const sections = [props.snapshot.primaryText, props.snapshot.analysisText]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return sections.join("\n\n---\n\n");
};

const canExportStandardAnalysisPdf = computed(() =>
  Boolean(String(props.snapshot.analysisText || "").trim())
);

const canCreateDashboard = computed(
  () =>
    isDeepAnalysisComplete.value &&
    Boolean(props.snapshot.threadId && typeof props.snapshot.requestSeq === "number")
);

const getDashboardRequestKey = () => {
  if (!props.snapshot.threadId || typeof props.snapshot.requestSeq !== "number") return "";
  return `${props.snapshot.threadId}:${props.snapshot.requestSeq}`;
};

const isCreatingDashboard = computed(() => {
  const key = getDashboardRequestKey();
  return Boolean(key && props.creatingDashboardKey === key);
});

const exportLoadingMode = ref<"standard" | "deep-analysis" | null>(null);
const isExportingStandardPdf = computed(() => exportLoadingMode.value === "standard");
const isExportingDeepAnalysisPdf = computed(() => exportLoadingMode.value === "deep-analysis");

const padDatePart = (value: number) => String(value).padStart(2, "0");

const buildReportExportFileName = (date = new Date()) => {
  const timestamp = [
    `${date.getFullYear()}${padDatePart(date.getMonth() + 1)}${padDatePart(date.getDate())}`,
    `${padDatePart(date.getHours())}${padDatePart(date.getMinutes())}${padDatePart(date.getSeconds())}`,
  ].join("_");

  return `${workbenchContent().reportPdfFilePrefix}${timestamp}.pdf`;
};

const getDeepAnalysisReportMarkdown = () => joinReportSections(reportSections.value);

const exportPdfFile = async (markdown: string, mode: "standard" | "deep-analysis") => {
  const content = String(markdown || "").trim();
  if (!content) {
    ElMessage.warning(t("analysis.noAnalysisReportExport"));
    return;
  }

  try {
    exportLoadingMode.value = mode;
    const blob = await analysisReportApi.exportPdf({
      markdown: content,
      renderInlineCharts: true,
    });
    const objectUrl = URL.createObjectURL(blob);
    const fileName = buildReportExportFileName();

    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    ElMessage.success(t("analysis.pdfExportDone"));
  } catch (error: any) {
    ElMessage.error(error?.message || t("analysis.pdfExportFailed"));
  } finally {
    exportLoadingMode.value = null;
  }
};

const exportStandardPdf = () => {
  const markdown = getStandardReportMarkdown();
  if (isExportingStandardPdf.value) return;
  exportPdfFile(markdown, "standard");
};

const exportDeepAnalysisPdf = () => {
  const markdown = getDeepAnalysisReportMarkdown();
  if (isExportingDeepAnalysisPdf.value) return;
  exportPdfFile(markdown, "deep-analysis");
};

const onCreateDashboard = () => {
  if (!props.snapshot.threadId || typeof props.snapshot.requestSeq !== "number") return;
  if (isCreatingDashboard.value) return;
  emit("createDashboard", {
    threadId: props.snapshot.threadId,
    requestSeq: props.snapshot.requestSeq,
  });
};

const onClarificationSelect = (option: ClarificationOption) => {
  emit("clarificationSelect", option);
};

const onAddToDashboard = (payload: {
  threadId: string;
  requestSeq: number;
  datasetIndex: number;
  datasetTitle?: string;
}) => {
  emit("addToDashboard", payload);
};

/** Dashboard entry for the streaming body table: the context is filled in by this turn's snapshot, and the action isn't offered when it's missing. */
const forwardTableAction = (payload: { datasetIndex: number; datasetTitle?: string }) => {
  if (!dashboardContext.value) return;
  emit("addToDashboard", { ...dashboardContext.value, ...payload });
};

const shouldExpandThinkingPanel = () => {
  if (props.snapshot.status === "failed") return true;
  if (!props.snapshot.primaryText) return true;
  return props.snapshot.status !== "completed";
};
</script>

<template>
  <div class="snapshot-content">
    <!-- Execution display view: shared with report tracing; the Q&A body is only shown by it once -->
    <QueryExecutionView
      v-if="snapshot.mode === 'standard' && snapshot.execution"
      :facts="snapshot.execution"
      :expand-thinking="shouldExpandThinkingPanel()"
      :dashboard-context="dashboardContext"
      @add-to-dashboard="onAddToDashboard"
    >
      <!-- In 3.1.4 the appended analysis and charts are in the same body card, before QC;
           keep them consistent with the same block when there's no body card below -->
      <template v-if="hasExecutionBody" #appendix>
        <div v-if="snapshot.analysisText" class="analysis-content with-divider">
          <MessageContent :content="snapshot.analysisText" />
          <div v-if="canExportStandardAnalysisPdf" class="report-export-actions">
            <button
              class="ui-btn ui-btn-secondary"
              :class="{ 'is-loading': isExportingStandardPdf }"
              :disabled="isExportingStandardPdf"
              @click="exportStandardPdf"
            >
              <span
                v-if="isExportingStandardPdf"
                class="export-pdf-spinner"
                aria-hidden="true"
              ></span>
              <FileJson v-else :size="14" />
              <span>
                {{ isExportingStandardPdf ? t("analysis.exporting") : t("analysis.exportPdf") }}
              </span>
            </button>
          </div>
        </div>

        <div
          v-if="snapshot.visualizationHTML || snapshot.visualizationLoading"
          class="visualization-wrapper"
        >
          <MessageContent
            content=""
            :visualization-loading="snapshot.visualizationLoading"
            :visualization-h-t-m-l="snapshot.visualizationHTML"
          />
        </div>
      </template>
    </QueryExecutionView>

    <DeepAnalysisResult
      v-if="snapshot.mode === 'deep-analysis' && snapshot.deepAnalysis"
      :activities="snapshot.deepAnalysis.activities"
      :run-state="snapshot.deepAnalysis.runState"
      :archived="archived"
    />

    <div v-if="shouldShowStandardPending" class="standard-thinking-pending">
      <div class="pending-badge">
        <span class="pending-spinner"></span>
        <span>{{ t("chat.understandingQuestion") }}</span>
      </div>
      <div class="pending-description">{{ t("chat.organizingQuestion") }}</div>
    </div>

    <div v-if="shouldShowDeepAnalysisPending" class="deep-analysis-pending">
      <div class="pending-badge">
        <span class="pending-spinner"></span>
        <span>{{ t("analysis.analysisPreparing") }}</span>
      </div>
      <div class="pending-description">{{ t("analysis.analysisPreparingDesc") }}</div>
    </div>

    <div
      v-if="
        shouldShowPrimaryText ||
        snapshot.clarification ||
        (!hasExecutionBody &&
          (snapshot.analysisText || snapshot.visualizationLoading || snapshot.visualizationHTML)) ||
        hasDeepAnalysisVisualBlocks
      "
      class="assistant-content"
    >
      <template v-if="snapshot.mode === 'deep-analysis' && hasDeepAnalysisVisualBlocks">
        <div v-for="section in reportSections" :key="section.id" class="analysis-section-block">
          <MessageContent :content="section.content" />
        </div>

        <div v-if="canExportDeepAnalysisPdf || canCreateDashboard" class="report-export-actions">
          <button
            v-if="canExportDeepAnalysisPdf"
            class="ui-btn ui-btn-secondary"
            :class="{ 'is-loading': isExportingDeepAnalysisPdf }"
            :disabled="isExportingDeepAnalysisPdf"
            @click="exportDeepAnalysisPdf"
          >
            <span
              v-if="isExportingDeepAnalysisPdf"
              class="export-pdf-spinner"
              aria-hidden="true"
            ></span>
            <FileJson v-else :size="14" />
            <span>
              {{ isExportingDeepAnalysisPdf ? t("analysis.exporting") : t("analysis.exportPdf") }}
            </span>
          </button>
          <button
            v-if="canCreateDashboard"
            class="ui-btn ui-btn-secondary"
            :class="{ 'is-loading': isCreatingDashboard }"
            :disabled="isCreatingDashboard"
            @click="onCreateDashboard"
          >
            <span
              v-if="isCreatingDashboard"
              class="dashboard-create-spinner"
              aria-hidden="true"
            ></span>
            <LayoutDashboard v-else :size="14" />
            <span>
              {{ isCreatingDashboard ? t("common.generating") : t("analysis.addToDashboard") }}
            </span>
          </button>
        </div>
      </template>

      <template v-else>
        <div v-if="snapshot.clarification" class="clarification-card">
          <div class="clarification-message">
            {{ snapshot.clarification.message }}
          </div>
          <div class="clarification-options">
            <button
              v-for="option in snapshot.clarification.options"
              :key="option.id"
              class="ui-btn ui-btn-block clarification-option"
              @click="onClarificationSelect(option)"
            >
              {{ option.resolvedQuestion }}
            </button>
          </div>
          <div class="clarification-hint">
            {{ t("chat.clarificationHint") }}
          </div>
        </div>

        <MessageContent
          v-if="shouldShowPrimaryText"
          :content="primaryTextForDisplay"
          :result-datasets="hasExecutionResultFacts ? undefined : snapshot.datasets"
          :show-dashboard-action="!!dashboardContext"
          @add-to-dashboard="forwardTableAction"
        />

        <!-- When there's no body card (no new query this turn, referencing historical results for appended analysis/charts), render inside this card;
             keep it consistent with the same block in the execution view's appendix slot -->
        <div
          v-if="!hasExecutionBody && snapshot.analysisText"
          class="analysis-content"
          :class="{ 'with-divider': shouldShowPrimaryText }"
        >
          <MessageContent :content="snapshot.analysisText" />
          <div v-if="canExportStandardAnalysisPdf" class="report-export-actions">
            <button
              class="ui-btn ui-btn-secondary"
              :class="{ 'is-loading': isExportingStandardPdf }"
              :disabled="isExportingStandardPdf"
              @click="exportStandardPdf"
            >
              <span
                v-if="isExportingStandardPdf"
                class="export-pdf-spinner"
                aria-hidden="true"
              ></span>
              <FileJson v-else :size="14" />
              <span>
                {{ isExportingStandardPdf ? t("analysis.exporting") : t("analysis.exportPdf") }}
              </span>
            </button>
          </div>
        </div>

        <div
          v-if="!hasExecutionBody && (snapshot.visualizationHTML || snapshot.visualizationLoading)"
          class="visualization-wrapper"
        >
          <MessageContent
            content=""
            :visualization-loading="snapshot.visualizationLoading"
            :visualization-h-t-m-l="snapshot.visualizationHTML"
          />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.snapshot-content {
  width: 100%;
}

.assistant-content {
  margin-bottom: 16px;
  padding: 18px 20px;
  border-radius: 18px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  box-shadow: var(--shadow-card);
}

.analysis-content.with-divider {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed var(--el-border-color);
}

.clarification-card {
  display: grid;
  gap: 12px;
}

.clarification-message {
  font-size: 14px;
  line-height: 1.7;
  color: var(--el-text-color-primary);
}

.clarification-options {
  display: grid;
  gap: 10px;
}

.clarification-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.report-export-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}

.clarification-option {
  text-align: left;
  justify-content: left;
  border-radius: 14px;
  padding: 12px 14px;
  font-size: 14px;
  line-height: 1.6;
}

.visualization-wrapper {
  margin-top: 16px;
}

.analysis-section-block {
  margin-bottom: 20px;
}

.standard-thinking-pending,
.deep-analysis-pending {
  margin-top: 4px;
  margin-bottom: 16px;
  padding: 14px 16px;
  border-radius: 16px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--el-color-primary) 5%, transparent) 0%,
    transparent 100%
  );
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 12%, transparent);
  box-shadow: 0 8px 24px var(--shadow-card);
}

.pending-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--el-color-primary) 8%, transparent);
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--el-color-primary);
}

.pending-spinner {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  border: 2px solid color-mix(in srgb, var(--el-color-primary) 18%, transparent);
  border-top-color: var(--el-color-primary);
  animation: pending-spin 0.8s linear infinite;
}

.pending-description {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

@keyframes pending-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.dashboard-create-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, var(--el-color-primary) 20%, transparent);
  border-top-color: var(--el-color-primary);
  border-radius: 50%;
  animation: dashboard-create-spin 0.8s linear infinite;
}

.export-pdf-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, var(--el-color-primary) 20%, transparent);
  border-top-color: var(--el-color-primary);
  border-radius: 50%;
  animation: dashboard-create-spin 0.8s linear infinite;
}

@keyframes dashboard-create-spin {
  to {
    transform: rotate(360deg);
  }
}

.ui-btn.is-loading {
  opacity: 0.85;
}

@media (max-width: 767px) {
  .assistant-content,
  .standard-thinking-pending,
  .deep-analysis-pending {
    padding: 14px;
  }
}
</style>
