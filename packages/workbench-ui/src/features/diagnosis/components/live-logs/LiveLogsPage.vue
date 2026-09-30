<script setup lang="ts">
import type { ParsedLogRecord } from "@ontomato/contracts/observe";
import { nextTick, onBeforeUnmount, reactive, ref } from "vue";
import { authHost } from "../../../../utils/auth";
import { diagnosisApi } from "../../api";
import { Monitor, Database } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../../content";
import { appendRecentLogs, isLogViewAtBottom } from "./live-log-view";

const { t } = useI18n();

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type LogEntry = ParsedLogRecord & { key: number; timestamp?: string };

interface PanelState {
  connected: boolean;
  paused: boolean;
  logs: LogEntry[];
  filterLevel: string;
  filterKeyword: string;
  eventSource: EventSource | null;
  pendingLogs: LogEntry[];
  flushTimer: ReturnType<typeof setTimeout> | null;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MAX_LINES = 5000;
const TRIM_TO = 4000;
const FLUSH_INTERVAL_MS = 100;
let nextLogKey = 0;

const levelOptions = [
  { label: t("common.all"), value: "" },
  { label: "DEBUG", value: "debug" },
  { label: "INFO", value: "info" },
  { label: "WARN", value: "warn" },
  { label: "ERROR", value: "error" },
];

/* ------------------------------------------------------------------ */
/*  Panel State                                                        */
/* ------------------------------------------------------------------ */

function createPanel(): PanelState {
  return {
    connected: false,
    paused: false,
    logs: [],
    filterLevel: "",
    filterKeyword: "",
    eventSource: null,
    pendingLogs: [],
    flushTimer: null,
  };
}

const left = reactive<PanelState>(createPanel());
const right = reactive<PanelState>(createPanel());

const leftLogContainer = ref<HTMLElement | null>(null);
const rightLogContainer = ref<HTMLElement | null>(null);

/* ------------------------------------------------------------------ */
/*  Connect / Disconnect per panel                                     */
/* ------------------------------------------------------------------ */

const { appLogSource } = workbenchContent().observe;

function connectPanel(panel: PanelState, source: string, getContainer: () => HTMLElement | null) {
  disconnectPanel(panel);

  const params = new URLSearchParams();
  params.set("tk", authHost().getToken() || "");
  if (source) params.set("source", source);
  if (panel.filterLevel) params.set("level", panel.filterLevel);
  if (panel.filterKeyword) params.set("keyword", panel.filterKeyword);

  const eventSource = diagnosisApi.openLiveLogs(params);
  panel.eventSource = eventSource;
  panel.connected = true;

  eventSource.onmessage = (ev) => {
    if (panel.eventSource !== eventSource || panel.paused) return;
    try {
      const payload = JSON.parse(ev.data) as Omit<LogEntry, "key">;
      enqueueLog(
        panel,
        {
          ...payload,
          key: ++nextLogKey,
        },
        getContainer
      );
    } catch {
      // ignore
    }
  };

  eventSource.onerror = () => {
    if (panel.eventSource !== eventSource) return;
    disconnectPanel(panel);
  };
}

function enqueueLog(panel: PanelState, entry: LogEntry, getContainer: () => HTMLElement | null) {
  panel.pendingLogs.push(entry);
  if (panel.pendingLogs.length > MAX_LINES) {
    panel.pendingLogs.splice(0, panel.pendingLogs.length - TRIM_TO);
  }
  if (panel.flushTimer !== null) return;

  panel.flushTimer = setTimeout(() => {
    panel.flushTimer = null;
    flushLogs(panel, getContainer);
  }, FLUSH_INTERVAL_MS);
}

function flushLogs(panel: PanelState, getContainer: () => HTMLElement | null) {
  if (panel.pendingLogs.length === 0) return;

  const shouldFollow = isLogViewAtBottom(getContainer());
  const batch = panel.pendingLogs.splice(0);
  panel.logs = appendRecentLogs(panel.logs, batch, MAX_LINES, TRIM_TO);

  if (shouldFollow) {
    void nextTick(() => {
      const container = getContainer();
      if (container) container.scrollTop = container.scrollHeight;
    });
  }
}

function disconnectPanel(panel: PanelState) {
  if (panel.eventSource) {
    panel.eventSource.close();
    panel.eventSource = null;
  }
  panel.connected = false;
}

function togglePause(panel: PanelState) {
  panel.paused = !panel.paused;
}

function clearLogs(panel: PanelState) {
  if (panel.flushTimer !== null) {
    clearTimeout(panel.flushTimer);
    panel.flushTimer = null;
  }
  panel.pendingLogs.splice(0);
  panel.logs = [];
}

/* ------------------------------------------------------------------ */
/*  Left / Right wrappers                                              */
/* ------------------------------------------------------------------ */

function connectLeft() {
  connectPanel(left, `${appLogSource},llm`, () => leftLogContainer.value);
}
function disconnectLeft() {
  disconnectPanel(left);
}
function reconnectLeft() {
  connectLeft();
}

function connectRight() {
  connectPanel(right, "backend", () => rightLogContainer.value);
}
function disconnectRight() {
  disconnectPanel(right);
}
function reconnectRight() {
  connectRight();
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function logLevelClass(level?: string): string {
  if (!level) return "log-info";
  const l = level.toLowerCase();
  if (l === "error") return "log-error";
  if (l === "warn" || l === "warning") return "log-warn";
  if (l === "debug") return "log-debug";
  return "log-info";
}

function formatLogLine(entry: LogEntry): string {
  if (entry.source === "backend" && entry.message) return entry.message;

  const parts: string[] = [];
  if (entry.time || entry.timestamp) parts.push(entry.time || entry.timestamp || "");
  if (entry.level) parts.push(`[${entry.level.toUpperCase()}]`);
  if (entry.source) parts.push(`[${entry.source}]`);
  if (entry.turnKey) parts.push(`(turn ${entry.turnKey})`);
  else if (entry.taskId) parts.push(`(task ${entry.taskId})`);
  if (entry.message) parts.push(entry.message);
  return parts.join(" ");
}

/* ------------------------------------------------------------------ */
/*  Resizable Split                                                    */
/* ------------------------------------------------------------------ */

const splitContainer = ref<HTMLElement | null>(null);
const leftPercent = ref(50);
const isDragging = ref(false);

function onDragStart(e: MouseEvent) {
  e.preventDefault();
  isDragging.value = true;
  const startX = e.clientX;
  const startPercent = leftPercent.value;

  function onMove(ev: MouseEvent) {
    const containerW = splitContainer.value?.clientWidth || 800;
    const delta = ev.clientX - startX;
    const deltaPercent = (delta / containerW) * 100;
    const newPercent = Math.max(25, Math.min(75, startPercent + deltaPercent));
    leftPercent.value = newPercent;
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
/*  Lifecycle                                                          */
/* ------------------------------------------------------------------ */

onBeforeUnmount(() => {
  clearLogs(left);
  clearLogs(right);
  disconnectPanel(left);
  disconnectPanel(right);
});
</script>

<template>
  <div ref="splitContainer" class="live-logs-page" :class="{ dragging: isDragging }">
    <!-- Left Panel: Frontend Logs -->
    <div class="log-panel" :style="{ width: leftPercent + '%' }">
      <div class="panel-header">
        <Monitor class="panel-icon" />
        <span class="panel-title">{{ t("observe.frontendLogs") }}</span>
        <span class="panel-subtitle">{{ appLogSource }}</span>
        <span style="flex: 1" />
        <span
          class="status-dot"
          :class="left.connected ? 'is-connected' : 'is-disconnected'"
          :title="left.connected ? t('common.connected') : t('common.notConnected')"
        />
      </div>

      <div class="panel-toolbar">
        <el-select
          v-model="left.filterLevel"
          :placeholder="t('common.level')"
          size="small"
          style="width: 90px"
          @change="
            () => {
              if (left.connected) reconnectLeft();
            }
          "
        >
          <el-option v-for="l in levelOptions" :key="l.value" :label="l.label" :value="l.value" />
        </el-select>
        <el-input
          v-model="left.filterKeyword"
          :placeholder="t('observe.keywordSearch')"
          size="small"
          clearable
          style="width: 140px"
          @change="
            () => {
              if (left.connected) reconnectLeft();
            }
          "
        />
        <span style="flex: 1" />
        <el-button
          size="small"
          :type="left.connected ? 'danger' : 'primary'"
          @click="left.connected ? disconnectLeft() : connectLeft()"
        >
          {{ left.connected ? t("common.disconnect") : t("common.connect") }}
        </el-button>
        <el-button size="small" :disabled="!left.connected" @click="togglePause(left)">
          {{ left.paused ? t("common.continue") : t("common.pause") }}
        </el-button>
        <el-button size="small" @click="clearLogs(left)">{{ t("common.clear") }}</el-button>
      </div>

      <div v-if="left.logs.length === 0" class="log-empty">
        {{ left.connected ? t("observe.waitingForLogs") : t("observe.clickConnectToStart") }}
      </div>
      <pre v-else ref="leftLogContainer" class="log-terminal"><span
  v-for="entry in left.logs"
  :key="entry.key"
  :class="logLevelClass(entry.level)"
>{{ formatLogLine(entry) }}
</span></pre>
    </div>

    <!-- Drag Handle -->
    <div class="drag-handle" @mousedown="onDragStart" />

    <!-- Right Panel: Backend Logs -->
    <div class="log-panel" style="flex: 1; min-width: 0">
      <div class="panel-header">
        <Database class="panel-icon" />
        <span class="panel-title">{{ t("observe.backendLogs") }}</span>
        <span class="panel-subtitle">Node API</span>
        <span style="flex: 1" />
        <span
          class="status-dot"
          :class="right.connected ? 'is-connected' : 'is-disconnected'"
          :title="right.connected ? t('common.connected') : t('common.notConnected')"
        />
      </div>

      <div class="panel-toolbar">
        <el-select
          v-model="right.filterLevel"
          :placeholder="t('common.level')"
          size="small"
          style="width: 90px"
          @change="
            () => {
              if (right.connected) reconnectRight();
            }
          "
        >
          <el-option v-for="l in levelOptions" :key="l.value" :label="l.label" :value="l.value" />
        </el-select>
        <el-input
          v-model="right.filterKeyword"
          :placeholder="t('observe.keywordSearch')"
          size="small"
          clearable
          style="width: 140px"
          @change="
            () => {
              if (right.connected) reconnectRight();
            }
          "
        />
        <span style="flex: 1" />
        <el-button
          size="small"
          :type="right.connected ? 'danger' : 'primary'"
          @click="right.connected ? disconnectRight() : connectRight()"
        >
          {{ right.connected ? t("common.disconnect") : t("common.connect") }}
        </el-button>
        <el-button size="small" :disabled="!right.connected" @click="togglePause(right)">
          {{ right.paused ? t("common.continue") : t("common.pause") }}
        </el-button>
        <el-button size="small" @click="clearLogs(right)">{{ t("common.clear") }}</el-button>
      </div>

      <div v-if="right.logs.length === 0" class="log-empty">
        {{ right.connected ? t("observe.waitingForLogs") : t("observe.clickConnectToStart") }}
      </div>
      <pre v-else ref="rightLogContainer" class="log-terminal"><span
  v-for="entry in right.logs"
  :key="entry.key"
  :class="logLevelClass(entry.level)"
>{{ formatLogLine(entry) }}
</span></pre>
    </div>
  </div>
</template>

<style scoped>
.live-logs-page {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.live-logs-page.dragging {
  cursor: col-resize;
  user-select: none;
}

/* ---- Log Panel ---- */
.log-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--observe-border, var(--el-border-color-light));
  border-radius: 8px;
  overflow: hidden;
  background: var(--observe-bg-card, #f6f8fa);
  margin: 4px;
}

html.dark .log-panel {
  background: var(--observe-bg-card, #1a1d23);
  border-color: var(--observe-border, #2d3139);
}

/* ---- Panel Header ---- */
.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--observe-bg-sidebar, #eef1f5);
  border-bottom: 1px solid var(--observe-border, var(--el-border-color-lighter));
  flex-shrink: 0;
}

html.dark .panel-header {
  background: var(--observe-bg-sidebar, #20242c);
  border-color: var(--observe-border, #2d3139);
}

.panel-icon {
  width: 15px;
  height: 15px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.panel-subtitle {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background 0.3s;
}

.status-dot.is-connected {
  background: #3fb950;
  box-shadow: 0 0 6px rgba(63, 185, 80, 0.5);
  animation: pulse-dot 1.5s ease-in-out infinite;
}

.status-dot.is-disconnected {
  background: #8b949e;
}

@keyframes pulse-dot {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

/* ---- Panel Toolbar ---- */
.panel-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--observe-border, var(--el-border-color-lighter));
  flex-shrink: 0;
  flex-wrap: wrap;
}

html.dark .panel-toolbar {
  border-color: var(--observe-border, #2d3139);
}

/* ---- Drag Handle ---- */
.drag-handle {
  width: 5px;
  cursor: col-resize;
  background: var(--el-border-color-lighter);
  flex-shrink: 0;
  transition: background 0.15s;
  margin: 4px 0;
}

.drag-handle:hover,
.dragging .drag-handle {
  background: var(--el-color-primary-light-5);
}

/* ---- Log Terminal ---- */
.log-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-placeholder);
  font-size: 13px;
  font-family: var(--font-mono);
  background: #1e1e2e;
}

html.dark .log-empty {
  background: #111;
  color: #585b70;
}

.log-terminal {
  flex: 1;
  overflow-y: auto;
  margin: 0;
  padding: 8px 14px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.7;
  color: #cdd6f4;
  white-space: pre-wrap;
  word-break: break-all;
  background: #1e1e2e;
}

html.dark .log-terminal {
  background: #111;
}

.log-info {
  color: #a6e3a1;
}

.log-warn {
  color: #f9e2af;
}

.log-error {
  color: #f38ba8;
}

.log-debug {
  color: #6c7086;
}
</style>
