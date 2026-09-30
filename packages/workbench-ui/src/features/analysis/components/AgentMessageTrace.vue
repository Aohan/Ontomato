<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { EgressMessage } from "@ontomato/contracts/agent-egress";
import { renderAgentMarkdownWithJsonFormatting } from "../../../utils/agent-markdown";

const props = defineProps<{
  /** Public messages already filtered by egress; internal thinking and probe bodies are not included. */
  messages: EgressMessage[];
  /** worker: dispatched sub-traces; turn: per-turn public messages. Each uses its own existing copy. */
  variant?: "worker" | "turn";
}>();

const { t } = useI18n();

function labelFor(message: EgressMessage): string {
  if (props.variant === "worker") {
    if (message.role === "user") return t("analysis.loopWorkerAssigned");
    if (message.role === "toolResult")
      return t("analysis.loopWorkerToolResult", { tool: message.toolName || "-" });
    return t("analysis.loopWorkerReply");
  }
  if (message.role === "toolResult") return message.toolName;
  return t(message.role === "user" ? "harness.user" : "harness.assistant");
}

function formatArguments(args: Record<string, unknown>): string {
  return Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : "";
}
</script>

<template>
  <div class="message-trace">
    <div v-for="(message, index) in messages" :key="index" class="loop-trace-message">
      <div class="loop-trace-role">{{ labelFor(message) }}</div>
      <template v-for="(part, partIndex) in message.content" :key="partIndex">
        <!-- Per-turn public messages reuse the safe renderer of the old AgentMessageTrace (html:false); worker traces stay plain text -->
        <div v-if="part.type === 'text'" class="loop-trace-text">
          <div
            v-if="variant === 'turn'"
            class="markdown-body"
            v-html="renderAgentMarkdownWithJsonFormatting(part.text)"
          ></div>
          <template v-else>{{ part.text }}</template>
        </div>
        <div v-else-if="part.type === 'toolCall'" class="loop-trace-tool">
          <div>{{ t("harness.toolCall") }} · {{ part.name }}</div>
          <pre v-if="formatArguments(part.arguments)">{{ formatArguments(part.arguments) }}</pre>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.message-trace {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.loop-trace-message {
  padding: 8px 10px;
  border-left: 2px solid var(--el-border-color);
  background: var(--el-bg-color);
  border-radius: 0 8px 8px 0;
}

.loop-trace-role {
  font-size: 11px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.loop-trace-text,
.loop-trace-tool {
  margin-top: 3px;
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.loop-trace-text :deep(a) {
  color: var(--el-color-primary);
  text-decoration: underline;
}

.loop-trace-text :deep(p) {
  margin: 4px 0;
}

.loop-trace-text :deep(pre) {
  max-height: 240px;
  margin: 5px 0 0;
  padding: 8px;
  overflow: auto;
  border-radius: 6px;
  background: var(--el-fill-color-light);
}

.loop-trace-text :deep(code) {
  font-family: var(--font-mono);
}

.loop-trace-tool pre {
  max-height: 240px;
  margin: 5px 0 0;
  padding: 8px;
  overflow: auto;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  font: 11px/1.5 var(--font-mono);
  white-space: pre-wrap;
}
</style>
