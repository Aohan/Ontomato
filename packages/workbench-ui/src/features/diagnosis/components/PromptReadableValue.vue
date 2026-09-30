<script setup lang="ts">
import type { PromptReadableValue } from "../utils/prompt-transcript-parser";

defineProps<{
  value: PromptReadableValue;
}>();
</script>

<template>
  <div v-if="value.kind === 'fields'" class="prompt-value prompt-value--fields">
    <div v-for="field in value.fields" :key="field.key" class="prompt-value__field">
      <div class="prompt-value__key">{{ field.key }}</div>
      <pre class="prompt-value__content">{{ field.text }}</pre>
    </div>
  </div>
  <pre v-else class="prompt-value prompt-value__content">{{ value.text }}</pre>
</template>

<style scoped>
.prompt-value {
  margin: 0;
}

.prompt-value--fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.prompt-value__field {
  min-width: 0;
}

.prompt-value__key {
  margin-bottom: 4px;
  color: var(--el-text-color-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.prompt-value__content {
  margin: 0;
  color: var(--el-text-color-primary);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
