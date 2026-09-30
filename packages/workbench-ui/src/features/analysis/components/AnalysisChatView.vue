<script setup lang="ts">
import type { LoopSubagentTrace } from "@ontomato/contracts/analysis-task";
import type { EgressMessage } from "@ontomato/contracts/agent-egress";

import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useAnalysisStore } from "../stores/analysis";
import {
  CheckCircle2,
  Zap,
  Clock,
  CircleSlash,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { analysisTaskApi } from "../api";
import type { Message, QueryExecutionFacts } from "../../../types/chat";
import type {
  AnalysisActivity,
  DeepAnalysisTaskPayload,
} from "@ontomato/contracts/analysis-presentation";
import { renderMarkdown } from "../../../utils/markdown";
import {
  loopActivityDetail,
  loopActivityLabel,
  loopQuestionStatusText,
} from "../utils/loop-activity";
import DeepAnalysisResult from "./DeepAnalysisResult.vue";
import AgentMessageTrace from "./AgentMessageTrace.vue";
import { QueryExecutionView } from "../../query-view";
import TurnDiagnoseButton from "../../diagnosis/components/TurnDiagnoseButton.vue";
import { buildDimensionTree, dimensionStageStates } from "../utils/dimension-view";
import { workbenchContent } from "../../../content";

const runSwitcherCopy = workbenchContent().text.runSwitcher;

const { t } = useI18n();

const store = useAnalysisStore();
const { currentTask: task, taskRuns, taskRunIndex } = storeToRefs(store);
const {
  displayMessages: messages,
  displayStreamingSnapshot: streamingSnapshot,
  displayIsLoading: isLoading,
} = storeToRefs(store);
const runCount = computed(() => taskRuns.value.length);
const runIndex = computed(() => taskRunIndex.value);

function selectRun(index: number) {
  store.selectRun(index);
}

const expandedLoopActivities = ref<Record<string, boolean>>({});
const expandedTurnTraces = ref<Record<string, boolean>>({});

interface SubagentTraceState {
  expanded: boolean;
  loading: boolean;
  trace?: LoopSubagentTrace;
  error?: boolean;
}

const subagentTraceStates = ref<Record<string, SubagentTraceState>>({});

watch(
  () => task.value?.id,
  () => {
    expandedLoopActivities.value = {};
    expandedTurnTraces.value = {};
    subagentTraceStates.value = {};
  }
);

/** Rendered turn by turn: each turn's user message, execution artifacts, and reply are grouped, and later turns don't overwrite earlier ones. */
interface TurnGroup {
  key: string;
  user: Message | null;
  assistant: Message | null;
  payload: DeepAnalysisTaskPayload | null;
  /** Public messages and tool results already egress-filtered for this turn; only from this turn's snapshot. */
  trace: EgressMessage[];
  /** This turn is streaming: the payload comes from the streaming snapshot, or the standard follow-up body is still growing. */
  streaming: boolean;
  streamingText: string;
}

const turnGroups = computed<TurnGroup[]>(() => {
  const groups: TurnGroup[] = [];
  for (const message of messages.value) {
    if (message.role === "user") {
      groups.push({
        key: `user-${message.id}`,
        user: message,
        assistant: null,
        payload: null,
        trace: [],
        streaming: false,
        streamingText: "",
      });
      continue;
    }
    let group = groups[groups.length - 1];
    if (!group || group.assistant) {
      group = {
        key: `assistant-${message.id}`,
        user: null,
        assistant: null,
        payload: null,
        trace: [],
        streaming: false,
        streamingText: "",
      };
      groups.push(group);
    }
    group.assistant = message;
    if (message.snapshot?.mode === "deep-analysis" && message.snapshot.deepAnalysis) {
      group.payload = message.snapshot.deepAnalysis;
    }
    if (message.snapshot?.trace) group.trace = message.snapshot.trace;
  }

  const streaming = streamingSnapshot.value;
  if (streaming) {
    let group = groups[groups.length - 1];
    // Only attach to the current turn that has no reply yet; when the previous turn is complete, don't overwrite its artifacts.
    if (!group || group.assistant) {
      group = {
        key: "streaming",
        user: null,
        assistant: null,
        payload: null,
        trace: [],
        streaming: false,
        streamingText: "",
      };
      groups.push(group);
    }
    group.streaming = true;
    if (streaming.trace) group.trace = streaming.trace;
    if (streaming.mode === "deep-analysis" && streaming.deepAnalysis) {
      group.payload = streaming.deepAnalysis;
    } else {
      group.streamingText = streaming.primaryText || "";
    }
  }
  return groups;
});

/** First occurrence position of a follow-up record: the first standard follow-up turn after a turn with execution artifacts. */
const followUpDividerIndex = computed(() => {
  let seenExecution = false;
  for (let index = 0; index < turnGroups.value.length; index++) {
    const group = turnGroups.value[index];
    if (group.payload) {
      seenExecution = true;
      continue;
    }
    if (seenExecution) return index;
  }
  return -1;
});

/** Loop-mode progress is expressed by a monotone activity stream, not the dimension-orchestration stage cards and dimension framework. */
function isLoopMode(payload: DeepAnalysisTaskPayload | null): boolean {
  return payload?.executionMode === "loop";
}
function loopActivities(payload: DeepAnalysisTaskPayload | null): AnalysisActivity[] {
  return payload?.activities || [];
}
function loopProgress(payload: DeepAnalysisTaskPayload | null) {
  return payload?.runState.progress;
}
function loopRunning(payload: DeepAnalysisTaskPayload | null): boolean {
  return payload?.runState.status === "running";
}
function thinkingTree(payload: DeepAnalysisTaskPayload | null) {
  return buildDimensionTree(payload?.activities || []);
}

function isLoopActivityExpandable(activity: AnalysisActivity): boolean {
  return (
    activity.kind === "dispatch" || (activity.kind === "evidence" && !!activity.questions?.length)
  );
}

function toggleLoopActivity(activity: AnalysisActivity) {
  if (!isLoopActivityExpandable(activity)) return;
  expandedLoopActivities.value = {
    ...expandedLoopActivities.value,
    [activity.activityId]: !expandedLoopActivities.value[activity.activityId],
  };
}

async function toggleSubagentTrace(activityId: string) {
  const current = subagentTraceStates.value[activityId];
  if (current?.expanded) {
    subagentTraceStates.value = {
      ...subagentTraceStates.value,
      [activityId]: { ...current, expanded: false },
    };
    return;
  }
  if (current?.trace) {
    subagentTraceStates.value = {
      ...subagentTraceStates.value,
      [activityId]: { ...current, expanded: true },
    };
    return;
  }

  const taskId = task.value?.id;
  if (!taskId) return;
  subagentTraceStates.value = {
    ...subagentTraceStates.value,
    [activityId]: { expanded: true, loading: true },
  };
  try {
    const trace = await analysisTaskApi.getLoopSubagentTrace(taskId, activityId);
    if (task.value?.id !== taskId) return;
    subagentTraceStates.value = {
      ...subagentTraceStates.value,
      [activityId]: { expanded: true, loading: false, trace },
    };
  } catch {
    if (task.value?.id !== taskId) return;
    subagentTraceStates.value = {
      ...subagentTraceStates.value,
      [activityId]: { expanded: true, loading: false, error: true },
    };
  }
}

function toggleTurnTrace(key: string) {
  expandedTurnTraces.value = {
    ...expandedTurnTraces.value,
    [key]: !expandedTurnTraces.value[key],
  };
}

interface StepState {
  name: string;
  status: "done" | "active" | "pending" | "stopped";
  detail: string;
}

const stages = [
  t("analysis.frameworkGeneration"),
  t("analysis.metricCollection"),
  t("analysis.dataAnalysis"),
  t("analysis.reportGeneration"),
];

function analysisSteps(payload: DeepAnalysisTaskPayload | null): StepState[] {
  if (!payload || isLoopMode(payload)) return [];
  return dimensionStageStates(payload).map((status, i) => ({
    name: stages[i],
    status,
    detail:
      status === "active"
        ? payload.runState.progress.label
        : status === "stopped"
          ? t("analysis.analysisStopped")
          : "",
  }));
}
function hasCompletedAnalysis(payload: DeepAnalysisTaskPayload | null): boolean {
  return payload?.runState.status === "completed";
}
function isStoppedAnalysis(payload: DeepAnalysisTaskPayload | null): boolean {
  return payload?.runState.status === "cancelled";
}
function showStepCards(payload: DeepAnalysisTaskPayload | null): boolean {
  return !isLoopMode(payload) && analysisSteps(payload).length > 0;
}
const showEmpty = computed(
  () => messages.value.length === 0 && !isLoading.value && !streamingSnapshot.value
);

/** The final reply to show for this turn: the report task's body lives in the report view; here only the non-report body is filled in. */
/**
 * This turn's reply body only takes this turn's own artifacts or reply; it doesn't use the task's
 * current fields to backfill the last turn, otherwise the previous turn's answer would leak into a
 * new turn that hasn't produced an answer yet. The execution turn's body is delivered by the report view.
 */
function groupAnswer(group: TurnGroup): string {
  // The deep analysis body of a report task is delivered only in the report view; even if that run
  // is cancelled and produces no report artifact, partial body must not be rolled back from the
  // snapshot into the chat bubble.
  if (group.payload && isReportTask.value) return "";
  return group.payload?.finalAnswer || group.assistant?.content || "";
}

/** Only report tasks switch by run history; regular continuous conversations always show all turns. Judged by the task's own delivery mode. */
const isReportTask = computed(() => task.value?.reportDeliverableEnabled !== false);
</script>

<template>
  <div class="analysis-chat-view">
    <div v-if="showEmpty" class="chat-empty">
      <div class="ai-skeleton">
        <el-skeleton animated :rows="10" />
      </div>
    </div>

    <div v-else class="messages-scroll">
      <div class="messages-inner">
        <!-- Rendered turn by turn: each turn's user message, execution process, and reply stay in their own turn; later turns don't overwrite earlier ones -->
        <template v-for="(group, gi) in turnGroups" :key="group.key">
          <div v-if="gi === followUpDividerIndex" class="follow-up-section">
            <div class="follow-up-divider">
              <span>{{ t("analysis.followUpRecord") }}</span>
            </div>
          </div>

          <div v-if="group.user" class="chat-msg user">
            <div class="chat-bubble user">{{ group.user.content }}</div>
          </div>

          <div
            v-if="
              gi === 0 &&
              group.user &&
              isReportTask &&
              (runCount || 0) > 1 &&
              task?.status !== 'running'
            "
            class="run-switcher-row"
          >
            <div class="run-switcher" :aria-label="runSwitcherCopy.label">
              <button
                :disabled="runIndex === 0"
                :title="runSwitcherCopy.previous"
                @click="selectRun((runIndex || 0) - 1)"
              >
                ‹
              </button>
              <span class="run-index">{{ (runIndex || 0) + 1 }} / {{ runCount }}</span>
              <button
                :disabled="runIndex === (runCount || 0) - 1"
                :title="runSwitcherCopy.next"
                @click="selectRun((runIndex || 0) + 1)"
              >
                ›
              </button>
            </div>
          </div>

          <!-- The first turn shows the user's topic first, then confirms the analysis start; follow-up turns don't repeat it. -->
          <div v-if="gi === 0 && group.user" class="chat-msg system analysis-acknowledgment">
            <div class="chat-bubble system">{{ t("analysis.analysisReceived") }}</div>
          </div>

          <!-- Loop execution mode: monotone activity stream, no total-based progress -->
          <div
            v-if="isLoopMode(group.payload) && loopActivities(group.payload).length > 0"
            class="analysis-steps"
          >
            <div class="step-card">
              <div class="step-card-header">
                <div class="step-icon" :class="loopRunning(group.payload) ? 'active' : 'done'">
                  <Zap v-if="loopRunning(group.payload)" :size="12" />
                  <CheckCircle2 v-else :size="12" />
                </div>
                <span class="step-name" :class="loopRunning(group.payload) ? 'active' : 'done'">
                  {{ t("analysis.analysisProgress") }}
                </span>
              </div>
              <div class="step-detail">
                {{
                  t("analysis.loopActivityCount", { done: loopProgress(group.payload)?.done || 0 })
                }}
                <template v-if="loopRunning(group.payload)">
                  ·
                  {{
                    t("analysis.loopCurrentActivity", {
                      name: loopProgress(group.payload)?.label || "",
                    })
                  }}
                </template>
              </div>
            </div>

            <div class="thinking-tree">
              <div
                v-for="(activity, ai) in loopActivities(group.payload)"
                :key="activity.activityId"
                class="tree-dimension"
              >
                <button
                  type="button"
                  class="tree-dim-header loop-activity-header"
                  :disabled="!isLoopActivityExpandable(activity)"
                  :aria-expanded="
                    isLoopActivityExpandable(activity)
                      ? !!expandedLoopActivities[activity.activityId]
                      : undefined
                  "
                  @click="toggleLoopActivity(activity)"
                >
                  <div
                    class="tree-dim-icon"
                    :class="{
                      done: activity.status === 'completed',
                      running: activity.status === 'running',
                      failed: activity.status === 'failed',
                      stopped: activity.status === 'cancelled',
                    }"
                  >
                    <CheckCircle2 v-if="activity.status === 'completed'" :size="12" />
                    <Zap v-else-if="activity.status === 'running'" :size="12" />
                    <CircleSlash v-else :size="12" />
                  </div>
                  <span class="tree-dim-name">
                    {{ ai + 1 }}. {{ loopActivityLabel(activity, t) }}
                  </span>
                  <template v-if="isLoopActivityExpandable(activity)">
                    <ChevronDown
                      v-if="expandedLoopActivities[activity.activityId]"
                      class="loop-expand-icon"
                      :size="15"
                    />
                    <ChevronRight v-else class="loop-expand-icon" :size="15" />
                  </template>
                </button>
                <div
                  v-if="loopActivityDetail(activity, t)"
                  class="tree-dim-reason"
                  :class="{ 'loop-narrative': activity.kind === 'narrative' }"
                >
                  {{ loopActivityDetail(activity, t) }}
                </div>
                <div
                  v-if="
                    activity.kind === 'evidence' &&
                    expandedLoopActivities[activity.activityId] &&
                    activity.questions?.length
                  "
                  class="tree-questions"
                >
                  <div
                    v-for="question in activity.questions"
                    :key="question.questionId"
                    class="tree-question"
                    :class="{
                      done: question.status === 'completed',
                      running: question.status === 'running',
                      failed: question.status === 'failed',
                      stopped: question.status === 'cancelled',
                    }"
                  >
                    <div class="tree-q-status">
                      <CheckCircle2 v-if="question.status === 'completed'" :size="10" />
                      <Zap v-else-if="question.status === 'running'" :size="10" class="spin" />
                      <CircleSlash v-else :size="10" />
                    </div>
                    <span class="tree-q-text">{{ question.question }}</span>
                    <span
                      class="tree-q-status-text"
                      :class="{ error: question.status === 'failed' }"
                    >
                      {{ loopQuestionStatusText(question, t) }}
                    </span>
                    <QueryExecutionView
                      v-if="question.execution"
                      class="loop-query-execution"
                      :facts="question.execution as QueryExecutionFacts"
                    />
                  </div>
                </div>
                <div
                  v-if="activity.kind === 'dispatch' && expandedLoopActivities[activity.activityId]"
                  class="loop-dispatch-detail"
                >
                  <div class="loop-detail-field">
                    <span>{{ t("analysis.loopDispatchTopic") }}</span>
                    <p>{{ activity.topic || "-" }}</p>
                  </div>
                  <div v-if="activity.workerSummary" class="loop-detail-field">
                    <span>{{ t("analysis.loopDispatchSummary") }}</span>
                    <p>{{ activity.workerSummary }}</p>
                  </div>
                  <button
                    v-if="activity.status !== 'running' && task?.id"
                    type="button"
                    class="loop-trace-toggle"
                    :aria-expanded="!!subagentTraceStates[activity.activityId]?.expanded"
                    :disabled="subagentTraceStates[activity.activityId]?.loading"
                    @click.stop="toggleSubagentTrace(activity.activityId)"
                  >
                    <Loader2
                      v-if="subagentTraceStates[activity.activityId]?.loading"
                      class="spin"
                      :size="13"
                    />
                    <ChevronDown
                      v-else-if="subagentTraceStates[activity.activityId]?.expanded"
                      :size="13"
                    />
                    <ChevronRight v-else :size="13" />
                    {{
                      subagentTraceStates[activity.activityId]?.expanded
                        ? t("common.collapse")
                        : t("common.view")
                    }}
                    {{ t("analysis.loopWorkerTrace") }}
                  </button>
                  <div
                    v-if="subagentTraceStates[activity.activityId]?.expanded"
                    class="message-trace-list"
                  >
                    <div
                      v-if="subagentTraceStates[activity.activityId]?.error"
                      class="loop-trace-error"
                    >
                      {{ t("analysis.loopWorkerTraceLoadFailed") }}
                    </div>
                    <div
                      v-else-if="subagentTraceStates[activity.activityId]?.trace?.error"
                      class="loop-trace-error"
                    >
                      {{ subagentTraceStates[activity.activityId]?.trace?.error }}
                    </div>
                    <div
                      v-else-if="
                        !subagentTraceStates[activity.activityId]?.loading &&
                        !subagentTraceStates[activity.activityId]?.trace?.messages.length
                      "
                      class="loop-trace-empty"
                    >
                      {{ t("common.noData") }}
                    </div>
                    <AgentMessageTrace
                      v-if="subagentTraceStates[activity.activityId]?.trace?.messages.length"
                      :messages="subagentTraceStates[activity.activityId]?.trace?.messages || []"
                      variant="worker"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Step cards -->
          <div v-if="showStepCards(group.payload)" class="analysis-steps">
            <div v-for="(step, i) in analysisSteps(group.payload)" :key="i" class="step-card">
              <div class="step-card-header">
                <div class="step-icon" :class="step.status">
                  <CheckCircle2 v-if="step.status === 'done'" :size="12" />
                  <Zap v-else-if="step.status === 'active'" :size="12" />
                  <CircleSlash v-else-if="step.status === 'stopped'" :size="12" />
                  <Clock v-else :size="12" />
                </div>
                <span class="step-name" :class="step.status">
                  {{ step.name }}
                  <template v-if="step.status === 'done'">— {{ t("analysis.completed") }}</template>
                  <template v-if="step.status === 'active'">
                    — {{ t("common.inProgress") }}
                  </template>
                  <template v-if="step.status === 'stopped'">
                    — {{ t("analysis.analysisStopped") }}
                  </template>
                </span>
              </div>
              <div class="step-detail">{{ step.detail }}</div>
            </div>

            <!-- Keep the original compact progress list while analysis is running. -->
            <div
              v-if="thinkingTree(group.payload).length > 0 && !hasCompletedAnalysis(group.payload)"
              class="thinking-tree"
            >
              <div
                v-for="(dim, di) in thinkingTree(group.payload)"
                :key="dim.dimensionId || di"
                class="tree-dimension"
              >
                <div class="tree-dim-header">
                  <div
                    class="tree-dim-icon"
                    :class="{
                      done: dim.status === 'completed',
                      running: dim.status === 'running',
                      stopped: dim.status === 'stopped',
                    }"
                  >
                    <CheckCircle2 v-if="dim.status === 'completed'" :size="12" />
                    <Zap v-else-if="dim.status === 'running'" :size="12" />
                    <CircleSlash v-else-if="dim.status === 'stopped'" :size="12" />
                    <Clock v-else :size="12" />
                  </div>
                  <span class="tree-dim-name">{{ di + 1 }}. {{ dim.dimName }}</span>
                </div>
                <div v-if="dim.reason" class="tree-dim-reason">{{ dim.reason }}</div>
                <div v-if="dim.questions?.length" class="tree-questions">
                  <div
                    v-for="(q, qi) in dim.questions"
                    :key="q.id || qi"
                    class="tree-question"
                    :class="{
                      done: q.status === 'completed',
                      running: q.status === 'running',
                      failed: q.status === 'failed',
                      stopped: q.status === 'stopped',
                    }"
                  >
                    <div class="tree-q-status">
                      <CheckCircle2 v-if="q.status === 'completed'" :size="10" />
                      <Zap v-else-if="q.status === 'running'" :size="10" class="spin" />
                      <CircleSlash v-else-if="q.status === 'stopped'" :size="10" />
                      <Clock v-else :size="10" />
                    </div>
                    <span class="tree-q-text">{{ q.text }}</span>
                    <span
                      v-if="q.statusText"
                      class="tree-q-status-text"
                      :class="{ error: q.status === 'failed' }"
                    >
                      {{ q.statusText }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <DeepAnalysisResult
              v-if="thinkingTree(group.payload).length > 0 && hasCompletedAnalysis(group.payload)"
              :key="task?.id || streamingSnapshot?.runId || 'analysis'"
              class="chat-provenance-result"
              :activities="loopActivities(group.payload)"
              :run-state="group.payload?.runState"
              :archived="!group.streaming"
              :compact="true"
            />
          </div>

          <div v-if="groupAnswer(group)" class="chat-msg assistant">
            <div class="chat-bubble assistant">
              <div class="markdown-body" v-html="renderMarkdown(groupAnswer(group))"></div>
            </div>
          </div>

          <!-- This turn's public messages and tool results: only show egress-filtered messages, with expansion state independent per turn -->
          <div v-if="group.trace.length" class="message-trace-list">
            <button
              type="button"
              class="loop-trace-toggle"
              :aria-expanded="!!expandedTurnTraces[group.key]"
              @click="toggleTurnTrace(group.key)"
            >
              <ChevronDown v-if="expandedTurnTraces[group.key]" :size="13" />
              <ChevronRight v-else :size="13" />
              {{ t("harness.messagesAndTools") }}
            </button>
            <AgentMessageTrace
              v-if="expandedTurnTraces[group.key]"
              :messages="group.trace"
              variant="turn"
            />
          </div>

          <!-- Follow-up turn streaming tail: show the typing cursor while the body is still growing -->
          <div v-if="group.streaming && group.streamingText !== ''" class="chat-msg assistant">
            <div class="chat-bubble assistant streaming">
              <div class="markdown-body" v-html="renderMarkdown(group.streamingText)"></div>
              <span class="typing-cursor">|</span>
            </div>
          </div>

          <!-- Diagnosis entry after the turn closes; same form as the Q&A reply actions -->
          <TurnDiagnoseButton
            v-if="group.assistant?.snapshot"
            class="ui-icon-btn turn-diagnose-btn"
            :turn="group.assistant.snapshot"
          />
          <!-- Completed notice: only prompt once after the last turn closes -->
          <div
            v-if="gi === turnGroups.length - 1 && hasCompletedAnalysis(group.payload)"
            class="chat-msg system"
          >
            <div class="chat-bubble system completed-notice">
              <div class="completed-icon-wrapper">
                <CheckCircle2 :size="16" />
              </div>
              <span>
                {{ t("analysis.analysisDoneHint") }}
              </span>
            </div>
          </div>

          <!-- Stopped notice -->
          <div
            v-if="gi === turnGroups.length - 1 && isStoppedAnalysis(group.payload)"
            class="chat-msg system"
          >
            <div class="chat-bubble system stopped-notice">
              <div class="stopped-icon-wrapper">
                <CircleSlash :size="16" />
              </div>
              <span>
                {{ t("analysis.analysisStoppedHint") }}
              </span>
            </div>
          </div>
        </template>

        <!-- Scheduled task notice -->
        <div
          v-if="
            messages.length === 0 && !isLoading && !streamingSnapshot && task?.status === 'pending'
          "
          class="chat-msg system"
        >
          <div class="chat-bubble system scheduled-notice">
            <div class="scheduled-icon-wrapper">
              <Clock :size="16" />
            </div>
            <span>
              {{ t("analysis.scheduledTaskHint") }}
              <br />
              {{ t("analysis.scheduledLastResult") }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.analysis-chat-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: color-mix(in srgb, var(--el-bg-color) 30%, var(--el-bg-color-page) 70%);
}

.chat-empty {
  flex: 1;
  width: 100%;
}

.ai-skeleton {
  width: 100%;
  padding: 40px;
}

.messages-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.messages-inner {
  padding: 20px 24px 0;
}

.turn-diagnose-btn {
  display: flex;
  margin: -6px 0 16px;
  border-radius: 10px;
}

.turn-diagnose-btn:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}

.chat-msg {
  margin-bottom: 16px;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.chat-msg.user {
  display: flex;
  justify-content: flex-end;
}

.run-switcher-row {
  display: flex;
  justify-content: flex-end;
  margin: -10px 4px 10px 0;
}

.run-switcher {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.run-switcher .run-index {
  line-height: 28px;
}

.run-switcher button {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: 18px;
  line-height: 24px;
  cursor: pointer;
}

.run-switcher button:hover:not(:disabled) {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.run-switcher button:disabled {
  opacity: 0.3;
  cursor: default;
}

.chat-msg.system {
  display: flex;
  justify-content: flex-start;
}

.chat-bubble {
  max-width: 85%;
  padding: 12px 16px;
  border-radius: 14px;
  font-size: 13px;
  line-height: 1.6;
}

.chat-bubble.system {
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  border: 1px solid var(--el-border-color);
  border-radius: 18px;
  box-shadow: var(--shadow-card);
}

.chat-bubble.user {
  background: var(--el-color-primary);
  color: var(--on-primary);
  border-radius: 14px 14px 4px 14px;
}

.streaming-text,
.summary-text {
  white-space: pre-wrap;
  word-break: break-word;
}

/* Step Cards */
.analysis-steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.step-card {
  background: var(--el-bg-color);
  border-radius: 18px;
  padding: 14px 16px;
  border: 1px solid var(--el-border-color);
  box-shadow: var(--shadow-card);
  transition: all 0.3s ease;
}

.step-card:hover {
  border-color: var(--el-border-color-dark);
  box-shadow: var(--shadow-card-hover);
}

.step-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.step-icon {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.step-icon.done {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}

.step-icon.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  animation: breathe 2s ease-in-out infinite;
}

.step-icon.pending {
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
}
.step-icon.stopped {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
}

@keyframes breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.step-name {
  font-size: 13px;
  font-weight: 600;
}

.step-name.done {
  color: var(--el-color-success);
}

.step-name.active {
  color: var(--el-color-primary);
}

.step-name.pending {
  color: var(--el-text-color-secondary);
}
.step-name.stopped {
  color: var(--el-color-warning);
}

.step-detail {
  font-size: 12px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
  padding-left: 30px;
}

/* Thinking Tree */
.thinking-tree {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.chat-provenance-result {
  margin-bottom: 16px;
}

.chat-provenance-result :deep(.thinking-header) {
  display: none;
}

.chat-provenance-result :deep(.thinking-tree) {
  background: transparent;
  border: none;
}

.chat-provenance-result :deep(.tree-container) {
  gap: 10px;
}

.tree-dimension {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 18px;
  padding: 12px 14px;
  box-shadow: var(--shadow-card);
}

.tree-dim-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.loop-activity-header {
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.loop-activity-header:disabled {
  cursor: default;
}

.loop-activity-header:focus-visible,
.loop-trace-toggle:focus-visible {
  outline: 2px solid var(--el-color-primary-light-3);
  outline-offset: 3px;
}

.loop-expand-icon {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--el-text-color-secondary);
}

.tree-dim-icon {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tree-dim-icon.done {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}
.tree-dim-icon.running {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.tree-dim-icon.stopped {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
}
.tree-dim-icon.failed {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
.tree-dim-icon {
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
}

.tree-dim-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.tree-dim-reason {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
  padding-left: 28px;
}

.loop-narrative {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--el-text-color-regular);
}

.tree-questions {
  margin-top: 8px;
  padding-left: 28px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tree-question {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
}

.loop-query-execution {
  flex-basis: 100%;
  min-width: 0;
  margin: 4px 0 2px 22px;
}

.tree-q-status {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.tree-q-status :deep(svg) {
  color: var(--el-text-color-secondary);
}

.tree-question.done .tree-q-status :deep(svg) {
  color: var(--el-color-success);
}
.tree-question.running .tree-q-status :deep(svg) {
  color: var(--el-color-primary);
}
.tree-question.failed .tree-q-status :deep(svg) {
  color: var(--el-color-danger);
}

.tree-q-text {
  color: var(--el-text-color-regular);
  flex: 1;
}

.tree-question.done .tree-q-text {
  color: var(--el-color-success);
}
.tree-question.running .tree-q-text {
  color: var(--el-color-primary);
  font-weight: 500;
}
.tree-question.failed .tree-q-text {
  color: var(--el-color-danger);
}
.tree-question.stopped .tree-q-status :deep(svg) {
  color: var(--el-color-warning);
}
.tree-question.stopped .tree-q-text {
  color: var(--el-color-warning);
}

.tree-q-status-text {
  font-size: 10px;
  color: var(--el-text-color-secondary);
}

.tree-q-status-text.error {
  color: var(--el-color-danger);
}

.loop-dispatch-detail {
  margin: 10px 0 0 28px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-extra-light);
}

.loop-detail-field + .loop-detail-field {
  margin-top: 8px;
}

.loop-detail-field > span {
  font-size: 11px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.loop-detail-field > p {
  margin: 2px 0 0;
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.loop-trace-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  margin-top: 8px;
  padding: 4px 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 7px;
  background: var(--el-bg-color);
  color: var(--el-color-primary);
  font-size: 12px;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease;
}

.loop-trace-toggle:hover:not(:disabled) {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}

.loop-trace-toggle:disabled {
  cursor: wait;
  opacity: 0.72;
}

.message-trace-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.loop-trace-error,
.loop-trace-empty {
  padding: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.loop-trace-error {
  color: var(--el-color-danger);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Bar chart in step */
.step-chart {
  margin-top: 10px;
  margin-left: 30px;
  background: var(--el-bg-color);
  border-radius: 10px;
  padding: 12px 16px;
  border: 1px solid var(--el-border-color);
}

.bar-chart {
  display: flex;
  align-items: flex-end;
  justify-content: space-around;
  height: 120px;
  gap: 8px;
}

.bar-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: 1;
}

.bar {
  width: 100%;
  max-width: 40px;
  border-radius: 6px 6px 0 0;
  transition: height 0.6s ease;
  min-height: 4px;
}

.bar-label {
  font-size: 9px;
  color: var(--el-text-color-secondary);
  font-weight: 500;
}

.bar-value {
  font-size: 8px;
  color: var(--el-text-color-secondary);
}

/* Completed notice */
.completed-notice,
.scheduled-notice,
.stopped-notice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.completed-icon-wrapper {
  color: var(--el-color-success);
  flex-shrink: 0;
  margin-top: 1px;
}

.stopped-icon-wrapper {
  color: var(--el-color-warning);
  flex-shrink: 0;
  margin-top: 1px;
}

.scheduled-icon-wrapper {
  color: var(--el-color-warning);
  flex-shrink: 0;
  margin-top: 1px;
}

.follow-up-section {
  margin-top: 24px;
}

.follow-up-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.follow-up-divider::before,
.follow-up-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--el-border-color-light);
}

.follow-up-pair {
  margin-bottom: 16px;
}

.follow-up-pair .chat-bubble.user {
  margin-bottom: 8px;
}

.chat-bubble.assistant {
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
  padding: 12px 16px;
  font-size: 14px;
  line-height: 1.7;
  max-width: 85%;
  align-self: flex-start;
  box-shadow: var(--shadow-card);
}

.chat-bubble.assistant :deep(.markdown-body) {
  font-size: 14px;
  line-height: 1.7;
}

.chat-bubble.assistant :deep(.markdown-body p) {
  margin: 0 0 8px;
}

.chat-bubble.assistant :deep(.markdown-body p:last-child) {
  margin-bottom: 0;
}

.chat-bubble.assistant :deep(.markdown-body code) {
  background: var(--el-fill-color);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 13px;
}

.chat-bubble.assistant :deep(.markdown-body pre) {
  background: var(--el-fill-color);
  padding: 8px 12px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 13px;
  margin: 8px 0;
}

.chat-bubble.assistant :deep(.markdown-body pre code) {
  background: none;
  padding: 0;
}

.chat-bubble.assistant.streaming {
  border-color: var(--el-color-primary-light-3);
}

.typing-cursor {
  display: inline-block;
  animation: blink 1s step-end infinite;
  color: var(--el-color-primary);
  font-weight: bold;
}

@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

.streaming-dots {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
}

.streaming-dots span {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--el-color-primary) 72%, white 28%);
  opacity: 0.24;
  animation: streaming-glow 1.2s ease-in-out infinite;
}

.streaming-dots span:nth-child(2) {
  animation-delay: 0.18s;
}

.streaming-dots span:nth-child(3) {
  animation-delay: 0.36s;
}

@keyframes streaming-glow {
  0%,
  80%,
  100% {
    opacity: 0.24;
    background: color-mix(in srgb, var(--el-color-primary) 68%, white 32%);
    box-shadow: 0 0 0 rgba(37, 99, 235, 0);
  }
  40% {
    opacity: 1;
    background: var(--el-color-primary);
    box-shadow: 0 0 10px rgba(37, 99, 235, 0.32);
  }
}

.messages-scroll::-webkit-scrollbar {
  width: 4px;
}

.messages-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.messages-scroll::-webkit-scrollbar-thumb {
  background: var(--el-border-color-dark);
  border-radius: 4px;
}

.messages-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--el-text-color-secondary);
}
@media (max-width: 700px) {
  :where(html.workbench-mobile-navigation) .messages-inner {
    padding: 12px 10px 0;
  }
  :where(html.workbench-mobile-navigation) .ai-skeleton {
    padding: 20px 12px;
  }
  :where(html.workbench-mobile-navigation) .chat-msg {
    margin-bottom: 12px;
  }
  :where(html.workbench-mobile-navigation) .chat-bubble {
    max-width: 94%;
    padding: 10px 12px;
  }
  :where(html.workbench-mobile-navigation) .chat-bubble.system {
    border-radius: 14px;
  }
  :where(html.workbench-mobile-navigation) .analysis-steps {
    gap: 8px;
  }
  :where(html.workbench-mobile-navigation) .step-card {
    padding: 12px;
    border-radius: 14px;
  }
  :where(html.workbench-mobile-navigation) .run-switcher-row {
    margin-right: 0;
  }
}
</style>
