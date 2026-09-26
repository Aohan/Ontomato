<script setup lang="ts">
import type { AnalysisTaskDetail as AnalysisTask } from "@ontomato/contracts/analysis-task";

import type { AnalysisAgent } from "@ontomato/contracts/analysis-agent";

import { ref, computed } from "vue";
import { storeToRefs } from "pinia";
import {
  Plus,
  Calendar,
  Mail,
  Pencil,
  Brain,
  Sparkles,
  Activity,
  BarChart3,
  TrendingUp,
  Target,
  Database,
  Wallet,
  Users,
  Settings,
  Trash2,
  Bot,
  Truck,
  Building2,
  ClipboardList,
  RotateCcw,
  ArrowLeft,
} from "lucide-vue-next";

import { useDashboardStore } from "../../dashboard";
import { useAnalysisStore } from "../stores/analysis";
import { stripMarkdown } from "../../../utils/markdown";
import { formatRelativeTime } from "../../../utils/relative-time";
import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../content";

const { t } = useI18n();
const analysisStore = useAnalysisStore();
const dashboardStore = useDashboardStore();
const {
  agents,
  selectedAgentId,
  currentTaskId,
  tasks: displayTasks,
  loadingTasks: isLoadingTasks,
  hasMoreTasks: hasMore,
  taskProgressMap,
} = storeToRefs(analysisStore);

function displayAgentName(name?: string): string {
  if (!name) return "";
  return workbenchContent().defaultAgentNames.includes(name) ? t("service.defaultAgentName") : name;
}

function displayAgentDescription(desc?: string): string {
  if (!desc) return "";
  return workbenchContent().defaultAgentDescriptions.includes(desc)
    ? t("service.defaultAgentDescription")
    : desc;
}

const props = defineProps<{
  mode: "analysis" | "all";
  mobile?: boolean;
}>();

const emit = defineEmits<{
  "update:currentView": [view: "chat" | "report"];
  back: [];
  openWorkspace: [];
}>();

async function handleSelectTask(task: AnalysisTask) {
  analysisStore.stopCurrentTaskPolling();
  void dashboardStore.selectDashboard();
  await analysisStore.selectTask(task, (view) => emit("update:currentView", view));
  emit("openWorkspace");
}

const showInlineCreate = ref(false);
const taskTitle = ref("");
const scheduleEnabled = ref(false);
const scheduleFrequency = ref(t("task.daily"));
const scheduleTime = ref("08:00");
const scheduleDayOfWeek = ref<number>(1);
const scheduleDayOfMonth = ref<number>(1);
const emailEnabled = ref(false);
const emailRecipient = ref("");

const timeOptions = [
  "00:00",
  "00:30",
  "01:00",
  "01:30",
  "02:00",
  "02:30",
  "03:00",
  "03:30",
  "04:00",
  "04:30",
  "05:00",
  "05:30",
  "06:00",
  "06:30",
  "07:00",
  "07:30",
  "08:00",
  "08:30",
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
  "18:30",
  "19:00",
  "19:30",
  "20:00",
  "20:30",
  "21:00",
  "21:30",
  "22:00",
  "22:30",
  "23:00",
  "23:30",
];

const dayOfWeekOptions = computed(() => [
  { label: t("common.monday"), value: 1 },
  { label: t("common.tuesday"), value: 2 },
  { label: t("common.wednesday"), value: 3 },
  { label: t("common.thursday"), value: 4 },
  { label: t("common.friday"), value: 5 },
  { label: t("common.saturday"), value: 6 },
  { label: t("common.sunday"), value: 7 },
]);

const dayOfMonthOptions = computed(() =>
  [1, 5, 10, 15, 20, 25].map((d) => ({
    label: t("analysis.monthlyDayFormat", { day: d }),
    value: d,
  }))
);

const selectedAgent = computed(() =>
  props.mode === "all" ? undefined : agents.value.find((a) => a.id === selectedAgentId.value)
);

const runningTasks = computed(() => displayTasks.value.filter((t) => t.status === "running"));
const doneTasks = computed(() =>
  displayTasks.value.filter(
    (t) => t.status === "completed" || t.status === "failed" || t.status === "cancelled"
  )
);
const scheduledTasks = computed(() =>
  displayTasks.value.filter((t) => t.status === "pending" && t.scheduleEnabled)
);

const getTaskProgress = (task: AnalysisTask): number =>
  taskProgressMap.value?.[task.id]?.progress ?? 0;
const getStageText = (task: AnalysisTask): string =>
  taskProgressMap.value?.[task.id]?.stageText || "";

const getTaskStatusText = (task: AnalysisTask): { text: string; class: string } => {
  switch (task.status) {
    case "running":
      return { text: t("task.executing"), class: "status-running" };
    case "completed":
      return { text: t("task.completed"), class: "status-done" };
    case "failed":
      return { text: t("common.failed"), class: "status-failed" };
    case "cancelled":
      return { text: t("task.cancelled"), class: "status-cancelled" };
    case "pending":
      return { text: t("analysis.scheduled"), class: "status-scheduled" };
    default:
      return { text: t("task.unknown"), class: "" };
  }
};

const getTaskMeta = (task: AnalysisTask): string => {
  if (task.scheduleEnabled && task.status === "pending") return formatSchedule(task);
  return formatRelativeTime(task.createdAt);
};

const TECHNICAL_FAILURE_PATTERN =
  /\b(?:http\s*)?[45]\d{2}\b|status\s*code|no\s*body|empty\s*(?:body|response)|timeout|timed\s*out|network\s*error|connection\s*(?:failed|refused|reset)|econn\w*|socket|fetch\s*failed/i;

const getTaskSummary = (task: AnalysisTask): string => {
  const summary = stripMarkdown(task.resultSummary || "").trim();
  if (task.status === "failed" && TECHNICAL_FAILURE_PATTERN.test(summary)) {
    return t("user.serverResponseError");
  }
  return summary;
};

const formatSchedule = (task: AnalysisTask): string => {
  if (!task.scheduleExpression) return t("analysis.scheduledTask");
  return formatScheduleExpression(task.scheduleExpression);
};

const formatScheduleExpression = (expr: string): string => {
  const freqMap: Record<string, string> = {
    "1d": t("task.daily"),
    "7d": t("task.weekly"),
    "30d": t("task.monthly"),
  };
  const dayOfWeekNames: Record<number, string> = {
    1: t("common.monday"),
    2: t("common.tuesday"),
    3: t("common.wednesday"),
    4: t("common.thursday"),
    5: t("common.friday"),
    6: t("common.saturday"),
    7: t("common.sunday"),
  };
  const match = expr.match(/^(\d+[mhd])@(\d{1,2}:\d{2})(?:\/(\d+))?$/i);
  if (match) {
    const freq = freqMap[match[1]] || match[1];
    const time = match[2];
    if (match[3]) {
      const dayNum = parseInt(match[3], 10);
      if (match[1] === "7d" && dayNum >= 1 && dayNum <= 7) {
        return `${freq} ${dayOfWeekNames[dayNum]} ${time}`;
      } else if (match[1] === "30d") {
        return `${freq} ${t("analysis.monthlyDayFormat", { day: dayNum })} ${time}`;
      }
    }
    return `${freq}${time}`;
  }
  return `${expr}`;
};

const agentIcons: Record<string, any> = {
  general: TrendingUp,
  sales: Wallet,
  finance: Building2,
  ops: Settings,
  customer: Users,
  supply: Truck,
};

const getAgentIcon = (id: string) => {
  for (const [key, icon] of Object.entries(agentIcons)) if (id?.includes(key)) return icon;
  return Bot;
};

const lucideIconMap: Record<string, any> = {
  Brain,
  Sparkles,
  Activity,
  BarChart3,
  TrendingUp,
  Target,
  Database,
  Wallet,
  Users,
  Settings,
};

const getAgentIconComponent = (agent: AnalysisAgent) => {
  try {
    if (agent.icon) {
      const parsed = typeof agent.icon === "string" ? JSON.parse(agent.icon) : agent.icon;
      return lucideIconMap[parsed.key] || null;
    }
  } catch {
    /* ignore */
  }
  return null;
};

const getAgentColor = (agent: AnalysisAgent) => {
  let storedColor = "";
  try {
    if (agent.icon) {
      const parsed = typeof agent.icon === "string" ? JSON.parse(agent.icon) : agent.icon;
      if (parsed.color) storedColor = parsed.color;
    }
  } catch {
    /* ignore */
  }
  switch (storedColor) {
    case "#F1EFFF":
      return "color-mix(in srgb, var(--el-color-primary) 10%, var(--el-bg-color))";
    case "#EEF7FF":
      return "color-mix(in srgb, var(--el-color-info) 8%, var(--el-bg-color))";
    case "#EFFFF8":
      return "color-mix(in srgb, var(--el-color-success) 10%, var(--el-bg-color))";
    case "#FFF6ED":
      return "color-mix(in srgb, var(--el-color-warning) 10%, var(--el-bg-color))";
    case "#FFF4FB":
      return "color-mix(in srgb, var(--el-color-danger) 8%, var(--el-bg-color))";
    case "#F4F7FE":
      return "var(--el-fill-color)";
    default:
      if (storedColor) return storedColor;
      break;
  }
  const id = agent.id || "";
  if (id?.includes("sales"))
    return "color-mix(in srgb, var(--el-color-warning) 10%, var(--el-bg-color))";
  if (id?.includes("finance"))
    return "color-mix(in srgb, var(--el-color-success) 10%, var(--el-bg-color))";
  if (id?.includes("ops")) return "color-mix(in srgb, var(--el-color-info) 8%, var(--el-bg-color))";
  if (id?.includes("customer"))
    return "color-mix(in srgb, var(--el-color-danger) 8%, var(--el-bg-color))";
  if (id?.includes("supply"))
    return "color-mix(in srgb, var(--el-color-primary) 10%, var(--el-bg-color))";
  return "color-mix(in srgb, var(--el-color-primary) 10%, var(--el-bg-color))";
};

function handleEditAgent() {
  if (selectedAgent.value) {
    analysisStore.editAnalysisAgent(selectedAgent.value);
  }
}

function toggleCreate() {
  showInlineCreate.value = !showInlineCreate.value;
  if (showInlineCreate.value) {
    taskTitle.value = "";
    scheduleEnabled.value = false;
    scheduleFrequency.value = t("task.daily");
    scheduleTime.value = "08:00";
    scheduleDayOfWeek.value = 1;
    scheduleDayOfMonth.value = 1;
    emailEnabled.value = false;
    emailRecipient.value = "";
  }
}

function handleCreate() {
  const title = taskTitle.value.trim();
  if (!title || !selectedAgentId.value || !selectedAgent.value) return;

  let scheduleExpression = "";
  if (scheduleEnabled.value) {
    const freqMap: Record<string, string> = {
      [t("task.daily")]: "1d",
      [t("task.weekly")]: "7d",
      [t("task.monthly")]: "30d",
    };
    const freq = freqMap[scheduleFrequency.value] || "1d";
    scheduleExpression = freq + "@" + scheduleTime.value;
    if (scheduleFrequency.value === t("task.weekly")) {
      scheduleExpression += "/" + scheduleDayOfWeek.value;
    } else if (scheduleFrequency.value === t("task.monthly")) {
      scheduleExpression += "/" + scheduleDayOfMonth.value;
    }
  }

  void analysisStore.createTask(
    handleSelectTask,
    selectedAgentId.value,
    selectedAgent.value.name,
    title,
    {
      scheduleEnabled: scheduleEnabled.value,
      scheduleExpression,
      scheduleFrequency: scheduleFrequency.value,
      scheduleTime: scheduleTime.value,
      emailEnabled: emailEnabled.value,
      emailRecipient: emailRecipient.value.trim(),
    }
  );
  showInlineCreate.value = false;
  taskTitle.value = "";
}

function handleDelete(e: Event, taskId: string) {
  e.stopPropagation();
  void analysisStore.deleteTask(taskId);
}
</script>

<template>
  <div class="mid-panel">
    <div class="mid-header">
      <button
        v-if="mobile"
        type="button"
        class="mobile-list-back"
        :aria-label="t('common.back')"
        @click="emit('back')"
      >
        <ArrowLeft :size="19" />
      </button>
      <div class="mid-agent-info">
        <div
          class="mid-agent-avatar"
          :style="{
            background: selectedAgent ? getAgentColor(selectedAgent) : 'var(--el-fill-color)',
          }"
        >
          <component
            :is="getAgentIconComponent(selectedAgent)"
            v-if="selectedAgent && getAgentIconComponent(selectedAgent)"
            :size="22"
          />
          <component
            :is="selectedAgent ? getAgentIcon(selectedAgent.id) : ClipboardList"
            v-else
            :size="22"
          />
        </div>
        <div class="mid-agent-text">
          <div
            class="mid-agent-name"
            :title="selectedAgent ? displayAgentName(selectedAgent.name) : t('admin.allTasks')"
          >
            {{ selectedAgent ? displayAgentName(selectedAgent.name) : t("admin.allTasks") }}
          </div>
          <div
            class="mid-agent-desc"
            :title="
              selectedAgent
                ? displayAgentDescription(selectedAgent.description) ||
                  t('app.fullScenarioAnalysis')
                : t('app.crossAgentBoard')
            "
          >
            {{
              selectedAgent
                ? displayAgentDescription(selectedAgent.description) ||
                  t("app.fullScenarioAnalysis")
                : t("app.crossAgentBoard")
            }}
          </div>
        </div>
      </div>
      <button
        v-if="selectedAgent"
        class="mid-edit-btn"
        :title="t('analysis.editAgent')"
        @click.stop="handleEditAgent"
      >
        <Pencil :size="14" />
      </button>
      <button v-if="selectedAgent" class="btn-create" @click="toggleCreate">
        <Plus :size="16" />
        {{ t("analysis.newTask") }}
      </button>
    </div>

    <Transition name="slide-down">
      <div v-if="showInlineCreate" class="inline-create">
        <textarea
          v-model="taskTitle"
          class="task-textarea"
          :placeholder="t('analysis.analysisInputHint')"
          @keydown="
            if ($event.key === 'Enter' && !$event.shiftKey) {
              $event.preventDefault();
              handleCreate();
            }
          "
        ></textarea>
        <div class="create-options">
          <div class="option-row">
            <div class="option-left">
              <Calendar :size="14" />
              <span>{{ t("analysis.scheduledExecution") }}</span>
            </div>
            <el-switch v-model="scheduleEnabled" size="small" />
          </div>
          <div v-if="scheduleEnabled" class="option-sub open">
            <div class="option-sub-row">
              <label>{{ t("analysis.frequency") }}</label>
              <el-select v-model="scheduleFrequency" size="small" style="flex: 1">
                <el-option :label="t('task.daily')" :value="t('task.daily')" />
                <el-option :label="t('task.weekly')" :value="t('task.weekly')" />
                <el-option :label="t('task.monthly')" :value="t('task.monthly')" />
              </el-select>
            </div>
            <div v-if="scheduleFrequency === t('task.weekly')" class="option-sub-row">
              <label>{{ t("analysis.dayOfWeek") }}</label>
              <el-select v-model="scheduleDayOfWeek" size="small" style="flex: 1">
                <el-option
                  v-for="d in dayOfWeekOptions"
                  :key="d.value"
                  :label="d.label"
                  :value="d.value"
                />
              </el-select>
            </div>
            <div v-if="scheduleFrequency === t('task.monthly')" class="option-sub-row">
              <label>{{ t("common.date") }}</label>
              <el-select v-model="scheduleDayOfMonth" size="small" style="flex: 1">
                <el-option
                  v-for="d in dayOfMonthOptions"
                  :key="d.value"
                  :label="d.label"
                  :value="d.value"
                />
              </el-select>
            </div>
            <div class="option-sub-row">
              <label>{{ t("common.time") }}</label>
              <el-select v-model="scheduleTime" size="small" style="flex: 1" filterable>
                <el-option v-for="opt in timeOptions" :key="opt" :label="opt" :value="opt" />
              </el-select>
            </div>
          </div>
          <div class="option-row">
            <div class="option-left">
              <Mail :size="14" />
              <span>{{ t("analysis.emailOnComplete") }}</span>
            </div>
            <el-switch v-model="emailEnabled" size="small" />
          </div>
          <div v-if="emailEnabled" class="option-sub open">
            <div class="option-sub-row">
              <label>{{ t("analysis.recipient") }}</label>
              <el-input
                v-model="emailRecipient"
                size="small"
                :placeholder="t('analysis.emailPlaceholder')"
                style="flex: 1"
              />
            </div>
          </div>
        </div>
        <div class="create-actions">
          <el-button size="small" type="primary" @click="handleCreate">
            {{ t("common.confirm") }}
          </el-button>
          <el-button size="small" @click="toggleCreate">{{ t("common.cancel") }}</el-button>
        </div>
      </div>
    </Transition>

    <div v-loading="isLoadingTasks" class="task-groups" :element-loading-text="t('common.loading')">
      <template v-if="displayTasks.length === 0 && !isLoadingTasks">
        <div class="task-placeholder">
          <div class="placeholder-icon-wrapper">
            <ClipboardList class="placeholder-icon" :size="32" />
          </div>
          <div class="placeholder-text">{{ t("analysis.noTasks") }}</div>
          <div class="placeholder-sub">{{ t("analysis.createTaskHint") }}</div>
        </div>
      </template>
      <template v-else>
        <div v-if="runningTasks.length" class="task-group">
          <div class="history-list-heading">
            <span class="group-dot running history-list-marker"></span>
            {{ t("task.executing") }} ({{ runningTasks.length }})
          </div>
          <div
            v-for="task in runningTasks"
            :key="task.id"
            class="task-card task-card--running history-list-item"
            :class="{ active: currentTaskId === task.id }"
            @click="handleSelectTask(task)"
          >
            <div class="task-card-row">
              <div class="task-card-content">
                <div class="task-title history-list-title" :title="task.name">{{ task.name }}</div>
                <div class="task-meta history-list-meta">
                  {{ getTaskMeta(task) }}
                  <span class="task-status" :class="getTaskStatusText(task).class">
                    {{ getTaskStatusText(task).text }}
                  </span>
                </div>
                <div class="progress-text">{{ getStageText(task) }}</div>
              </div>
              <div
                v-if="taskProgressMap[task.id]?.progress !== undefined"
                class="circular-progress"
              >
                <svg width="36" height="36" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="15" fill="none" stroke-width="3" />
                  <circle
                    cx="18"
                    cy="18"
                    r="15"
                    fill="none"
                    stroke-width="3"
                    stroke-linecap="round"
                    :stroke-dasharray="2 * Math.PI * 15"
                    :stroke-dashoffset="2 * Math.PI * 15 * (1 - getTaskProgress(task) / 100)"
                  />
                </svg>
                <span class="progress-pct">{{ getTaskProgress(task) }}%</span>
              </div>
              <button
                class="task-btn task-delete-btn"
                :title="t('analysis.deleteTask')"
                @click="(e) => handleDelete(e, task.id)"
              >
                <Trash2 :size="14" />
              </button>
            </div>
          </div>
        </div>
        <div v-if="doneTasks.length" class="task-group">
          <div class="history-list-heading">
            <span class="history-list-marker"></span>
            {{ t("task.completed") }} ({{ doneTasks.length }})
          </div>
          <div
            v-for="task in doneTasks"
            :key="task.id"
            class="task-card history-list-item"
            :class="{ active: currentTaskId === task.id }"
            @click="handleSelectTask(task)"
          >
            <div class="task-card-row">
              <div class="task-card-content">
                <div class="task-title history-list-title" :title="task.name">{{ task.name }}</div>
                <div class="task-meta history-list-meta">
                  {{ getTaskMeta(task) }}
                  <span class="task-status" :class="getTaskStatusText(task).class">
                    {{ getTaskStatusText(task).text }}
                  </span>
                </div>
                <div v-if="task.resultSummary" class="task-summary">
                  {{ getTaskSummary(task) }}
                </div>
              </div>
              <div class="task-btn-group">
                <button
                  class="task-btn task-rerun-btn"
                  :title="t('analysis.reRun')"
                  @click.stop="analysisStore.rerunTask(task)"
                >
                  <RotateCcw :size="14" />
                </button>
                <button
                  class="task-btn task-delete-btn"
                  :title="t('analysis.deleteTask')"
                  @click="(e) => handleDelete(e, task.id)"
                >
                  <Trash2 :size="14" />
                </button>
              </div>
            </div>
          </div>
        </div>
        <div v-if="scheduledTasks.length" class="task-group">
          <div class="history-list-heading">
            <span class="group-dot scheduled history-list-marker"></span>
            {{ t("analysis.scheduledTask") }} ({{ scheduledTasks.length }})
          </div>
          <div
            v-for="task in scheduledTasks"
            :key="task.id"
            class="task-card history-list-item"
            :class="{ active: currentTaskId === task.id }"
            @click="handleSelectTask(task)"
          >
            <div class="task-card-row">
              <div class="task-card-content">
                <div class="task-title history-list-title" :title="task.name">{{ task.name }}</div>
                <div class="task-meta history-list-meta">
                  <Calendar :size="12" class="meta-icon" />
                  {{
                    task.scheduleExpression
                      ? formatScheduleExpression(task.scheduleExpression)
                      : t("analysis.pendingScheduling")
                  }}
                  <span class="task-status status-scheduled">{{ t("analysis.scheduled") }}</span>
                </div>
              </div>
              <button
                class="task-btn task-delete-btn"
                :title="t('analysis.deleteTask')"
                @click="(e) => handleDelete(e, task.id)"
              >
                <Trash2 :size="14" />
              </button>
            </div>
          </div>
        </div>
        <div v-if="hasMore" class="load-more-row">
          <button
            class="load-more-btn"
            :disabled="isLoadingTasks"
            @click="analysisStore.loadMoreTasks()"
          >
            {{ t("common.loadMore") }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped src="../../../styles/history-list.css"></style>
<style scoped>
.mid-panel {
  min-width: 0;
  min-height: 0;
  background: var(--el-fill-color-extra-light);
  border: none;
  border-radius: 24px;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
  box-shadow: var(--shadow-card);
}
.mid-header {
  flex-shrink: 0;
  padding: 20px 20px 16px;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  position: relative;
}
.mobile-list-back {
  display: none;
}
.mid-agent-info {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  padding-right: 36px;
}
.mid-agent-text {
  flex: 1;
  min-width: 0;
}
.mid-agent-avatar {
  width: 46px;
  height: 46px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
  color: var(--el-color-primary);
}
.mid-agent-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mid-agent-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mid-edit-btn {
  position: absolute;
  top: 18px;
  right: 20px;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  color: var(--el-text-color-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: all 0.15s;
}
.mid-edit-btn:hover {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
}
.btn-create {
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 10px;
  background: linear-gradient(135deg, var(--el-color-primary), var(--el-color-primary-light-3));
  color: var(--on-primary);
  border: none;
  border-radius: 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  box-shadow: var(--shadow-primary);
}
.btn-create:hover {
  background: linear-gradient(135deg, var(--el-color-primary-dark-2), var(--el-color-primary));
  box-shadow: var(--shadow-primary-hover);
  transform: translateY(-1px);
}
.inline-create {
  background: var(--el-bg-color);
  border-radius: 18px;
  margin: 12px 16px 0;
  padding: 16px;
  box-shadow: var(--shadow-card);
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 18%, transparent);
}
.inline-create .task-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid var(--el-border-color);
  border-radius: 10px;
  font-size: 13px;
  outline: none;
  resize: none;
  height: 80px;
  line-height: 1.5;
  font-family: inherit;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  transition: border-color 0.2s ease;
}
.inline-create .task-textarea:focus {
  border-color: color-mix(in srgb, var(--el-color-primary) 45%, transparent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--el-color-primary) 8%, transparent);
}
.inline-create .task-textarea::placeholder {
  color: var(--el-text-color-secondary);
}
.create-options {
  margin-top: 12px;
}
.option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.option-row:last-child {
  border-bottom: none;
}
.option-left {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  font-weight: 500;
}
.opt-icon {
  font-size: 14px;
}
.option-sub {
  overflow: hidden;
  max-height: 0;
  transition:
    max-height 0.3s ease,
    padding 0.3s ease;
  padding: 0;
}
.option-sub.open {
  max-height: 200px;
  padding: 8px 0 4px;
}
.option-sub-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.option-sub-row label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  min-width: 48px;
}
.create-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.slide-down-enter-active {
  animation: slideDown 0.25s ease;
}
.slide-down-leave-active {
  animation: slideDown 0.2s ease reverse;
}
@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.task-groups {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  background: color-mix(in srgb, var(--el-bg-color) 30%, var(--el-bg-color-page) 70%);
}
.task-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 12px;
  text-align: center;
}
.placeholder-icon-wrapper {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: var(--el-color-primary-light-9);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
}
.placeholder-icon {
  color: var(--el-color-primary);
}
.placeholder-text {
  font-size: 14px;
  color: var(--el-text-color-regular);
  font-weight: 500;
}
.placeholder-sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}
.task-group {
  margin-bottom: 16px;
}
.load-more-row {
  display: flex;
  justify-content: center;
  padding: 6px 0 12px;
}
.load-more-btn {
  border: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 12px;
  cursor: pointer;
}
.load-more-btn:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--el-color-primary) 45%, transparent);
  color: var(--el-color-primary);
}
.load-more-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.group-dot.running {
  background: var(--el-color-primary);
  animation: pulse 1.5s infinite;
}
.group-dot.scheduled {
  background: var(--el-color-warning);
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
.task-card-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.task-card-content {
  flex: 1;
  min-width: 0;
}
.task-title {
  padding-right: 16px;
}
.task-meta {
  margin-bottom: 8px;
}
.meta-icon {
  flex-shrink: 0;
}
.task-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
}
.status-running {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.status-done {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}
.status-failed {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
.status-cancelled {
  background: var(--el-fill-color);
  color: var(--el-text-color-regular);
}
.status-scheduled {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
}
.task-summary {
  font-size: 11px;
  color: var(--el-text-color-regular);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.progress-text {
  font-size: 11px;
  color: var(--el-color-primary);
  margin-top: 5px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
}
.progress-text::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-primary);
  animation: dotPulse 1.2s ease-in-out infinite;
}
@keyframes dotPulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.3;
    transform: scale(1.4);
  }
}
.circular-progress {
  width: 36px;
  height: 36px;
  position: relative;
  flex-shrink: 0;
}
.task-card--running .circular-progress {
  margin-top: 22px;
}
.circular-progress svg {
  transform: rotate(-90deg);
}
.circular-progress svg circle:nth-child(1) {
  stroke: var(--el-border-color);
}
.circular-progress svg circle:nth-child(2) {
  stroke: var(--el-color-primary);
}
.progress-pct {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  color: var(--el-color-primary);
}
.task-btn-group {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.task-btn {
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;

  opacity: 0;
  transition: all 0.15s ease;
  border: none;
}

.task-card:hover .task-btn {
  opacity: 1;
}

.task-rerun-btn:hover {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.task-delete-btn:hover {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}
.task-groups::-webkit-scrollbar {
  width: 4px;
}
.task-groups::-webkit-scrollbar-track {
  background: transparent;
}
.task-groups::-webkit-scrollbar-thumb {
  background: var(--el-border-color-dark);
  border-radius: 4px;
}
.task-groups::-webkit-scrollbar-thumb:hover {
  background: var(--el-text-color-secondary);
}
@media (max-width: 700px) {
  :where(html.workbench-mobile-navigation) .mid-header {
    padding: calc(10px + env(safe-area-inset-top)) 14px 14px;
  }
  :where(html.workbench-mobile-navigation) .mobile-list-back {
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 8px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--el-text-color-regular);
  }
  :where(html.workbench-mobile-navigation) .mobile-list-back:active {
    background: var(--el-fill-color);
  }
  :where(html.workbench-mobile-navigation) .mid-agent-info {
    margin-bottom: 12px;
  }
  :where(html.workbench-mobile-navigation) .mid-agent-avatar {
    width: 40px;
    height: 40px;
    border-radius: 12px;
  }
  :where(html.workbench-mobile-navigation) .inline-create {
    max-height: 56dvh;
    overflow-y: auto;
    padding: 12px 14px;
  }
  :where(html.workbench-mobile-navigation) .task-groups {
    padding: 12px;
    padding-bottom: calc(12px + env(safe-area-inset-bottom));
  }
  :where(html.workbench-mobile-navigation) .task-btn {
    opacity: 1;
  }
  :where(html.workbench-mobile-navigation) .btn-create:hover {
    transform: none;
  }
}
</style>
