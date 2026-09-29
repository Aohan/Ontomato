<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useDashboardStore } from "../stores/dashboard";
import { MoreHorizontal, X } from "lucide-vue-next";
import { useLocale } from "../../../composables/useLocale";
import { formatRelativeTime } from "../../../utils/relative-time";

const dashboardStore = useDashboardStore();
const {
  showDashboardPanel: open,
  loadingDashboards: loading,
  dashboardItems: items,
  currentDashboardId,
  editingDashboardId,
  editingDashboardName,
} = storeToRefs(dashboardStore);

const { t } = useLocale();
/** The open-source layout passes closeIcon: the close button uses an X icon with an accessible label; layouts that omit it keep the original text "x" button. */
defineProps<{ closeIcon?: boolean }>();
const emit = defineEmits<{ openDashboard: [] }>();

function openDashboard(id: string) {
  dashboardStore.openDashboard(id);
  emit("openDashboard");
}
</script>

<template>
  <div class="dashboard-expand" :class="{ open }">
    <div class="dashboard-expand-inner">
      <div class="dashboard-expand-title">
        {{ t("analysis.myDashboards") }}
        <button
          v-if="closeIcon"
          type="button"
          class="dashboard-close-btn"
          :aria-label="t('common.close')"
          :title="t('common.close')"
          @click="open = false"
        >
          <X :size="14" />
        </button>
        <button v-else class="dashboard-close-btn" @click="open = false">x</button>
      </div>
      <div v-loading="loading" class="db-list">
        <div v-if="!loading && items.length === 0" class="db-empty">
          {{ t("analysis.noDashboards") }}
        </div>
        <div
          v-for="item in items"
          :key="item.id"
          class="db-item"
          :class="{
            active: item.id === currentDashboardId,
            editing: editingDashboardId === item.id,
          }"
          @click="editingDashboardId !== item.id && openDashboard(item.id)"
        >
          <template v-if="editingDashboardId === item.id">
            <el-input
              v-model="editingDashboardName"
              size="small"
              @keydown.enter.stop.prevent="dashboardStore.saveDashboardRename(item)"
              @keydown.esc.stop.prevent="dashboardStore.cancelDashboardRename()"
              @blur="dashboardStore.saveDashboardRename(item)"
            />
          </template>
          <template v-else>
            <div class="db-info">
              <div class="db-name">{{ item.name }}</div>
              <div class="db-meta">
                {{ item.updatedAt ? formatRelativeTime(item.updatedAt) : "" }}
              </div>
            </div>
            <el-dropdown
              trigger="click"
              popper-class="dash-dropdown__popper"
              @command="(command: string) => dashboardStore.handleDashboardCommand(command, item)"
            >
              <span class="db-more" @click.stop>
                <MoreHorizontal :size="16" />
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="rename">{{ t("chat.rename") }}</el-dropdown-item>
                  <el-dropdown-item command="delete" divided>
                    {{ t("common.delete") }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </div>
      </div>
      <div class="db-new" @click="dashboardStore.promptCreateDashboard()">
        <span>+</span>
        {{ t("analysis.newDashboard") }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard-expand {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: var(--el-bg-color);
  border: 1px solid transparent;
  border-radius: 18px;
  max-height: 0;
  overflow: hidden;
  margin: 0 10px 10px;
  box-shadow: none;
  transition:
    max-height 0.3s ease,
    box-shadow 0.3s ease,
    border-color 0.3s ease;
}
.dashboard-expand.open {
  max-height: 320px;
  border-color: var(--el-border-color);
  box-shadow: var(--shadow-card);
}
.dashboard-expand-inner {
  padding: 12px 16px;
}
.dashboard-expand-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--el-text-color-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.dashboard-close-btn {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: none;
  background: var(--el-fill-color);
  cursor: pointer;
  font-size: 11px;
  color: var(--el-text-color-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.dashboard-close-btn:hover {
  background: var(--el-border-color-dark);
  color: var(--el-text-color-primary);
}
.db-list {
  max-height: 200px;
  overflow-y: auto;
}
.db-empty {
  padding: 12px 0;
  text-align: center;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.db-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  margin-bottom: 2px;
}
.db-item:hover {
  background: var(--el-fill-color);
}
.db-item.active {
  background: var(--el-color-primary-light-9);
}
.db-item.editing {
  cursor: default;
}
.db-more {
  display: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 8px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}
.db-item:hover .db-more,
.db-item.active .db-more {
  display: inline-flex;
}
.db-more:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.db-item.editing :deep(.el-input__wrapper) {
  width: 100%;
  min-height: 36px;
  padding: 0;
  box-shadow: none;
  background-color: transparent;
}
.db-item.editing :deep(.el-input__inner) {
  font-size: var(--text-sm, 13px);
  color: var(--el-text-color-primary);
}
.db-info {
  flex: 1;
  min-width: 0;
}
.db-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.db-meta {
  font-size: 10px;
  color: var(--el-text-color-secondary);
  margin-top: 1px;
}
.db-new {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.15s ease;
  margin-top: 6px;
  border: 1.5px dashed var(--el-border-color-dark);
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 500;
  background: var(--el-fill-color-extra-light);
}
.db-new:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.db-list::-webkit-scrollbar {
  width: 4px;
}
.db-list::-webkit-scrollbar-track {
  background: transparent;
}
.db-list::-webkit-scrollbar-thumb {
  background: var(--el-border-color-dark);
  border-radius: 4px;
}
.db-list::-webkit-scrollbar-thumb:hover {
  background: var(--el-text-color-secondary);
}
:global(.dash-dropdown__popper) {
  border-radius: 12px !important;
  overflow: hidden;
}
</style>
