<script setup lang="ts">
import type { SessionHistoryMessage as AgentChatMessage } from "@ontomato/contracts/diagnosis";
import { computed, ref } from "vue";
import { ChevronDown, ChevronUp, Wrench, Brain } from "lucide-vue-next";

import { formatToolArgs, formatToolResult } from "../../composables/useAgentChat";
import { renderAgentMarkdown } from "../../../../utils/agent-markdown";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  message: AgentChatMessage;
  messageIndex: number;
}>();

/* ------------------------------------------------------------------ */
/*  Expand / collapse state                                            */
/* ------------------------------------------------------------------ */

const expandedTools = ref<Set<string>>(new Set());
const expandedThinking = ref<Set<number>>(new Set());

function toggleTool(toolCallId: string) {
  if (expandedTools.value.has(toolCallId)) {
    expandedTools.value.delete(toolCallId);
  } else {
    expandedTools.value.add(toolCallId);
  }
}

function toggleThinking(segIndex: number) {
  const key = props.messageIndex * 1000 + segIndex;
  if (expandedThinking.value.has(key)) {
    expandedThinking.value.delete(key);
  } else {
    expandedThinking.value.add(key);
  }
}

function isThinkingExpanded(segIndex: number): boolean {
  return expandedThinking.value.has(props.messageIndex * 1000 + segIndex);
}

function renderText(content: string): string {
  return renderAgentMarkdown(content);
}

const hasSegments = computed(() => {
  const msg = props.message;
  return msg.role === "assistant" && msg.segments && msg.segments.length > 0;
});

const fallbackMarkdown = computed(() => {
  const msg = props.message;
  if (msg.role === "user" || hasSegments.value || !msg.content.trim()) return "";
  return renderAgentMarkdown(msg.content);
});
</script>

<template>
  <!-- User message -->
  <div v-if="message.role === 'user'" class="agent-msg agent-msg--user">
    <div class="agent-msg__bubble">
      {{ message.content }}
    </div>
  </div>

  <!-- Assistant message -->
  <div v-else class="agent-msg agent-msg--assistant">
    <template v-if="hasSegments && message.segments">
      <template v-for="(seg, si) in message.segments" :key="si">
        <div
          v-if="seg.type === 'text' && seg.content.trim()"
          class="agent-msg__markdown markdown-content"
          v-html="renderText(seg.content)"
        />

        <!-- Thinking -->
        <div v-else-if="seg.type === 'thinking'" class="agent-thinking">
          <div class="agent-thinking__header" @click="toggleThinking(si)">
            <Brain :size="14" class="agent-thinking__icon" />
            <span class="agent-thinking__label">{{ t("thinking.thinkingProcess") }}</span>
            <component
              :is="isThinkingExpanded(si) ? ChevronUp : ChevronDown"
              :size="14"
              class="agent-thinking__arrow"
            />
          </div>
          <pre v-if="isThinkingExpanded(si)" class="agent-thinking__content">{{ seg.content }}</pre>
        </div>

        <!-- Tool call -->
        <div
          v-else-if="seg.type === 'tool_call'"
          :class="['agent-tool', { 'agent-tool--error': seg.isError }]"
        >
          <div class="agent-tool__header" @click="toggleTool(seg.toolCallId)">
            <Wrench :size="14" class="agent-tool__icon" />
            <span class="agent-tool__name">{{ seg.tool }}</span>
            <span
              v-if="seg.status === 'running'"
              class="agent-tool__status agent-tool__status--running"
            >
              {{ t("diagnosis.executing") }}
            </span>
            <span v-else-if="seg.isError" class="agent-tool__status agent-tool__status--failed">
              {{ t("common.failed") }}
            </span>
            <span v-else class="agent-tool__status agent-tool__status--done">
              {{ t("common.complete") }}
            </span>
            <component
              :is="expandedTools.has(seg.toolCallId) ? ChevronUp : ChevronDown"
              :size="14"
              class="agent-tool__arrow"
            />
          </div>
          <div v-if="expandedTools.has(seg.toolCallId)" class="agent-tool__detail">
            <div v-if="seg.args" class="agent-tool__section">
              <div class="agent-tool__section-label">{{ t("common.parameters") }}</div>
              <pre class="agent-tool__section-content">{{ formatToolArgs(seg.args) }}</pre>
            </div>
            <div v-if="seg.status === 'done'" class="agent-tool__section">
              <div class="agent-tool__section-label">{{ t("common.result") }}</div>
              <pre
                :class="[
                  'agent-tool__section-content',
                  { 'agent-tool__section-content--error': seg.isError },
                ]"
                >{{ formatToolResult(seg.result) }}</pre
              >
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- Fallback for legacy/plain-text assistant messages. -->
    <div
      v-else-if="fallbackMarkdown"
      class="agent-msg__markdown markdown-content"
      v-html="fallbackMarkdown"
    />
  </div>
</template>

<style scoped>
/* ================================================================== */
/*  User message bubble                                                */
/* ================================================================== */

.agent-msg--user {
  display: flex;
  justify-content: flex-end;
  padding: 0 4px;
}

.agent-msg__bubble {
  max-width: 70%;
  padding: 10px 16px;
  background: var(--el-color-primary);
  color: var(--on-primary);
  border-radius: 16px 4px 16px 16px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
  white-space: pre-wrap;
}

html.dark .agent-msg__bubble {
  background: var(--el-color-primary-dark-2);
}

/* ================================================================== */
/*  Assistant message                                                  */
/* ================================================================== */

.agent-msg--assistant {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 4px;
  width: 100%;
}

/* Markdown content inherits global .markdown-content styles from style.css */
.agent-msg__markdown {
  font-size: 14px;
  line-height: 1.7;
  color: var(--el-text-color-primary);
}

/* First child margin reset */
.agent-msg__markdown :deep(> *:first-child) {
  margin-top: 0;
}

.agent-msg__markdown :deep(> *:last-child) {
  margin-bottom: 0;
}

/* ================================================================== */
/*  Thinking block                                                     */
/* ================================================================== */

.agent-thinking {
  border-left: 3px solid var(--el-color-info-light-5);
  border-radius: 4px;
  background: var(--observe-bg-card, var(--el-fill-color-lighter));
  overflow: hidden;
}

.agent-thinking__header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  user-select: none;
  transition: background var(--transition-fast);
}

.agent-thinking__header:hover {
  background: var(--el-fill-color-light);
}

.agent-thinking__icon {
  flex-shrink: 0;
  opacity: 0.7;
}

.agent-thinking__label {
  font-weight: 500;
}

.agent-thinking__arrow {
  margin-left: auto;
  flex-shrink: 0;
  opacity: 0.5;
}

.agent-thinking__content {
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  font-family: var(--font-sans);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--el-text-color-secondary);
  border-top: 1px solid var(--el-border-color-lighter);
  max-height: 300px;
  overflow-y: auto;
}

/* ================================================================== */
/*  Tool call block                                                    */
/* ================================================================== */

.agent-tool {
  border: 1px solid var(--observe-border, var(--el-border-color-light));
  border-radius: 8px;
  background: var(--observe-bg-card, var(--el-bg-color));
  overflow: hidden;
}

.agent-tool--error {
  border-color: var(--el-color-danger-light-5);
}

.agent-tool__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);
}

.agent-tool__header:hover {
  background: var(--el-fill-color-lighter);
}

.agent-tool__icon {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}

.agent-tool__name {
  font-size: 13px;
  font-weight: 500;
  font-family: var(--font-mono);
  color: var(--el-text-color-primary);
}

.agent-tool__status {
  font-size: 12px;
}

.agent-tool__status--running {
  color: var(--el-color-warning);
  animation: agent-tool-pulse 1.5s infinite;
}

.agent-tool__status--failed {
  color: var(--el-color-danger);
  font-weight: 500;
}

.agent-tool__status--done {
  color: var(--el-color-success);
}

.agent-tool__arrow {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
  opacity: 0.5;
}

.agent-tool__detail {
  border-top: 1px solid var(--el-border-color-lighter);
}

.agent-tool__section + .agent-tool__section {
  border-top: 1px solid var(--el-border-color-lighter);
}

.agent-tool__section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  padding: 6px 10px 2px;
  text-transform: uppercase;
}

.agent-tool__section-content {
  margin: 0;
  padding: 4px 10px 8px;
  font-size: 12px;
  font-family: var(--font-mono);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
  color: var(--el-text-color-regular);
}

.agent-tool__section-content--error {
  color: var(--el-color-danger);
}

@keyframes agent-tool-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

/* ================================================================== */
/*  highlight.js code block styling                                    */
/* ================================================================== */

.agent-msg__markdown :deep(.hljs-code-block) {
  background: var(--el-fill-color-light);
  border: 1px solid var(--observe-border, var(--el-border-color));
  border-radius: 8px;
  padding: 14px 16px;
  margin: 12px 0;
  overflow-x: auto;
}

.agent-msg__markdown :deep(.hljs-code-block code) {
  background: none;
  border: none;
  padding: 0;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
}

html.dark .agent-msg__markdown :deep(.hljs-code-block) {
  background: var(--el-fill-color-dark);
  border-color: var(--observe-border, var(--el-border-color-dark));
}

/* highlight.js token colors */
.agent-msg__markdown :deep(.hljs-keyword),
.agent-msg__markdown :deep(.hljs-selector-tag),
.agent-msg__markdown :deep(.hljs-built_in) {
  color: var(--el-color-primary);
}

.agent-msg__markdown :deep(.hljs-string),
.agent-msg__markdown :deep(.hljs-attr) {
  color: var(--el-text-color-primary);
}

.agent-msg__markdown :deep(.hljs-number),
.agent-msg__markdown :deep(.hljs-literal) {
  color: var(--el-color-primary-dark-2);
}

.agent-msg__markdown :deep(.hljs-comment) {
  color: var(--el-text-color-secondary);
  font-style: italic;
}

.agent-msg__markdown :deep(.hljs-title),
.agent-msg__markdown :deep(.hljs-function) {
  color: color-mix(in srgb, var(--el-color-primary) 70%, var(--el-text-color-primary));
}

.agent-msg__markdown :deep(.hljs-type),
.agent-msg__markdown :deep(.hljs-class) {
  color: color-mix(in srgb, var(--el-color-warning) 70%, var(--el-text-color-primary));
}

html.dark .agent-msg__markdown :deep(.hljs-keyword),
html.dark .agent-msg__markdown :deep(.hljs-selector-tag),
html.dark .agent-msg__markdown :deep(.hljs-built_in) {
  color: color-mix(in srgb, var(--el-color-primary) 60%, transparent);
}

html.dark .agent-msg__markdown :deep(.hljs-string),
html.dark .agent-msg__markdown :deep(.hljs-attr) {
  color: color-mix(in srgb, var(--el-color-primary) 50%, transparent);
}

html.dark .agent-msg__markdown :deep(.hljs-number),
html.dark .agent-msg__markdown :deep(.hljs-literal) {
  color: color-mix(in srgb, var(--el-color-primary) 40%, transparent);
}

html.dark .agent-msg__markdown :deep(.hljs-comment) {
  color: var(--el-text-color-tertiary);
}

html.dark .agent-msg__markdown :deep(.hljs-title),
html.dark .agent-msg__markdown :deep(.hljs-function) {
  color: color-mix(in srgb, var(--el-color-primary) 60%, transparent);
}

html.dark .agent-msg__markdown :deep(.hljs-type),
html.dark .agent-msg__markdown :deep(.hljs-class) {
  color: color-mix(in srgb, var(--el-color-warning) 70%, transparent);
}
</style>
