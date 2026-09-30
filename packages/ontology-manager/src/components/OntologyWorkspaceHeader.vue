<script setup lang="ts">
import { Orbit } from "lucide-vue-next";
import { useSharedText } from "../context";

defineEmits<{ home: [] }>();
const { t } = useSharedText();
</script>

<template>
  <header class="workspace-header">
    <button class="brand" :title="t('nav.ontologyGraph')" @click="$emit('home')">
      <span class="brand-mark"><Orbit :size="18" /></span>
      <span>
        <strong>{{ t("nav.ontologyManager") }}</strong>
      </span>
    </button>
  </header>
</template>

<style scoped>
.workspace-header {
  display: flex;
  height: 52px;
  flex: 0 0 52px;
  align-items: center;
  padding: 0 var(--spacing-lg);
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 0;
  border: 0;
  color: var(--el-text-color-primary);
  background: transparent;
  text-align: left;
}
.brand-mark {
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
}
.brand-mark {
  width: 30px;
  height: 30px;
  color: var(--on-primary);
  background: var(--el-color-primary);
}
.brand strong,
.brand small {
  display: block;
}
.brand strong {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}
.brand small {
  margin-top: 1px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
@container ontology-manager (max-width: 640px) {
  .workspace-header {
    padding: 0 var(--spacing-md);
  }
}
</style>
