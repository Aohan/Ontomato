<script setup lang="ts">
import { ChevronDown, Moon, Settings, Sun, UserRound } from "lucide-vue-next";
import { useLocale } from "@ontomato/workbench-ui";

defineProps<{
  visible: boolean;
  isDark: boolean;
  compact: boolean;
}>();

const emit = defineEmits<{
  "update:visible": [value: boolean];
  admin: [];
  toggleTheme: [];
}>();

const { t } = useLocale();

function closeAll() {
  emit("update:visible", false);
}

function handleAdmin() {
  emit("admin");
  closeAll();
}

function handleToggleTheme() {
  emit("toggleTheme");
  closeAll();
}
</script>

<template>
  <div class="user-menu-wrapper">
    <el-tooltip :disabled="!compact" :content="t('nav.admin')" placement="right">
      <button
        type="button"
        class="footer-user"
        :aria-label="t('nav.admin')"
        :aria-expanded="visible"
        @click.stop="emit('update:visible', !visible)"
      >
        <span class="user-avatar"><UserRound :size="18" /></span>
        <span class="footer-user-name">{{ t("nav.admin") }}</span>
        <ChevronDown :size="12" class="footer-chevron" :class="{ open: visible }" />
      </button>
    </el-tooltip>
    <Teleport to="body">
      <div v-if="visible" class="user-menu-overlay" @click="emit('update:visible', false)">
        <div class="user-menu-popup" :class="{ compact }" @click.stop>
          <div class="user-menu-item" @click="handleAdmin">
            <Settings :size="14" />
            <span>{{ t("nav.admin") }}</span>
          </div>
          <div class="user-menu-item" @click="handleToggleTheme">
            <Sun v-if="isDark" :size="14" />
            <Moon v-else :size="14" />
            <span>{{ isDark ? t("theme.light") : t("theme.dark") }}</span>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.user-avatar {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
.footer-user {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 14px;
  cursor: pointer;
  font-size: 12px;
  color: var(--el-text-color-tertiary);
  transition: all 0.15s;
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
}
.footer-user:hover {
  background: var(--el-fill-color);
}
.footer-user:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.footer-user-name {
  color: var(--el-text-color-tertiary);
}
.footer-chevron {
  margin-left: auto;
  color: var(--el-text-color-tertiary);
  transition: transform 0.2s ease;
}
.footer-chevron.open {
  transform: rotate(180deg);
}
.user-menu-wrapper {
  position: relative;
}
.user-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 2100;
}
.user-menu-popup {
  position: fixed;
  bottom: 68px;
  left: calc(18px + 120px - 100px);
  width: 200px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 14px;
  box-shadow: var(--shadow-dropdown);
  padding: 6px;
  animation: menuSlideUp 0.18s ease;
  z-index: 2101;
}
.user-menu-popup.compact {
  left: 88px;
}
@keyframes menuSlideUp {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.user-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  cursor: pointer;
  transition: background 0.12s;
}
.user-menu-item:hover {
  background: var(--el-fill-color-light);
}
.user-menu-item :deep(svg) {
  color: var(--el-text-color-secondary);
}
@media (max-width: 700px) {
  .user-menu-popup,
  .user-menu-popup.compact {
    left: 12px;
    right: 12px;
    bottom: calc(62px + env(safe-area-inset-bottom));
    width: auto;
  }
  .user-menu-item {
    min-height: 44px;
  }
}
</style>
