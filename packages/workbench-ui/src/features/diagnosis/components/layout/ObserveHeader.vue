<script setup lang="ts">
import { computed, ref } from "vue";
import {
  ArrowLeft,
  Eye,
  FileCheck,
  Languages,
  MessageSquare,
  Moon,
  Sparkles,
  Sun,
} from "lucide-vue-next";
import { useTheme } from "../../../../composables/useTheme";
import { useLocale } from "../../../../composables/useLocale";
import { workbenchLanguage } from "../../../../i18n";
import type { ObserveAccount, ObserveNavGroupKey } from "./types";

defineProps<{
  account: ObserveAccount | null;
  activeGroup: ObserveNavGroupKey;
  showAiButton: boolean;
  aiSidebarVisible: boolean;
}>();

const emit = defineEmits<{
  "group-select": [key: ObserveNavGroupKey];
  "toggle-ai-sidebar": [];
  "go-back": [];
}>();

const { isDark, toggleTheme } = useTheme();
const { currentLocale, t } = useLocale();

const localeLabelKey: Record<string, string> = {
  "zh-CN": "zhCN",
  en: "en",
  ja: "ja",
  ar: "ar",
  "zh-TW": "zhTW",
  fr: "fr",
  de: "de",
  it: "it",
};
const { supported: locales, switchEnabled: languageSwitchEnabled } = workbenchLanguage();

const showLangMenu = ref(false);
const langMenuTop = ref(0);
const langMenuLeft = ref(0);
const langBtnRef = ref<HTMLElement | null>(null);

const navGroups = computed(() => [
  { key: "diagnosis" as const, label: t("diagnosis.diagnosisAgent"), icon: MessageSquare },
  { key: "observe" as const, label: t("nav.observability"), icon: Eye },
  { key: "autotest" as const, label: t("diagnosis.autoTest"), icon: FileCheck },
  { key: "dsl" as const, label: t("nav.dslTest"), icon: Sparkles },
]);

function openLangMenu() {
  if (!langBtnRef.value) return;
  const rect = langBtnRef.value.getBoundingClientRect();
  langMenuTop.value = rect.bottom + 6;
  langMenuLeft.value = rect.right - 160;
  showLangMenu.value = true;
}
</script>

<template>
  <header class="observe-header">
    <div class="header-left">
      <el-button class="back-btn" text @click="emit('go-back')">
        <el-icon><ArrowLeft /></el-icon>
        <span>{{ t("nav.admin") }}</span>
      </el-button>
      <div class="header-divider"></div>
      <div class="header-title">DevTools</div>
    </div>

    <nav class="header-tabs">
      <div
        v-for="group in navGroups"
        :key="group.key"
        :class="['tab-item', { active: activeGroup === group.key }]"
        @click="emit('group-select', group.key)"
      >
        <el-icon><component :is="group.icon" /></el-icon>
        <span>{{ group.label }}</span>
      </div>
    </nav>

    <div class="header-right">
      <el-button
        v-if="showAiButton"
        :class="['ai-sidebar-btn', { active: aiSidebarVisible }]"
        text
        @click="emit('toggle-ai-sidebar')"
      >
        <el-icon :size="16"><MessageSquare /></el-icon>
        <span class="ai-sidebar-btn-label">{{ t("diagnosis.diagnosisAgent") }}</span>
      </el-button>
      <div v-if="languageSwitchEnabled" ref="langBtnRef" class="lang-switch-wrapper">
        <el-button class="icon-btn" text :title="t('lang.switch')" @click.stop="openLangMenu">
          <el-icon :size="18"><Languages /></el-icon>
        </el-button>
        <Teleport to="body">
          <div v-if="showLangMenu" class="lang-popup-overlay" @click="showLangMenu = false">
            <div
              class="lang-popup"
              :style="{ top: langMenuTop + 'px', left: langMenuLeft + 'px' }"
              @click.stop
            >
              <div
                v-for="loc in locales"
                :key="loc"
                class="lang-popup-item"
                :class="{ 'lang-item-active': currentLocale === loc }"
                @click="
                  currentLocale = loc;
                  showLangMenu = false;
                "
              >
                {{ t("lang." + localeLabelKey[loc]) }}
              </div>
            </div>
          </div>
        </Teleport>
      </div>
      <el-button class="icon-btn" text @click="toggleTheme">
        <el-icon :size="18"><component :is="isDark ? Sun : Moon" /></el-icon>
      </el-button>
      <div v-if="account" class="user-info">
        <div class="user-avatar">
          {{ account.userName ? account.userName.charAt(0).toUpperCase() : "U" }}
        </div>
        <span class="user-name">{{ account.userName || "User" }}</span>
      </div>
    </div>
  </header>
</template>

<style scoped>
.observe-header {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: var(--observe-bg-top);
  border-bottom: 1px solid var(--observe-border);
  flex-shrink: 0;
  box-shadow: var(--shadow-sm, 0 1px 2px 0 rgba(0, 0, 0, 0.05));
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.back-btn {
  color: var(--el-text-color-secondary);
  padding: 6px;
  border-radius: 6px;
  transition: all 0.2s;
}

.back-btn:hover {
  color: var(--el-text-color-primary);
  background: var(--el-fill-color);
}

.back-btn span {
  font-size: 13px;
}

.header-divider {
  width: 1px;
  height: 18px;
  background: var(--observe-border);
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.header-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-regular);
  transition: all 0.2s;
  user-select: none;
  white-space: nowrap;
}

.tab-item:hover {
  color: var(--el-text-color-primary);
  background: var(--el-fill-color);
}

.tab-item.active {
  color: #fff;
  background: var(--el-color-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.tab-item .el-icon {
  font-size: 16px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.icon-btn {
  padding: 6px;
  color: var(--el-text-color-regular);
}

.ai-sidebar-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  transition: all 0.2s;
}

.ai-sidebar-btn:hover,
.ai-sidebar-btn.active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.ai-sidebar-btn-label {
  font-weight: 500;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 8px;
  transition: background 0.2s;
}

.user-info:hover {
  background: var(--el-fill-color-light);
}

.user-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}

.user-name {
  color: var(--el-text-color-regular);
  font-size: 13px;
  font-weight: 500;
}

.lang-popup-overlay {
  position: fixed;
  inset: 0;
  z-index: 2200;
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

.lang-popup {
  position: fixed;
  width: 160px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
  box-shadow: var(--shadow-dropdown);
  padding: 4px;
  z-index: 2201;
  animation: menuSlideUp 0.15s ease;
}

.lang-popup-item {
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  cursor: pointer;
  transition: background 0.12s;
}

.lang-popup-item:hover,
.lang-item-active {
  background: var(--el-fill-color-light);
}

.lang-item-active {
  font-weight: 600;
  color: var(--el-color-primary);
}

@media (max-width: 1200px) {
  .tab-item span {
    display: none;
  }

  .tab-item {
    padding: 6px 10px;
  }

  .header-tabs {
    gap: 2px;
  }
}

@media (max-width: 768px) {
  .observe-header {
    padding: 0 12px;
  }

  .user-name {
    display: none;
  }
}
</style>
