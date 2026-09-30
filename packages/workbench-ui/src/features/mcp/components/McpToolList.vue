<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { McpTool } from "../api";
defineProps<{ tools: McpTool[] }>();
const { t } = useI18n();
</script>

<template>
  <div class="tool-list">
    <p v-if="!tools.length" class="muted">{{ t("mcp.noTools") }}</p>
    <details v-for="tool in tools" :key="tool.name">
      <summary>
        <strong>{{ tool.title || tool.name }}</strong>
        <code v-if="tool.title">{{ tool.name }}</code>
      </summary>
      <p v-if="tool.description">{{ tool.description }}</p>
      <template v-if="tool.inputSchema">
        <div class="muted">{{ t("hotData.inputParams") }}</div>
        <pre>{{ JSON.stringify(tool.inputSchema, null, 2) }}</pre>
      </template>
    </details>
  </div>
</template>

<style scoped>
.tool-list {
  margin-top: 12px;
}
details {
  border-top: 1px solid var(--el-border-color-lighter);
  padding: 8px 0;
}
summary {
  cursor: pointer;
  line-height: 28px;
  overflow-wrap: anywhere;
}
summary:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
strong {
  font-weight: 500;
}
summary code {
  margin-left: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
p {
  margin: 8px 0;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--el-fill-color-light);
  padding: 12px;
  border-radius: 6px;
  font-size: 12px;
}
.muted {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
