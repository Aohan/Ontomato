<script setup lang="ts">
import type { ThinkingBranchCard } from "@ontomato/contracts/query-thinking";
import type { ThinkingProgress, ThinkingStep } from "@ontomato/contracts/query-thinking";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  MinusCircle,
  Eye,
} from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import HotCardModal from "./thinking/HotCardModal.vue";
import MessageContent from "./MessageContent/index.vue";
import type {
  QueryThinkingState,
  QueryThinkingAbcStep,
  QueryThinkingBranch,
} from "../../../types/chat";
import { useI18n } from "vue-i18n";
import { truncateErrorForDisplay } from "../utils/display-error";

const { t } = useI18n();

const props = defineProps<{
  content: string;
  steps?: ThinkingStep[];
  thinkingState?: QueryThinkingState | null;
  progress?: ThinkingProgress | null;
  defaultExpanded?: boolean;
  branchKey?: string;
}>();

const isExpanded = ref(props.defaultExpanded ?? true);

watch(
  () => props.defaultExpanded,
  (defaultExpanded) => {
    if (typeof defaultExpanded === "boolean") {
      isExpanded.value = defaultExpanded;
    }
  }
);

const modalVisible = ref(false);
const modalBranchLabel = ref("");
const modalCards = ref<ThinkingBranchCard[]>([]);

const branchStatusLabel: Record<string, string> = {
  idle: t("thinking.notStarted"),
  running: t("thinking.processing"),
  success: t("thinking.hit"),
  insufficient: t("thinking.partialHit"),
  not_found: t("thinking.miss"),
  failed: t("common.failed"),
  cancelled: t("task.cancelled"),
  stopped: t("common.stopped"),
};

function getStepLabel(step: { key: string; label: string }): string {
  if (step.key && step.key in abcStageLabel) {
    return abcStageLabel[step.key];
  }
  return step.label;
}

const abcStageLabel: Record<string, string> = {
  split: t("thinking.abcStage.split"),
  abc_analysis: t("thinking.abcStage.abc_analysis"),
  data: t("thinking.abcStage.data"),
  conclusion: t("thinking.abcStage.conclusion"),
};

function openModal(branch: { key: string; cards?: ThinkingBranchCard[]; label: string }) {
  if (!branch.cards?.length) return;
  modalBranchLabel.value = branch.label;
  modalCards.value = branch.cards;
  modalVisible.value = true;
}

function closeModal() {
  modalVisible.value = false;
  modalCards.value = [];
}

function hasHitCards(branch: { status: string; cards?: ThinkingBranchCard[] }): boolean {
  return (
    (branch.status === "success" || branch.status === "insufficient") && !!branch.cards?.length
  );
}

function formatBranchDetail(branch: QueryThinkingBranch): string {
  if (!branch.detail) return "";
  return branch.status === "failed" ? truncateErrorForDisplay(branch.detail) : branch.detail;
}

function formatBranchLog(branch: QueryThinkingBranch, log: string): string {
  return branch.status === "failed" ? truncateErrorForDisplay(log) : log;
}

function formatStepDetail(step: QueryThinkingAbcStep): string {
  if (!step.detail) return "";
  return step.status === "failed" ? truncateErrorForDisplay(step.detail) : step.detail;
}

const fallbackLines = computed(() =>
  props.content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
);

const effectiveSteps = computed<QueryThinkingAbcStep[]>(() => {
  if (props.thinkingState?.abc?.steps?.length) return props.thinkingState.abc.steps;
  if (props.thinkingState?.branches?.length) return [];
  return (props.steps || []).map((step, i) => ({
    ...step,
    key: `fallback-${i}`,
    label: step.text,
    status: (step.done ? "done" : "waiting") as QueryThinkingAbcStep["status"],
  }));
});

const branchContent = computed(() => {
  const branches = props.thinkingState?.branches || [];
  const key = props.branchKey || props.thinkingState?.winner || "abc";
  const branch = branches.find((item) => item.key === key);
  if (branch?.content) return branch.content;

  const abcBranch = branches.find((item) => item.key === "abc");
  if (!abcBranch?.content) return "";
  if (props.thinkingState?.winner && props.thinkingState.winner !== "abc" && !props.branchKey)
    return "";
  return abcBranch.content;
});

const panelTitle = computed(() => {
  if (props.thinkingState?.winner === "abc") return t("thinking.queryProcess");
  if (props.thinkingState?.winner) return t("thinking.retrievalProcess");
  if (props.thinkingState?.abc?.steps?.length && !props.thinkingState?.branches?.length)
    return t("thinking.visualizationProcess");
  return t("thinking.thinkingProcess");
});

const stepsSectionTitle = computed(() => {
  if (!props.thinkingState?.branches?.length) return t("thinking.executionSteps");
  return t("thinking.abcExecution");
});

const getStepIcon = (status?: string) => {
  if (status === "done") return CheckCircle2;
  if (status === "running") return Loader2;
  if (status === "stopped" || status === "cancelled") return MinusCircle;
  if (status === "failed") return XCircle;
  return Circle;
};

const getBranchIcon = (status: string) => {
  if (status === "success") return CheckCircle2;
  if (status === "running") return Loader2;
  if (status === "failed") return XCircle;
  if (
    status === "cancelled" ||
    status === "insufficient" ||
    status === "not_found" ||
    status === "stopped"
  )
    return MinusCircle;
  return Circle;
};
</script>

<template>
  <div v-if="content || thinkingState" class="thinking-panel">
    <div class="thinking-header" @click="isExpanded = !isExpanded">
      <div class="header-left">
        <div class="thinking-icon-wrapper"><Brain :size="16" class="thinking-icon" /></div>
        <div class="header-text">
          <span class="thinking-title">{{ panelTitle }}</span>
          <span v-if="thinkingState?.headline" class="thinking-headline">
            {{ thinkingState.headline }}
          </span>
        </div>
      </div>
      <button class="expand-btn">
        <ChevronDown v-if="isExpanded" :size="16" />
        <ChevronRight v-else :size="16" />
      </button>
    </div>

    <Transition name="expand">
      <div v-if="isExpanded" class="thinking-body">
        <template v-if="thinkingState">
          <section v-if="thinkingState.branches?.length" class="thinking-section">
            <div class="section-title">{{ t("thinking.pathSelection") }}</div>
            <div class="branch-list">
              <div
                v-for="branch in thinkingState.branches.filter((item) => item.status !== 'idle')"
                :key="branch.key"
                class="branch-card"
                :class="[branch.status, { winner: branch.winner, clickable: hasHitCards(branch) }]"
              >
                <div class="branch-main">
                  <span class="branch-icon">
                    <component
                      :is="getBranchIcon(branch.status)"
                      :size="15"
                      :class="branch.status"
                    />
                  </span>
                  <div class="branch-copy">
                    <div class="branch-topline">
                      <span class="branch-label">{{ branch.label }}</span>
                      <span class="branch-status" :class="branch.status">
                        {{ branchStatusLabel[branch.status] }}
                      </span>
                      <button
                        v-if="hasHitCards(branch)"
                        class="view-btn"
                        :title="t('thinking.viewCard')"
                        :class="{ active: modalVisible }"
                        @click.stop="openModal(branch)"
                      >
                        <Eye :size="13" />
                        <span>{{ t("common.view") }}</span>
                      </button>
                    </div>
                    <div v-if="formatBranchDetail(branch)" class="branch-detail">
                      {{ formatBranchDetail(branch) }}
                    </div>
                    <div v-if="branch.logs?.length" class="branch-logs">
                      <div v-for="(log, index) in branch.logs" :key="index" class="branch-log">
                        {{ formatBranchLog(branch, log) }}
                      </div>
                    </div>
                  </div>
                  <span v-if="branch.winner" class="winner-tag">{{ t("thinking.adopted") }}</span>
                </div>
              </div>
            </div>
          </section>

          <section v-if="effectiveSteps.length" class="thinking-section">
            <div class="section-title">{{ stepsSectionTitle }}</div>
            <div class="step-list">
              <div
                v-for="step in effectiveSteps"
                :key="`${step.key}-${step.timestamp}`"
                class="step-item"
                :class="step.status || (step.done ? 'done' : 'waiting')"
              >
                <span class="step-icon">
                  <component
                    :is="getStepIcon(step.status || (step.done ? 'done' : 'waiting'))"
                    :size="15"
                    :class="step.status || (step.done ? 'done' : 'waiting')"
                  />
                </span>
                <div class="step-copy">
                  <div class="step-title-row">
                    <span class="step-title">{{ getStepLabel(step) }}</span>
                    <span v-if="step.active && step.status === 'running'" class="step-active">
                      {{ t("common.inProgress") }}
                    </span>
                  </div>
                  <div v-if="formatStepDetail(step)" class="step-detail">
                    {{ formatStepDetail(step) }}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section v-if="branchContent" class="thinking-section compact">
            <div class="section-title">{{ t("common.detail") }}</div>
            <div class="branch-content">
              <MessageContent :content="branchContent" />
            </div>
          </section>

          <section v-if="thinkingState.tailLines?.length" class="thinking-section compact">
            <div class="section-title">{{ t("common.result") }}</div>
            <div class="tail-list">
              <div v-for="(line, index) in thinkingState.tailLines" :key="index" class="tail-line">
                {{ line }}
              </div>
            </div>
          </section>
        </template>
        <template v-else>
          <div v-for="(line, idx) in fallbackLines" :key="idx" class="fallback-line">
            {{ line }}
          </div>
        </template>
      </div>
    </Transition>

    <HotCardModal
      :visible="modalVisible"
      :branch-label="modalBranchLabel"
      :cards="modalCards"
      @close="closeModal"
    />
  </div>
</template>

<style scoped>
.thinking-panel {
  margin-bottom: 16px;
  border-radius: 18px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}
.thinking-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--el-color-primary) 4%, transparent) 0%,
    transparent 100%
  );
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: pointer;
  user-select: none;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.thinking-icon-wrapper {
  width: 30px;
  height: 30px;
  border-radius: 10px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--el-color-primary) 10%, transparent) 0%,
    color-mix(in srgb, var(--el-color-primary) 4%, transparent) 100%
  );
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-color-primary);
}
.thinking-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.thinking-headline {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.expand-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-placeholder);
}
.thinking-body {
  padding: 16px;
  display: grid;
  gap: 18px;
}
.thinking-section {
  display: grid;
  gap: 12px;
}
.thinking-section.compact {
  gap: 8px;
}
.section-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
  letter-spacing: 0.04em;
}
.branch-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.branch-card:last-child:nth-child(odd) {
  grid-column: 1 / -1;
}
.step-list,
.tail-list {
  display: grid;
  gap: 10px;
}
.branch-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-fill-color-extra-light);
  padding: 12px;
}
.branch-card.winner:not(.success) {
  border-color: color-mix(in srgb, var(--el-color-success) 35%, transparent);
  background: color-mix(in srgb, var(--el-color-success) 6%, transparent);
}
.branch-card.success {
  border-color: color-mix(in srgb, var(--el-color-success) 28%, transparent);
  background: color-mix(in srgb, var(--el-color-success) 5%, transparent);
}
.branch-card.running {
  border-color: color-mix(in srgb, var(--el-color-primary) 20%, transparent);
}
.branch-main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.branch-copy {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 6px;
}
.branch-topline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.branch-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.branch-status,
.winner-tag,
.step-active {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
}
.branch-status.success {
  background: color-mix(in srgb, var(--el-color-success) 12%, transparent);
  color: var(--el-color-success);
}
.branch-status.running {
  background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
  color: var(--el-color-primary);
}
.branch-status.failed {
  background: color-mix(in srgb, var(--el-color-danger) 10%, transparent);
  color: var(--el-color-danger);
}
.winner-tag {
  background: color-mix(in srgb, var(--el-color-success) 12%, transparent);
  color: var(--el-color-success);
}
.step-active {
  background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
  color: var(--el-color-primary);
}
.branch-detail,
.branch-log,
.step-detail,
.tail-line,
.fallback-line {
  font-size: 13px;
  line-height: 1.65;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
  word-break: break-word;
}
.branch-logs {
  display: grid;
  gap: 4px;
}
.branch-log {
  color: var(--el-text-color-secondary);
}
.branch-content {
  min-width: 0;
}
.step-item {
  position: relative;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-fill-color-extra-light);
}
.step-icon,
.branch-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
}
.step-copy {
  min-width: 0;
  display: grid;
  gap: 4px;
}
.step-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.step-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.done {
  color: var(--el-color-success);
}
.running {
  color: var(--el-color-primary);
}
.failed {
  color: var(--el-color-danger);
}
.waiting,
.insufficient,
.not_found,
.cancelled {
  color: var(--el-text-color-placeholder);
}
.step-item.running :deep(svg),
.branch-icon .running {
  animation: spin 1s linear infinite;
}

@media (min-width: 768px) {
  .step-list {
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  }
  .step-item {
    height: 100%;
  }
}

.expand-enter-active,
.expand-leave-active {
  transition: all 0.25s ease;
  overflow: hidden;
}
.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
}
.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 960px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.view-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 400;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.view-btn:hover,
.view-btn.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  border-color: var(--el-color-primary-light-5);
}

@media (max-width: 768px) {
  .thinking-header {
    align-items: flex-start;
  }
  .thinking-body {
    padding: 14px;
  }
  .step-list {
    gap: 10px;
  }
  .step-item {
    padding: 10px 12px;
  }
}
</style>
