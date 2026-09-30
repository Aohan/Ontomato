<script setup lang="ts">
import type { SkillInfo as WireSkillInfo } from "@ontomato/contracts/skills";
interface SkillInfo extends WireSkillInfo {
  callCount?: number;
  successRate?: number;
}

import { MoreHorizontal, TrendingUp, CircleCheck, CircleX } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  skill: SkillInfo;
  loading?: boolean;
}>();

const emit = defineEmits<{
  toggle: [skillId: string];
  edit: [skillId: string];
  delete: [skillId: string];
  debug: [skillId: string];
  export: [skillId: string];
}>();

function getCategoryLabel(category: string): string {
  if (category === "visualization") return t("admin.visualization");
  if (category === "analysis") return t("admin.analysis");
  return category;
}

function formatNumber(num?: number): string {
  if (num === undefined) return "-";
  if (num >= 10000) {
    return (num / 10000).toFixed(1) + "w";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + "k";
  }
  return String(num);
}
</script>

<template>
  <div class="skill-card" :class="{ disabled: !skill.enabled, loading }">
    <div class="skill-header">
      <div class="skill-title-row">
        <div class="skill-title-info">
          <span class="skill-title">{{ skill.title || skill.id }}</span>
          <el-tag
            :type="skill.type === 'executable' ? 'primary' : 'warning'"
            size="small"
            class="type-tag"
            effect="plain"
          >
            {{ skill.type === "executable" ? t("admin.executable") : t("admin.knowledge") }}
          </el-tag>
        </div>
        <div class="skill-actions">
          <el-tooltip
            :content="skill.enabled ? t('admin.clickDisable') : t('admin.clickEnable')"
            placement="top"
          >
            <el-switch
              :model-value="skill.enabled"
              :loading="loading"
              size="small"
              @change="emit('toggle', skill.id)"
            />
          </el-tooltip>
          <el-dropdown trigger="click" placement="bottom-end">
            <el-button class="more-btn" :icon="MoreHorizontal" size="small" text />
            <template #dropdown>
              <el-dropdown-menu class="skill-dropdown-menu">
                <el-dropdown-item
                  v-if="skill.type === 'executable'"
                  @click="emit('debug', skill.id)"
                >
                  {{ t("common.debug") }}
                </el-dropdown-item>
                <el-dropdown-item @click="emit('edit', skill.id)">
                  {{ t("common.edit") }}
                </el-dropdown-item>
                <el-dropdown-item @click="emit('export', skill.id)">
                  {{ t("common.export") }}
                </el-dropdown-item>
                <el-dropdown-item divided @click="emit('delete', skill.id)">
                  {{ t("common.delete") }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </div>

    <div class="skill-body">
      <div class="skill-description">
        {{ skill.description || t("common.noDescription") }}
      </div>

      <div class="skill-meta">
        <div class="meta-item">
          <span class="meta-label">{{ t("common.category") }}:</span>
          <el-tag type="info" size="small" effect="plain">
            {{ getCategoryLabel(skill.category) }}
          </el-tag>
        </div>
        <div class="meta-item">
          <span class="meta-label">{{ t("common.version") }}:</span>
          <span class="meta-value">{{ skill.version }}</span>
        </div>
      </div>

      <!-- Usage statistics -->
      <div
        v-if="skill.callCount !== undefined || skill.successRate !== undefined"
        class="skill-stats"
      >
        <div v-if="skill.callCount !== undefined" class="stat-item">
          <el-icon class="stat-icon"><TrendingUp /></el-icon>
          <span class="stat-label">{{ t("admin.calls") }}</span>
          <span class="stat-value">{{ formatNumber(skill.callCount) }}</span>
        </div>
        <div v-if="skill.successRate !== undefined" class="stat-item">
          <el-icon :class="['stat-icon', skill.successRate >= 95 ? 'success' : 'warning']">
            <CircleCheck v-if="skill.successRate >= 95" />
            <CircleX v-else />
          </el-icon>
          <span class="stat-label">{{ t("admin.successRate") }}</span>
          <span :class="['stat-value', skill.successRate >= 95 ? 'success' : 'warning']">
            {{ skill.successRate }}%
          </span>
        </div>
      </div>

      <div v-if="skill.tags.length > 0" class="skill-tags">
        <el-tag
          v-for="tag in skill.tags.slice(0, 3)"
          :key="tag"
          size="small"
          type="info"
          effect="plain"
        >
          {{ tag }}
        </el-tag>
        <span v-if="skill.tags.length > 3" class="more-tags">+{{ skill.tags.length - 3 }}</span>
      </div>

      <div v-if="!skill.enabled" class="disabled-overlay">
        <el-tag type="warning" size="small" effect="dark">{{ t("common.disabled") }}</el-tag>
      </div>
    </div>
  </div>
</template>

<style scoped>
.skill-card {
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-lg);
  padding: 20px;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  transition: all var(--transition-base);
  box-shadow: var(--el-shadow-sm);
}

.skill-card:hover {
  border-color: var(--el-color-primary);
  box-shadow: var(--el-shadow-md);
}

.skill-card.disabled {
  opacity: 0.6;
  background: var(--el-fill-color-light);
}

.skill-card.disabled:hover {
  box-shadow: var(--el-shadow-sm);
}

.skill-card.loading {
  pointer-events: none;
}

.skill-header {
  margin-bottom: 16px;
}

.skill-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.skill-title-info {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.type-tag {
  flex-shrink: 0;
}

.skill-title {
  font-weight: 600;
  font-size: var(--text-lg);
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.more-btn {
  color: var(--el-text-color-secondary);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}

.more-btn:hover {
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-light);
}

.skill-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.skill-description {
  font-size: var(--text-sm);
  color: var(--el-text-color-secondary);
  line-height: 1.6;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}

.skill-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.meta-label {
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}

.meta-value {
  font-size: var(--text-sm);
  color: var(--el-text-color-primary);
  font-weight: 600;
}

/* Usage statistics */
.skill-stats {
  display: flex;
  gap: 20px;
  padding: 10px 0;
  border-top: 1px solid var(--el-border-color-light);
  border-bottom: 1px solid var(--el-border-color-light);
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stat-icon {
  font-size: 16px;
  color: var(--el-text-color-secondary);
}

.stat-icon.success {
  color: var(--el-color-success);
}

.stat-icon.warning {
  color: var(--el-color-warning);
}

.stat-label {
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}

.stat-value {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.stat-value.success {
  color: var(--el-color-success);
}

.stat-value.warning {
  color: var(--el-color-warning);
}

.skill-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.more-tags {
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
  font-weight: 500;
}

.disabled-overlay {
  position: absolute;
  top: 20px;
  right: 20px;
}

/* Compact dropdown menu style */
.skill-dropdown-menu {
  padding: 4px 0;
}

.skill-dropdown-menu .el-dropdown-menu__item {
  padding: 6px 16px;
  font-size: var(--text-sm);
  border-radius: 4px;
  margin: 0 4px;
}

.skill-dropdown-menu .el-dropdown-menu__item:hover {
  background: var(--el-fill-color-light);
}

.skill-dropdown-menu .el-dropdown-menu__item--divided {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--el-border-color-light);
}
</style>
