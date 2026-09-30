<script setup lang="ts">
import { ElButton } from "element-plus";
import { Database } from "lucide-vue-next";
import type { Workspace } from "../workspace";
import { useOntologyText } from "../context";

const { ot } = useOntologyText();

defineProps<{
  workspace: Workspace;
  title: string;
  description: string;
}>();

defineEmits<{ browse: [] }>();
</script>

<template>
  <header class="content-header">
    <div class="page-heading">
      <h1>{{ title }}</h1>
      <p>{{ description }}</p>
    </div>
    <el-button
      v-if="workspace === 'model'"
      type="primary"
      :icon="Database"
      @click="$emit('browse')"
    >
      {{ ot("browseObjectData") }}
    </el-button>
  </header>
</template>

<style scoped>
.content-header {
  display: flex;
  min-height: 92px;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-lg);
  padding: var(--spacing-lg) var(--spacing-2xl);
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.page-heading {
  min-width: 0;
}
h1 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-2xl);
  font-weight: var(--font-semibold);
}
p {
  margin: 5px 0 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
@container ontology-manager (max-width: 900px) {
  .content-header {
    min-height: 78px;
    padding: var(--spacing-md);
  }
  h1 {
    font-size: var(--text-xl);
  }
}
@container ontology-manager (max-width: 560px) {
  .content-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .content-header :deep(.el-button) {
    width: 100%;
  }
}
</style>
