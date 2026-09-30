<script setup lang="ts">
import { Sparkles } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../../content";

const { t } = useI18n();

const emit = defineEmits<{
  quickAction: [question: string];
}>();

const { welcomePrompts } = workbenchContent().text.observe;
const quickActions = [
  { key: welcomePrompts.analyzeSystem, label: t("diagnosis.analyzeSystem") },
  { key: welcomePrompts.troubleshootConfig, label: t("diagnosis.troubleshootConfig") },
  { key: welcomePrompts.checkLLM, label: t("diagnosis.checkLLM") },
  { key: welcomePrompts.viewRecentErrors, label: t("diagnosis.viewRecentErrors") },
];
</script>

<template>
  <div class="welcome-page">
    <div class="welcome-content">
      <div class="welcome-icon">
        <Sparkles :size="32" />
      </div>
      <h2 class="welcome-title">{{ t("diagnosis.helloAssistant") }}</h2>
      <p class="welcome-subtitle">{{ t("diagnosis.assistantDesc") }}</p>
      <div class="welcome-actions">
        <button
          v-for="action in quickActions"
          :key="action.key"
          class="welcome-action-btn"
          @click="emit('quickAction', action.key)"
        >
          {{ action.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome-page {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  padding: 24px;
}

.welcome-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}

.welcome-icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  margin-bottom: 8px;
}

html.dark .welcome-icon {
  background: color-mix(in srgb, var(--el-color-primary) 15%, transparent);
}

.welcome-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  letter-spacing: -0.02em;
}

.welcome-subtitle {
  margin: 0;
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

.welcome-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 20px;
}

.welcome-action-btn {
  appearance: none;
  border: 1px solid var(--observe-border, var(--el-border-color));
  background: var(--observe-bg-card, var(--el-bg-color));
  color: var(--el-text-color-regular);
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 13px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    color var(--transition-fast),
    background var(--transition-fast),
    box-shadow var(--transition-fast);
  white-space: nowrap;
}

.welcome-action-btn:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  box-shadow: 0 1px 4px var(--shadow-card);
}

html.dark .welcome-action-btn {
  background: var(--observe-bg-card, var(--el-fill-color-dark));
  border-color: var(--observe-border, var(--el-border-color-dark));
}

html.dark .welcome-action-btn:hover {
  background: color-mix(in srgb, var(--el-color-primary) 12%, transparent);
  border-color: var(--el-color-primary);
}
</style>
