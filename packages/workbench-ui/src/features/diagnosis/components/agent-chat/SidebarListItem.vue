<script setup lang="ts">
import { Bookmark, Trash2 } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  title: string;
  subtitle?: string;
  status?: "success" | "failed" | "running" | "error";
  active?: boolean;
  keepable?: boolean;
  kept?: boolean;
  keepLoading?: boolean;
  deletable?: boolean;
  deleteDisabled?: boolean;
  deleteLoading?: boolean;
  deleteTooltip?: string;
}>();

defineEmits<{
  click: [];
  "toggle-keep": [event: MouseEvent];
  "delete-item": [event: MouseEvent];
}>();
</script>

<template>
  <div :class="['sidebar-list-item', { active, deletable, keepable }]" @click="$emit('click')">
    <div class="item-content">
      <span class="item-title">{{ title }}</span>
      <span v-if="subtitle" class="item-subtitle">{{ subtitle }}</span>
    </div>
    <span v-if="status" :class="['item-status', `status-${status}`]">
      <template v-if="status === 'success'">&#10003;</template>
      <template v-else-if="status === 'failed'">&#10007;</template>
      <template v-else-if="status === 'running'">
        <span class="running-dot" />
      </template>
      <template v-else-if="status === 'error'">&#9888;</template>
    </span>
    <el-tooltip
      v-if="keepable"
      :content="kept ? t('diagnosis.unkeepArtifact') : t('diagnosis.keepArtifact')"
      placement="right"
    >
      <el-button
        :class="['item-keep-btn', { kept }]"
        text
        size="small"
        :icon="Bookmark"
        :loading="keepLoading"
        :disabled="keepLoading"
        :aria-label="kept ? t('diagnosis.unkeepArtifact') : t('diagnosis.keepArtifact')"
        @click.stop="$emit('toggle-keep', $event)"
      />
    </el-tooltip>
    <el-tooltip v-if="deletable" :content="deleteTooltip || t('common.delete')" placement="right">
      <el-button
        class="item-delete-btn"
        text
        size="small"
        :icon="Trash2"
        :loading="deleteLoading"
        :disabled="deleteDisabled || deleteLoading"
        :aria-label="t('common.delete')"
        @click.stop="$emit('delete-item', $event)"
      />
    </el-tooltip>
  </div>
</template>

<style scoped>
.sidebar-list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 2px;
  transition: background 0.15s;
  position: relative;
}

.sidebar-list-item:hover {
  background: var(--observe-bg-hover, var(--el-fill-color-light));
}

.sidebar-list-item.active {
  background: var(--observe-bg-active, var(--el-color-primary-light-9));
}

.sidebar-list-item.deletable {
  gap: 0;
}

.item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}

.item-subtitle {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- Status indicators ---- */

.item-status {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.item-delete-btn,
.item-keep-btn {
  flex-shrink: 0;
  width: 28px !important;
  height: 28px !important;
  min-height: 28px !important;
  padding: 5px !important;
  font-size: 18px !important;
  opacity: 0;
  pointer-events: none;
  transition:
    color 0.15s,
    opacity 0.15s;
}

.item-delete-btn {
  margin-left: 0 !important;
  color: var(--el-color-danger) !important;
}

.item-keep-btn {
  color: var(--el-text-color-secondary) !important;
}

.item-keep-btn.kept {
  color: var(--el-color-primary) !important;
  opacity: 1;
  pointer-events: auto;
}

.item-keep-btn.kept :deep(svg) {
  fill: currentColor;
}

.sidebar-list-item:hover .item-delete-btn,
.sidebar-list-item:hover .item-keep-btn,
.item-delete-btn:focus-visible,
.item-keep-btn:focus-visible,
.item-delete-btn.is-loading,
.item-keep-btn.is-loading {
  opacity: 1;
  pointer-events: auto;
}

.status-success {
  color: var(--el-color-success);
}

.status-failed {
  color: var(--el-color-danger);
}

.status-running {
  color: var(--el-color-primary);
}

.status-error {
  color: var(--el-color-warning);
}

.running-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-primary);
  animation: pulse-running 1.5s ease-in-out infinite;
}

@keyframes pulse-running {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.75);
  }
}
</style>
