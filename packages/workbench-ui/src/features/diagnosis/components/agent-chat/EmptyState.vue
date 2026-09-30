<script setup lang="ts">
import { Search, FileText, MessageSquare } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

useI18n();

const props = defineProps<{
  icon?: string;
  title: string;
  subtitle?: string;
}>();

const iconMap: Record<string, any> = {
  search: Search,
  "file-text": FileText,
  "message-square": MessageSquare,
};

const iconComponent = props.icon ? iconMap[props.icon] || Search : Search;
</script>

<template>
  <div class="empty-state">
    <div class="empty-state-icon">
      <component :is="iconComponent" :size="48" :stroke-width="1.2" />
    </div>
    <p class="empty-state-title">{{ title }}</p>
    <p v-if="subtitle" class="empty-state-subtitle">{{ subtitle }}</p>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 200px;
  gap: 12px;
  padding: 40px 20px;
}

.empty-state-icon {
  color: var(--el-text-color-placeholder);
  opacity: 0.45;
}

.empty-state-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.empty-state-subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-placeholder);
  text-align: center;
  max-width: 320px;
  line-height: 1.5;
}
</style>
