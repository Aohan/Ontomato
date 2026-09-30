<script setup lang="ts">
import { computed } from "vue";
import { Bookmark } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  title: string;
  subtitle?: string;
  status?: "running" | "failed";
  active?: boolean;
  kept?: boolean;
}>();

const emit = defineEmits<{
  click: [];
}>();

const { t } = useI18n();

const compactLabel = computed(() => {
  const words = props.title.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return "–";

  const label =
    words.length > 1
      ? words
          .slice(0, 2)
          .map((word) => Array.from(word)[0])
          .join("")
      : Array.from(words[0]).slice(0, 2).join("");

  return label.toLocaleUpperCase();
});

const tooltipContent = computed(() => {
  const parts = [props.title, props.subtitle];
  if (props.status === "running") parts.push(t("common.inProgress"));
  if (props.status === "failed") parts.push(t("common.failed"));
  if (props.kept) parts.push(t("diagnosis.keepArtifact"));
  return parts.filter(Boolean).join(" · ");
});
</script>

<template>
  <el-tooltip :content="tooltipContent" placement="right" :show-after="250">
    <button
      type="button"
      :class="['compact-history-item', { active }]"
      :aria-label="tooltipContent"
      :aria-current="active ? 'true' : undefined"
      @click="emit('click')"
    >
      <span class="compact-history-label" aria-hidden="true">{{ compactLabel }}</span>
      <span
        v-if="status"
        :class="['compact-history-status', `status-${status}`]"
        aria-hidden="true"
      />
      <Bookmark v-if="kept" class="compact-history-kept" :stroke-width="2.25" aria-hidden="true" />
    </button>
  </el-tooltip>
</template>

<style scoped>
.compact-history-item {
  position: relative;
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    color 0.2s,
    background 0.2s;
}

.compact-history-item:hover {
  color: var(--el-text-color-primary);
  background: var(--observe-bg-hover, var(--el-fill-color-light));
}

.compact-history-item.active {
  color: var(--el-color-primary);
  background: var(--observe-bg-active, var(--el-color-primary-light-9));
  font-weight: 600;
}

.compact-history-item.active::before {
  content: "";
  position: absolute;
  top: 9px;
  bottom: 9px;
  left: 2px;
  width: 3px;
  border-radius: 2px;
  background: var(--el-color-primary);
}

.compact-history-item:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}

.compact-history-label {
  max-width: 30px;
  overflow: hidden;
  color: inherit;
  font-size: 12px;
  line-height: 1;
  letter-spacing: 0.02em;
  text-overflow: clip;
  white-space: nowrap;
}

.compact-history-status {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 7px;
  height: 7px;
  border: 2px solid var(--observe-bg-sidebar, var(--el-bg-color));
  border-radius: 50%;
  box-sizing: content-box;
}

.compact-history-status.status-running {
  background: var(--el-color-primary);
  animation: compact-status-pulse 1.5s ease-in-out infinite;
}

.compact-history-status.status-failed {
  background: var(--el-color-danger);
}

.compact-history-kept {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 11px;
  height: 11px;
  color: var(--el-color-primary);
  fill: currentColor;
}

@keyframes compact-status-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .compact-history-status.status-running {
    animation: none;
  }
}
</style>
