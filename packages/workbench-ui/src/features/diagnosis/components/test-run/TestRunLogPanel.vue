<script setup lang="ts">
import { nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";

defineProps<{
  logLines: Array<{ level: string; ts: string; msg: string }>;
  isRunning: boolean;
}>();

const emit = defineEmits<{
  clear: [];
}>();

const { t } = useI18n();
const logContainer = ref<HTMLElement | null>(null);

function scrollToBottom() {
  nextTick(() => {
    const el = logContainer.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

defineExpose({ scrollToBottom });
</script>

<template>
  <div class="right-panel">
    <div class="log-bar">
      <span class="log-status-dot" :class="{ active: isRunning }" />
      <span class="log-bar-title">{{ t("diagnosis.terminal") }}</span>
      <span v-if="logLines.length > 0" class="log-count">
        {{ t("diagnosis.logCount", { n: logLines.length }) }}
      </span>
      <span class="log-bar-spacer" />
      <el-button text size="small" @click="emit('clear')">{{ t("common.clear") }}</el-button>
      <el-button text size="small" @click="scrollToBottom">
        {{ t("diagnosis.scrollToBottom") }}
      </el-button>
    </div>
    <div v-if="logLines.length === 0" class="log-empty">
      <div class="log-empty-icon">&#9654;</div>
      <div class="log-empty-main">{{ t("diagnosis.waitingLog") }}</div>
      <div class="log-empty-sub">{{ t("diagnosis.startTestLogHint") }}</div>
    </div>
    <pre v-else ref="logContainer" class="log-terminal"><span
  v-for="(line, i) in logLines"
  :key="i"
  :class="'log-' + line.level"
><span class="log-ts">{{ line.ts }}</span> {{ line.msg }}
</span><span v-if="isRunning" class="log-cursor">&#9608;</span></pre>
  </div>
</template>

<style scoped>
.right-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--observe-bg-card, #f6f8fa);
  border: 0.5px solid var(--observe-border, var(--el-border-color));
  border-radius: 8px;
  margin: 8px 8px 8px 0;
  overflow: hidden;
}

html.dark .right-panel {
  background: var(--observe-bg-card, #1a1d23);
  border-color: var(--observe-border, #2d3139);
}

.log-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: var(--observe-bg-sidebar, #eef1f5);
  border-bottom: 0.5px solid var(--observe-border, var(--el-border-color-lighter));
  flex-shrink: 0;
}

html.dark .log-bar {
  background: var(--observe-bg-sidebar, #20242c);
  border-color: var(--observe-border, #2d3139);
}

.log-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #8b949e;
  flex-shrink: 0;
  transition: background 0.3s;
}

.log-status-dot.active {
  background: #3fb950;
  box-shadow: 0 0 6px rgba(63, 185, 80, 0.6);
  animation: pulse-dot 1.5s ease-in-out infinite;
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

.log-bar-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  letter-spacing: 0.3px;
}

.log-count {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  background: var(--el-fill-color);
  padding: 1px 6px;
  border-radius: 8px;
}

.log-bar-spacer {
  flex: 1;
}

.log-bar :deep(.el-button) {
  color: var(--el-text-color-secondary) !important;
}

.log-bar :deep(.el-button:hover) {
  color: var(--el-text-color-primary) !important;
}

.log-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--el-text-color-placeholder);
}

.log-empty-icon {
  font-size: 28px;
  opacity: 0.2;
  margin-bottom: 4px;
}

.log-empty-main {
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
}

.log-empty-sub {
  font-size: 12px;
}

.log-terminal {
  flex: 1;
  overflow-y: auto;
  margin: 0;
  padding: 10px 14px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.8;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
  word-break: break-all;
  background: transparent;
}

html.dark .log-terminal {
  color: #c9d1d9;
}

.log-ts {
  color: var(--el-text-color-placeholder);
  margin-right: 4px;
}

.log-info {
  color: #1a7f37;
}

.log-warn,
.log-warning {
  color: #9a6700;
}

.log-error {
  color: #cf222e;
  font-weight: 500;
}

.log-debug {
  color: var(--el-text-color-placeholder);
}

html.dark .log-info {
  color: #3fb950;
}

html.dark .log-warn,
html.dark .log-warning {
  color: #d29922;
}

html.dark .log-error {
  color: #f85149;
}

.log-cursor {
  color: var(--el-color-primary);
  animation: blink-cursor 1s step-end infinite;
  font-size: 10px;
}

@keyframes blink-cursor {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}
</style>
