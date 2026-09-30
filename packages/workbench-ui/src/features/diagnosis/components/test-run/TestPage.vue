<script setup lang="ts">
import type {
  CaseSetListItem as CaseSetItem,
  RunSummary,
  RunEvent,
} from "@ontomato/contracts/autotest";
import type { SseErrorEvent } from "@ontomato/contracts/errors";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { authHost } from "../../../../utils/auth";
import { diagnosisApi } from "../../api";
import {
  formatAutotestAccuracyRate,
  getAutotestVerdictLabel,
  normalizeAutotestVerdict,
  summarizeAutotestVerdicts,
} from "../../utils/autotest-result";
import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../../content";
import TestRunConfigPanel from "./TestRunConfigPanel.vue";
import TestRunLogPanel from "./TestRunLogPanel.vue";

const { t } = useI18n();

type RunState = "idle" | "running" | "stopping" | "completed" | "failed" | "cancelled";

const props = defineProps<{
  initialRunId?: string | null;
}>();

const emit = defineEmits<{
  "run-created": [runId: string];
  "run-settled": [runId: string];
}>();

/* ------------------------------------------------------------------ */
/*  API Helpers                                                        */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

const executeMode = ref<"caseset" | "temporary">("caseset");
const caseSets = ref<CaseSetItem[]>([]);
const selectedCaseSetId = ref("");
const concurrency = ref(3);
const runRounds = ref(1);
const caseTimeoutSeconds = ref(1200);
const DEFAULT_JUDGMENT = t("diagnosis.hasResultCounts");
const tempQuestion = ref("");
const tempExpectedAnswer = ref("");
const tempExpectedLogic = ref("");
const tempJudgment = ref(DEFAULT_JUDGMENT);
const repeatCount = ref(1);
const runState = ref<RunState>("idle");
const runId = ref("");
const errorText = ref("");
const loading = ref(false);

// Progress
const completedCases = ref(0);
const runSummary = ref<RunSummary>(emptyRunSummary());

// Log
const logLines = ref<Array<{ level: string; ts: string; msg: string }>>([]);
const logPanelRef = ref<InstanceType<typeof TestRunLogPanel> | null>(null);
let eventSource: EventSource | null = null;

const displayTotalCases = computed(() => {
  if (runSummary.value.total > 0) return runSummary.value.total;
  if (executeMode.value === "temporary") return repeatCount.value;
  const selectedCaseSet = caseSets.value.find((cs) => cs.id === selectedCaseSetId.value);
  return selectedCaseSet ? selectedCaseSet.caseCount : 0;
});

const displayCompletedCases = computed(() => {
  if (displayTotalCases.value === 0) return 0;
  return Math.min(completedCases.value, displayTotalCases.value);
});

const progressPercent = computed(() => {
  if (displayTotalCases.value === 0) return 0;
  if (runState.value === "completed") return 100;
  return Math.min(100, Math.round((displayCompletedCases.value / displayTotalCases.value) * 100));
});

const accuracyRate = computed(() => formatAutotestAccuracyRate(runSummary.value));

const isRunning = computed(() => runState.value === "running");
/** Run is still occupying the backend (running or stopping) -- block re-start. */
const isActive = computed(() => runState.value === "running" || runState.value === "stopping");

const progressStatusText = computed(() => {
  const labels: Partial<Record<RunState, string>> = {
    running: t("diagnosis.running"),
    stopping: t("diagnosis.stopping"),
    completed: t("task.completed"),
    failed: t("diagnosis.runFailed"),
    cancelled: t("task.cancelled"),
  };
  return (
    labels[runState.value] ??
    (displayTotalCases.value > 0 ? t("diagnosis.ready") : t("diagnosis.waitingConfig"))
  );
});

function emitRunSettled() {
  if (runId.value) {
    emit("run-settled", runId.value);
  }
}

function emptyRunSummary(total = 0): RunSummary {
  return { total, correct: 0, wrong: 0, abnormal: 0 };
}

function applyRunSummary(summary: RunSummary) {
  runSummary.value = summary;
}

function normalizeRunSummary(
  summary: Partial<RunSummary> | undefined,
  totalFallback = 0
): RunSummary {
  return {
    total: typeof summary?.total === "number" ? summary.total : totalFallback,
    correct: typeof summary?.correct === "number" ? summary.correct : 0,
    wrong: typeof summary?.wrong === "number" ? summary.wrong : 0,
    abnormal: typeof summary?.abnormal === "number" ? summary.abnormal : 0,
  };
}

function normalizeRunState(status?: string): RunState {
  if (
    status === "running" ||
    status === "stopping" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  ) {
    return status;
  }
  return "idle";
}

function normalizeJudgment(value: string): string {
  return value.trim() || DEFAULT_JUDGMENT;
}

/* ------------------------------------------------------------------ */
/*  Load Case Sets                                                     */
/* ------------------------------------------------------------------ */

async function loadCaseSets() {
  try {
    const data = await diagnosisApi.listRunCaseSets();
    caseSets.value = data || [];
    if (
      caseSets.value.length > 0 &&
      !caseSets.value.find((cs) => cs.id === selectedCaseSetId.value)
    ) {
      selectedCaseSetId.value = caseSets.value[0].id;
    }
  } catch (e: any) {
    errorText.value = e.message || t("diagnosis.loadCaseSetsFailed");
  }
}

/* ------------------------------------------------------------------ */
/*  Start / Stop Run                                                   */
/* ------------------------------------------------------------------ */

async function startRun() {
  if (executeMode.value === "caseset" && !selectedCaseSetId.value) {
    errorText.value = t("diagnosis.pleaseSelectCaseSet");
    return;
  }
  if (executeMode.value === "temporary") {
    if (!tempQuestion.value.trim()) {
      errorText.value = t("diagnosis.pleaseEnterQuestion");
      return;
    }
  }
  errorText.value = "";
  loading.value = true;

  try {
    const body: Record<string, unknown> = {
      concurrency: concurrency.value,
      rounds: runRounds.value,
      caseTimeoutSeconds: caseTimeoutSeconds.value,
      tk: authHost().getToken() || undefined,
    };
    if (executeMode.value === "caseset") {
      body.caseSetId = selectedCaseSetId.value;
    } else {
      const cases = Array.from({ length: repeatCount.value }, (_, i) => ({
        caseId: `temp-${i + 1}`,
        question: tempQuestion.value.trim(),
        expectedAnswer: tempExpectedAnswer.value.trim() || undefined,
        expectedLogic: tempExpectedLogic.value.trim() || undefined,
        judgment: normalizeJudgment(tempJudgment.value),
      }));
      body.temporaryCases = cases;
    }
    const data = await diagnosisApi.startRun(body);

    runId.value = data.runId;
    runSummary.value = data.summary;
    completedCases.value = 0;
    runState.value = "running";
    logLines.value = [];

    connectSSE(data.runId);
    emit("run-created", data.runId);
  } catch (e: any) {
    errorText.value = e.message || t("diagnosis.startFailed");
  } finally {
    loading.value = false;
  }
}

async function stopRun() {
  if (!runId.value) return;
  try {
    await diagnosisApi.stopRun(runId.value);
    appendLog("warn", t("diagnosis.stopRequestSent"));
    runState.value = "stopping";
  } catch (e: any) {
    errorText.value = e.message || t("diagnosis.stopFailed");
  }
}

async function restoreRun(id: string) {
  if (!id || (runId.value === id && runState.value !== "idle")) return;

  loading.value = true;
  errorText.value = "";
  disconnectSSE();
  logLines.value = [];

  try {
    const [runDetail, resultDetail] = await Promise.all([
      diagnosisApi.getRunData(encodeURIComponent(id)),
      diagnosisApi.getRunResultsData(encodeURIComponent(id)),
    ]);
    const restoredState = normalizeRunState(runDetail.status);
    const resultRows = Array.isArray(resultDetail.results) ? resultDetail.results : [];

    runId.value = runDetail.runId || id;
    runState.value = restoredState;
    completedCases.value = resultRows.length;
    runSummary.value =
      resultRows.length > 0
        ? summarizeAutotestVerdicts(resultRows)
        : normalizeRunSummary(resultDetail.summary || runDetail.summary, resultRows.length);

    appendLog("info", workbenchContent().text.observe.restoredTestBatch(runId.value));

    if (restoredState === "running" || restoredState === "stopping") {
      connectSSE(runId.value);
    }
  } catch (e: any) {
    errorText.value = e.message || t("diagnosis.requestFailed");
  } finally {
    loading.value = false;
  }
}

/* ------------------------------------------------------------------ */
/*  SSE                                                                */
/* ------------------------------------------------------------------ */

function connectSSE(id: string) {
  disconnectSSE();
  eventSource = diagnosisApi.openRunEvents(id, authHost().getToken() || "");

  eventSource.onmessage = (ev) => {
    if (ev.data === "[DONE]") {
      // Final status normally arrives via status_change/run_complete; only
      // fall back to "completed" if the stream ends while still non-terminal.
      if (runState.value === "running" || runState.value === "stopping") {
        runState.value = "completed";
      }
      emitRunSettled();
      disconnectSSE();
      return;
    }

    try {
      const event: RunEvent | SseErrorEvent = JSON.parse(ev.data);
      handleRunEvent(event);
    } catch {
      // ignore parse errors
    }
  };

  eventSource.onerror = () => {
    if (runState.value === "running") {
      appendLog("error", t("diagnosis.sseDisconnected"));
      runState.value = "failed";
      emitRunSettled();
    }
    disconnectSSE();
  };
}

function disconnectSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function handleRunEvent(event: RunEvent | SseErrorEvent) {
  switch (event.type) {
    case "case_start":
      appendLog(
        "info",
        t("diagnosis.caseStart", {
          caseId: event.data?.caseId || "",
          question: event.data?.question || "",
        })
      );
      break;
    case "case_log":
      appendLog(
        "info",
        `${t("diagnosis.caseLabel", { caseId: event.data?.caseId || "", label: event.data?.label || "" })}`
      );
      break;
    case "case_end": {
      const verdict = normalizeAutotestVerdict(event.data?.verdict);
      const label = getAutotestVerdictLabel(verdict);
      const reason = event.data?.verdictReason ? ` - ${event.data.verdictReason}` : "";
      const level = verdict === "correct" ? "info" : verdict === "wrong" ? "warn" : "error";
      appendLog(
        level,
        `${t("diagnosis.caseResult", { caseId: event.data?.caseId || "", label, reason, duration: formatDuration(event.data?.durationMs) })}`
      );
      break;
    }
    case "progress": {
      if (event.data?.summary) applyRunSummary(event.data.summary);
      if (typeof event.data?.completed === "number") {
        completedCases.value = event.data.completed;
      }
      break;
    }
    case "status_change": {
      const status = String(event.data?.status || "");
      applyRunStatus(status);
      if (
        runState.value === "completed" ||
        runState.value === "failed" ||
        runState.value === "cancelled"
      ) {
        emitRunSettled();
      }
      break;
    }
    case "run_complete":
      if (event.data?.summary) {
        applyRunSummary(event.data.summary);
        completedCases.value = runSummary.value.total;
      }
      // Final status may already be set via status_change. Historical/inactive
      // streams can also send it directly on run_complete.
      if (event.data?.status) {
        applyRunStatus(String(event.data.status));
      } else if (runState.value === "running" || runState.value === "stopping") {
        runState.value = "completed";
      }
      appendLog("info", t("diagnosis.testRunComplete"));
      emitRunSettled();
      break;
    case "error":
      runState.value = "failed";
      appendLog("error", `${t("diagnosis.runError")}: ${event.error || t("common.unknownError")}`);
      emitRunSettled();
      break;
    default:
      break;
  }
}

/** Map backend RunStatus onto the local RunState. */
function applyRunStatus(status: string) {
  switch (status) {
    case "running":
      runState.value = "running";
      break;
    case "stopping":
      runState.value = "stopping";
      appendLog("warn", t("diagnosis.stoppingTest"));
      break;
    case "cancelled":
      runState.value = "cancelled";
      appendLog("warn", t("diagnosis.testCancelled"));
      break;
    case "failed":
      runState.value = "failed";
      break;
    case "completed":
      runState.value = "completed";
      break;
    default:
      break;
  }
}

function formatDuration(ms?: number): string {
  if (ms == null) return "-";
  return (ms / 1000).toFixed(1) + "s";
}

/* ------------------------------------------------------------------ */
/*  Log Terminal                                                        */
/* ------------------------------------------------------------------ */

function appendLog(level: string, msg: string) {
  const now = new Date();
  const ts = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join(":");
  logLines.value.push({ level, ts, msg });
}

function clearLogs() {
  logLines.value = [];
}

function scrollToBottom() {
  logPanelRef.value?.scrollToBottom();
}

watch(
  () => logLines.value.length,
  () => scrollToBottom()
);

watch(
  () => props.initialRunId,
  (id) => {
    if (!id || runId.value === id) return;
    void restoreRun(id);
  },
  { immediate: true }
);

/* ------------------------------------------------------------------ */
/*  Resizable Split                                                     */
/* ------------------------------------------------------------------ */

const splitContainer = ref<HTMLElement | null>(null);
const leftWidth = ref(380);
const isDragging = ref(false);

function onDragStart(e: MouseEvent) {
  e.preventDefault();
  isDragging.value = true;
  const startX = e.clientX;
  const startW = leftWidth.value;

  function onMove(ev: MouseEvent) {
    const containerW = splitContainer.value?.clientWidth || 800;
    const newW = Math.max(260, Math.min(containerW - 300, startW + ev.clientX - startX));
    leftWidth.value = newW;
  }

  function onUp() {
    isDragging.value = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

/* ------------------------------------------------------------------ */
/*  Lifecycle                                                           */
/* ------------------------------------------------------------------ */

loadCaseSets();

onBeforeUnmount(() => {
  disconnectSSE();
});
</script>

<template>
  <div ref="splitContainer" class="test-page" :class="{ dragging: isDragging }">
    <TestRunConfigPanel
      :width="leftWidth"
      :execute-mode="executeMode"
      :case-sets="caseSets"
      :selected-case-set-id="selectedCaseSetId"
      :concurrency="concurrency"
      :run-rounds="runRounds"
      :case-timeout-seconds="caseTimeoutSeconds"
      :default-judgment="DEFAULT_JUDGMENT"
      :temp-question="tempQuestion"
      :temp-expected-answer="tempExpectedAnswer"
      :temp-expected-logic="tempExpectedLogic"
      :temp-judgment="tempJudgment"
      :repeat-count="repeatCount"
      :is-running="isRunning"
      :is-active="isActive"
      :loading="loading"
      :error-text="errorText"
      :progress-status-text="progressStatusText"
      :progress-percent="progressPercent"
      :display-completed-cases="displayCompletedCases"
      :display-total-cases="displayTotalCases"
      :run-summary="runSummary"
      :accuracy-rate="accuracyRate"
      @start="startRun"
      @stop="stopRun"
      @clear-error="errorText = ''"
      @update:execute-mode="executeMode = $event"
      @update:selected-case-set-id="selectedCaseSetId = $event"
      @update:concurrency="concurrency = $event"
      @update:run-rounds="runRounds = $event"
      @update:case-timeout-seconds="caseTimeoutSeconds = $event"
      @update:temp-question="tempQuestion = $event"
      @update:temp-expected-answer="tempExpectedAnswer = $event"
      @update:temp-expected-logic="tempExpectedLogic = $event"
      @update:temp-judgment="tempJudgment = $event"
      @update:repeat-count="repeatCount = $event"
    />

    <div class="drag-handle" @mousedown="onDragStart" />

    <TestRunLogPanel
      ref="logPanelRef"
      :log-lines="logLines"
      :is-running="isRunning"
      @clear="clearLogs"
    />
  </div>
</template>

<style scoped>
.test-page {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.test-page.dragging {
  cursor: col-resize;
  user-select: none;
}

/* ---- Drag Handle ---- */
.drag-handle {
  width: 5px;
  cursor: col-resize;
  background: var(--el-border-color-lighter);
  flex-shrink: 0;
  transition: background 0.15s;
}

.drag-handle:hover,
.dragging .drag-handle {
  background: var(--el-color-primary-light-5);
}
</style>
