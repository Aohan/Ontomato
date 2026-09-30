<script setup lang="ts">
import type { FeedbackRating } from "@ontomato/contracts/feedback";
import type { AnalysisReportSummaryPosition } from "@ontomato/contracts/analysis-agent";

import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  type ComponentPublicInstance,
} from "vue";
import { storeToRefs } from "pinia";
import { useAnalysisStore } from "../stores/analysis";
import { ElMessage, ElMessageBox } from "element-plus";
import { LoaderCircle, ThumbsUp, ThumbsDown } from "lucide-vue-next";
import { renderMarkdown } from "../../../utils/markdown";
import { analysisAgentApi } from "../api";
import { feedbackApi } from "../../../api/feedback";
import { skillsApi, type AnalysisSkill } from "../../skills/api";
import { formatRelativeTime } from "../../../utils/relative-time";
import { useI18n } from "vue-i18n";
import { withSkillResourceCredentials } from "../../skills/utils/skill-resource";
import {
  joinReportSections,
  orderReportSections,
  updateParsedReportContent,
  type ParsedReportContent,
  type ReportContentPart,
} from "../../../utils/analysis-report";
import { workbenchContent } from "../../../content";

const feedbackCopy = workbenchContent().text.feedback;

const { t } = useI18n();

const reportContentRef = ref<HTMLElement | null>(null);
let lastScrollTop = 0;
let userScrolledUp = false;

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function scrollToBottom() {
  const parent = reportContentRef.value?.closest(".report-body") as HTMLElement | null;
  if (parent) {
    parent.scrollTop = parent.scrollHeight;
  }
}

function onReportScroll() {
  const parent = reportContentRef.value?.closest(".report-body") as HTMLElement | null;
  if (!parent) return;
  if (parent.scrollTop < lastScrollTop) {
    userScrolledUp = true;
  }
  if (isNearBottom(parent)) {
    userScrolledUp = false;
  }
  lastScrollTop = parent.scrollTop;
}

const formatReportTime = (ts?: number) => formatRelativeTime(ts, { showYear: true });

const {
  agents,
  currentTask: task,
  activeSession,
  reportSections: sections,
  isStreamingReport,
  taskProgressMap,
} = storeToRefs(useAnalysisStore());
const isStreaming = computed(() => isStreamingReport.value && !!activeSession.value?.isLoading);
const taskProgress = computed(() =>
  task.value ? taskProgressMap.value[task.value.id] : undefined
);

const summaryPosition = ref<AnalysisReportSummaryPosition>("bottom");
const displaySections = computed(() => orderReportSections(sections.value, summaryPosition.value));
const displayContent = computed(() => joinReportSections(displaySections.value));

watch(
  () => {
    const agentId = task.value?.agentId;
    return agents.value.find((agent) => agent.id === agentId)?.summaryPosition;
  },
  (position) => {
    summaryPosition.value = position === "top" ? "top" : "bottom";
  },
  { immediate: true }
);

const feedbackState = ref<FeedbackRating | null>(null);
const referencedSkills = ref<AnalysisSkill[]>([]);
async function loadReferencedSkills() {
  referencedSkills.value = [];
  summaryPosition.value = "bottom";
  const taskId = task.value?.id;
  const agentId = task.value?.agentId;
  if (!agentId) return;

  const [agentResult, skillsResult] = await Promise.allSettled([
    analysisAgentApi.getAgent(agentId),
    skillsApi.listAnalysisSkills(),
  ]);
  if (task.value?.id !== taskId) return;
  if (agentResult.status === "fulfilled") {
    const agent = agentResult.value;
    summaryPosition.value = agent.summaryPosition === "top" ? "top" : "bottom";
    if (skillsResult.status === "fulfilled") {
      const selectedIds = new Set(agent.enabledSkillIds || []);
      referencedSkills.value = skillsResult.value.filter((skill) => selectedIds.has(skill.id));
    }
  }
}

async function loadFeedbackState() {
  if (!task.value?.id) return;
  try {
    const data = await feedbackApi.state({
      sourceType: "analysis_task",
      taskId: task.value.id,
      targetIds: [task.value.id],
      limit: 20,
    });
    feedbackState.value = data.records[0]?.rating || null;
  } catch {
    // Feedback state is non-critical for viewing the report.
  }
}

async function submitFeedback(type: FeedbackRating) {
  if (!task.value || !displayContent.value.trim()) return;
  if (feedbackState.value === type) {
    try {
      await feedbackApi.cancel({
        sourceType: "analysis_task",
        targetId: task.value.id,
        taskId: task.value.id,
        threadId: task.value.threadId,
      });
      feedbackState.value = null;
      ElMessage.success(feedbackCopy.cancelled);
    } catch (error: any) {
      ElMessage.error(error?.message || feedbackCopy.cancelFailed);
    }
    return;
  }

  let feedbackText = "";
  if (type === "dislike") {
    try {
      const { value } = await ElMessageBox.prompt(
        feedbackCopy.promptMessage,
        feedbackCopy.promptTitle,
        {
          confirmButtonText: feedbackCopy.submit,
          cancelButtonText: feedbackCopy.cancel,
          inputType: "textarea",
          inputPlaceholder: feedbackCopy.analysisPlaceholder,
          inputValidator: (value) => !!String(value || "").trim() || feedbackCopy.required,
        }
      );
      feedbackText = String(value || "").trim();
    } catch {
      return;
    }
  }

  try {
    await feedbackApi.submit({
      sourceType: "analysis_task",
      targetId: task.value.id,
      taskId: task.value.id,
      threadId: task.value.threadId,
      rating: type,
      userInput: task.value.question || "",
      assistantOutput: displayContent.value,
      feedbackText,
      metadata: {
        taskName: task.value.name,
        taskStatus: task.value.status,
        view: "report",
      },
    });
    feedbackState.value = type;
    ElMessage.success(type === "like" ? feedbackCopy.thanks : feedbackCopy.submitted);
  } catch (error: any) {
    ElMessage.error(error?.message || feedbackCopy.submitFailed);
  }
}

watch(
  () => task.value?.id,
  () => {
    void loadFeedbackState();
    void loadReferencedSkills();
  },
  { immediate: true }
);

const chartContainers = new Map<string, HTMLElement>();
const loadedChartIds = ref<Set<string>>(new Set());

let chartObserver: IntersectionObserver | null = null;
let unloadObserver: IntersectionObserver | null = null;

interface RenderedReportSection {
  id: string;
  parts: ReportContentPart[];
}

const parsedSections = new Map<string, ParsedReportContent>();
const renderedSections = shallowRef<RenderedReportSection[]>([]);
let renderFrame: number | null = null;

function syncRenderedSections() {
  const activeSectionIds = new Set(displaySections.value.map((section) => section.id));

  for (const sectionId of parsedSections.keys()) {
    if (!activeSectionIds.has(sectionId)) parsedSections.delete(sectionId);
  }

  renderedSections.value = displaySections.value.map((section) => {
    const parsed = updateParsedReportContent(
      parsedSections.get(section.id),
      section.content,
      section.id,
      isStreaming.value
    );
    parsedSections.set(section.id, parsed);
    return { id: section.id, parts: parsed.parts };
  });
}

function cancelScheduledRender() {
  if (renderFrame === null || typeof window === "undefined") return;
  window.cancelAnimationFrame(renderFrame);
  renderFrame = null;
}

function scheduleRenderedSections() {
  if (
    !isStreaming.value ||
    typeof window === "undefined" ||
    typeof window.requestAnimationFrame !== "function"
  ) {
    cancelScheduledRender();
    syncRenderedSections();
    return;
  }

  if (renderFrame !== null) return;
  renderFrame = window.requestAnimationFrame(() => {
    renderFrame = null;
    syncRenderedSections();
  });
}

watch(
  () => ({ sections: displaySections.value, streaming: isStreaming.value }),
  scheduleRenderedSections,
  {
    immediate: true,
  }
);

const markdownCache = new Map<string, string>();
let markdownCacheLimit = 200;

function cachedRenderMarkdown(content: string): string {
  const cached = markdownCache.get(content);
  if (cached !== undefined) return cached;

  if (markdownCache.size >= markdownCacheLimit) {
    const firstKey = markdownCache.keys().next().value;
    if (firstKey !== undefined) markdownCache.delete(firstKey);
  }

  const rendered = renderMarkdown(content);
  markdownCache.set(content, rendered);
  return rendered;
}

const hasReport = computed(() => {
  return sections.value.some((section) => !!section.content) || isStreaming.value;
});

function markChartLoaded(chartId: string) {
  if (loadedChartIds.value.has(chartId)) return;
  const next = new Set(loadedChartIds.value);
  next.add(chartId);
  loadedChartIds.value = next;
}

function markChartUnloaded(chartId: string) {
  if (!loadedChartIds.value.has(chartId)) return;
  const next = new Set(loadedChartIds.value);
  next.delete(chartId);
  loadedChartIds.value = next;
}

function isChartLoaded(chartId: string) {
  return loadedChartIds.value.has(chartId);
}

const MAX_LOADED_CHARTS = 6;
const loadedChartOrder: string[] = [];

watch(
  () => task.value?.id,
  () => {
    cancelScheduledRender();
    parsedSections.clear();
    loadedChartIds.value = new Set();
    loadedChartOrder.length = 0;
    scheduleRenderedSections();
  }
);

function evictOldestLoadedChart() {
  while (loadedChartOrder.length > MAX_LOADED_CHARTS && loadedChartOrder.length > 0) {
    const toEvict = loadedChartOrder.shift()!;
    markChartUnloaded(toEvict);
  }
}

function promoteChartLoaded(chartId: string) {
  const idx = loadedChartOrder.indexOf(chartId);
  if (idx >= 0) {
    loadedChartOrder.splice(idx, 1);
  }
  loadedChartOrder.push(chartId);
  evictOldestLoadedChart();
}

function observeChartContainers() {
  if (!chartObserver) return;
  for (const [chartId, element] of chartContainers.entries()) {
    if (loadedChartIds.value.has(chartId)) continue;
    chartObserver.observe(element);
    unloadObserver?.observe(element);
  }
}

function setChartContainer(chartId: string, element: Element | ComponentPublicInstance | null) {
  if (element instanceof HTMLElement) {
    chartContainers.set(chartId, element);
    if (chartObserver && !loadedChartIds.value.has(chartId)) {
      chartObserver.observe(element);
      unloadObserver?.observe(element);
    }
    return;
  }

  const existing = chartContainers.get(chartId);
  if (existing && chartObserver) {
    chartObserver.unobserve(existing);
    unloadObserver?.unobserve(existing);
  }
  chartContainers.delete(chartId);
}

function collectChartIds(sections: readonly RenderedReportSection[]): string[] {
  return sections.flatMap((section) =>
    section.parts.flatMap((part) => (part.type === "chart" ? [part.id] : []))
  );
}

function setupChartObserver() {
  if (typeof window === "undefined") return;
  if (typeof window.IntersectionObserver === "undefined") {
    loadedChartIds.value = new Set(collectChartIds(renderedSections.value));
    return;
  }

  chartObserver?.disconnect();
  chartObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const chartId = (entry.target as HTMLElement).dataset.chartId;
        if (!chartId) continue;
        if (entry.isIntersecting) {
          markChartLoaded(chartId);
          promoteChartLoaded(chartId);
        }
      }
    },
    {
      rootMargin: "300px 0px",
      threshold: 0.01,
    }
  );

  unloadObserver?.disconnect();
  unloadObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const chartId = (entry.target as HTMLElement).dataset.chartId;
        if (!chartId) continue;
        if (!entry.isIntersecting) {
          markChartUnloaded(chartId);
        }
      }
    },
    {
      rootMargin: "800px 0px",
      threshold: 0,
    }
  );

  observeChartContainers();
}

watch(
  renderedSections,
  async (sections) => {
    const activeChartIds = new Set(collectChartIds(sections));
    loadedChartIds.value = new Set(
      [...loadedChartIds.value].filter((chartId) => activeChartIds.has(chartId))
    );
    for (const [chartId, element] of [...chartContainers.entries()]) {
      if (!activeChartIds.has(chartId)) {
        chartObserver?.unobserve(element);
        unloadObserver?.unobserve(element);
        chartContainers.delete(chartId);
      }
    }

    await nextTick();
    observeChartContainers();
    if (isStreaming.value && !userScrolledUp) scrollToBottom();
  },
  { flush: "post" }
);

onMounted(async () => {
  setupChartObserver();
  await nextTick();
  observeChartContainers();

  const parent = reportContentRef.value?.closest(".report-body") as HTMLElement | null;
  parent?.addEventListener("scroll", onReportScroll, { passive: true });
});

onUnmounted(() => {
  cancelScheduledRender();
  chartObserver?.disconnect();
  chartObserver = null;
  unloadObserver?.disconnect();
  unloadObserver = null;
  chartContainers.clear();
  parsedSections.clear();
  loadedChartOrder.length = 0;
  markdownCache.clear();

  const parent = reportContentRef.value?.closest(".report-body") as HTMLElement | null;
  parent?.removeEventListener("scroll", onReportScroll);
});
</script>

<template>
  <div class="analysis-report">
    <template v-if="hasReport">
      <div class="report-section report-header">
        <h2>{{ task?.name || t("hotData.analysisReport") }}</h2>
        <p class="report-meta">
          <span v-if="task?.createdAt">
            {{ t("analysis.reportCreated") }}{{ formatReportTime(task.createdAt) }}
          </span>
          <span v-if="task?.updatedAt">
            {{ t("analysis.reportUpdated") }}{{ formatReportTime(task.updatedAt) }}
          </span>
          <span v-if="task?.lastRunAt">
            {{ t("analysis.reportLastRun") }}{{ formatReportTime(task.lastRunAt) }}
          </span>
          <span v-if="isStreaming" class="streaming-badge">
            {{ t("analysis.reportGenerating") }}
          </span>
        </p>
        <div
          v-if="!isStreaming && task && displayContent && referencedSkills.length"
          class="report-referenced-skills"
        >
          <span class="referenced-skills-label">{{ t("analysis.referencedSkills") }}</span>
          <span
            v-for="skill in referencedSkills"
            :key="skill.id"
            class="referenced-skill"
            :title="skill.description || skill.id"
          >
            {{ skill.title || skill.id }}
          </span>
        </div>
      </div>

      <div ref="reportContentRef" class="report-section report-body-content">
        <template v-for="section in renderedSections" :key="section.id">
          <template v-for="part in section.parts" :key="part.id">
            <div
              v-if="part.type === 'text'"
              class="report-markdown"
              v-html="cachedRenderMarkdown(part.content)"
            ></div>
            <div
              v-else-if="part.type === 'chart'"
              :ref="(el) => setChartContainer(part.id, el)"
              class="report-chart-item"
              :data-chart-id="part.id"
            >
              <iframe
                v-if="isChartLoaded(part.id)"
                :srcdoc="withSkillResourceCredentials(part.html)"
                class="report-chart-iframe"
                sandbox="allow-scripts allow-same-origin"
              />
              <div v-else class="report-chart-placeholder">
                <div class="report-chart-placeholder-body">
                  <div class="report-chart-placeholder-icon">...</div>
                  <div class="report-chart-placeholder-title">
                    {{ t("analysis.reportGenerating") }}
                  </div>
                  <div class="report-chart-placeholder-desc">
                    {{ t("analysis.reportView") }}
                  </div>
                </div>
              </div>
            </div>
          </template>
        </template>

        <div v-if="isStreaming" class="streaming-indicator">
          <span class="streaming-dot"></span>
          <span>{{ t("task.generatingReport") }}</span>
        </div>
      </div>

      <div
        v-if="!isStreaming && task && displayContent"
        class="report-feedback-actions report-feedback-footer"
      >
        <button
          class="ui-icon-btn report-feedback-btn"
          :class="{ active: feedbackState === 'like' }"
          :title="feedbackCopy.like"
          @click="submitFeedback('like')"
        >
          <ThumbsUp :size="14" :stroke-width="feedbackState === 'like' ? 2.6 : 2" />
        </button>
        <button
          class="ui-icon-btn report-feedback-btn"
          :class="{ active: feedbackState === 'dislike' }"
          :title="feedbackCopy.dislike"
          @click="submitFeedback('dislike')"
        >
          <ThumbsDown :size="14" :stroke-width="feedbackState === 'dislike' ? 2.6 : 2" />
        </button>
      </div>
    </template>

    <template v-else>
      <div v-if="task?.status === 'running'" class="report-progress-state">
        <div class="report-progress-icon">
          <LoaderCircle :size="30" class="report-progress-spin" />
        </div>
        <div class="report-progress-title">{{ taskProgress?.stageText }}</div>
        <div v-if="taskProgress?.progress !== undefined">{{ taskProgress.progress }}%</div>
      </div>
      <div v-else class="report-empty">
        <div class="report-empty-icon">📄</div>
        <div class="report-empty-title">{{ t("analysis.noReport") }}</div>
        <div class="report-empty-desc">
          {{
            t("analysis.reportAutoGenerated", {
              status:
                task?.status === "pending"
                  ? t("analysis.reportWaiting")
                  : t("analysis.reportNotGenerated"),
            })
          }}
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.analysis-report {
  padding: 4px 0;
}

.report-progress-state {
  max-width: 560px;
  margin: 48px auto;
  padding: 24px 28px;
  text-align: center;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
}

.report-progress-icon {
  color: var(--el-color-primary);
}
.report-progress-spin {
  animation: report-progress-spin 1.2s linear infinite;
}
@keyframes report-progress-spin {
  to {
    transform: rotate(360deg);
  }
}
.report-progress-title {
  margin-top: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.report-section {
  margin-bottom: 24px;
}

.report-header h2 {
  font-size: 18px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  margin: 0;
  margin-bottom: 8px;
}

.report-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.report-feedback-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.report-feedback-footer {
  justify-content: flex-start;
  margin-top: 8px;
}

.report-referenced-skills {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-right: 4px;
}

.referenced-skills-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.referenced-skill {
  max-width: 180px;
  padding: 3px 8px;
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 999px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  font-size: 12px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.report-feedback-btn {
  color: var(--el-text-color-secondary);
}

.report-feedback-btn.active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.report-meta span::after {
  content: "|";
  margin-left: 8px;
  color: var(--el-border-color);
}

.report-meta span:last-child::after {
  content: none;
}

.report-section h3 {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--el-text-color-primary);
}

.report-summary p,
.report-body-content {
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.8;
}

.report-markdown {
  font-size: 13px;
  line-height: 1.6;
  font-family: var(--font-sans);
}

.report-markdown :deep(h1),
.report-markdown :deep(h2),
.report-markdown :deep(h3),
.report-markdown :deep(h4) {
  margin: 20px 0 10px 0;
  color: var(--el-text-color-primary);
  font-weight: var(--font-semibold);
  line-height: var(--leading-tight);
  letter-spacing: -0.02em;
}

.report-markdown :deep(h1) {
  font-size: 18px;
}

.report-markdown :deep(h2) {
  font-size: 16px;
}

.report-markdown :deep(h3) {
  font-size: 15px;
}

.report-markdown :deep(h4) {
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.report-markdown :deep(h5),
.report-markdown :deep(h6) {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  font-weight: var(--font-medium);
}

.report-markdown :deep(p) {
  margin: 12px 0;
}

.report-markdown :deep(ul),
.report-markdown :deep(ol) {
  margin: 12px 0;
  padding-left: 24px;
}

.report-markdown :deep(li) {
  margin: 6px 0;
  line-height: var(--leading-relaxed);
}

.report-markdown :deep(li::marker) {
  color: var(--el-text-color-secondary);
}

.report-markdown :deep(table) {
  border-collapse: collapse;
  margin: 16px 0;
  width: 100%;
}

.report-markdown :deep(th),
.report-markdown :deep(td) {
  padding: 12px 16px;
  text-align: left;
  font-size: var(--text-sm);
  border: none;
  border-bottom: 1px solid var(--el-border-color);
}

.report-markdown :deep(th) {
  background: var(--el-fill-color);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
}

.report-markdown :deep(code) {
  background: var(--el-fill-color-light);
  padding: 4px 8px;
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: 0.875em;
  color: var(--el-text-color-regular);
  border: 1px solid var(--el-border-color-light);
}

.report-markdown :deep(pre) {
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-primary);
  padding: 16px;
  border-radius: var(--radius-xl);
  overflow-x: auto;
  margin: 16px 0;
  border: 1px solid var(--el-border-color);
  box-shadow: var(--el-shadow-sm);
}

.report-markdown :deep(pre code) {
  background: none;
  color: inherit;
  padding: 0;
  border: none;
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
}

.report-markdown :deep(blockquote) {
  border-left: 3px solid var(--el-color-primary);
  margin: 16px 0;
  padding: 12px 16px;
  background: var(--el-fill-color-extra-light);
  color: var(--el-text-color-secondary);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
}

.report-markdown :deep(strong) {
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
}

.report-markdown :deep(em) {
  font-style: italic;
  color: var(--el-text-color-regular);
}

.report-markdown :deep(hr) {
  border: none;
  border-top: 1px solid var(--el-border-color);
  margin: 24px 0;
}

.report-markdown :deep(a) {
  color: var(--el-color-primary);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color var(--transition-fast);
}

.report-markdown :deep(a:hover) {
  border-bottom-color: var(--el-color-primary);
}

.report-markdown :deep(details) {
  margin: 12px 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  overflow: hidden;
}

.report-markdown :deep(summary) {
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  cursor: pointer;
  font-weight: 500;
  color: var(--el-color-primary);
  user-select: none;
  transition: background 0.2s;
}

.report-markdown :deep(summary:hover) {
  background: var(--el-fill-color);
}

.report-markdown :deep(details[open] summary) {
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.report-markdown :deep(details > *:not(summary)) {
  padding: 0;
}

.report-markdown :deep(details table) {
  margin: 0;
  border: none;
  border-radius: 0;
  width: 100%;
  min-width: 100%;
}

.report-chart-item {
  margin: 16px 0;
}

.report-chart-iframe {
  width: 100%;
  height: 400px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.report-chart-placeholder {
  height: 400px;
  border: 1px dashed var(--el-border-color);
  border-radius: 8px;
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--el-fill-color-light) 80%, transparent) 25%,
      color-mix(in srgb, var(--el-bg-color) 60%, transparent) 50%,
      color-mix(in srgb, var(--el-fill-color-light) 80%, transparent) 75%
    ),
    var(--el-fill-color-extra-light);
  background-size: 200% 100%;
  animation: chartPlaceholderShimmer 1.8s ease-in-out infinite;
  display: flex;
  align-items: center;
  justify-content: center;
}

.report-chart-placeholder-body {
  text-align: center;
  color: var(--el-text-color-secondary);
}

.report-chart-placeholder-icon {
  font-size: 28px;
  letter-spacing: 4px;
  color: var(--el-color-primary);
  margin-bottom: 10px;
}

.report-chart-placeholder-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.report-chart-placeholder-desc {
  font-size: 12px;
  margin-top: 6px;
}

/* Empty state */
.report-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  text-align: center;
}

.report-empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.report-empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  margin-bottom: 8px;
}

.report-empty-desc {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  max-width: 360px;
  line-height: 1.6;
}

.streaming-badge {
  color: var(--el-color-primary);
  font-weight: 500;
}

.streaming-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.streaming-dot {
  width: 8px;
  height: 8px;
  background: var(--el-color-primary);
  border-radius: 50%;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

@keyframes chartPlaceholderShimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
@media (max-width: 700px) {
  :where(html.workbench-mobile-navigation) .analysis-report {
    min-width: 0;
  }
  :where(html.workbench-mobile-navigation) .report-section {
    min-width: 0;
  }
  :where(html.workbench-mobile-navigation) .report-header h2 {
    font-size: 18px;
  }
  :where(html.workbench-mobile-navigation) .report-meta {
    flex-wrap: wrap;
  }
  :where(html.workbench-mobile-navigation) .report-markdown {
    overflow-wrap: anywhere;
  }
  :where(html.workbench-mobile-navigation) .report-markdown :deep(table) {
    display: block;
    width: max-content;
    min-width: 100%;
    max-width: none;
    overflow-x: auto;
  }
  :where(html.workbench-mobile-navigation) .report-markdown :deep(th),
  :where(html.workbench-mobile-navigation) .report-markdown :deep(td) {
    min-width: 120px;
    padding: 9px 10px;
  }
  :where(html.workbench-mobile-navigation) .report-markdown :deep(ul),
  :where(html.workbench-mobile-navigation) .report-markdown :deep(ol) {
    padding-left: 20px;
  }
  :where(html.workbench-mobile-navigation) .report-chart-iframe,
  :where(html.workbench-mobile-navigation) .report-chart-placeholder {
    height: 260px;
  }
  :where(html.workbench-mobile-navigation) .report-empty {
    padding: 48px 12px;
  }
}
</style>
