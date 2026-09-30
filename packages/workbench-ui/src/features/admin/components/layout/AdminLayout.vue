<script setup lang="ts">
import { ref, computed, watch, provide } from "vue";
import { useRouter, useRoute } from "vue-router";
import {
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Sun,
  Moon,
  ScanEye,
  ArrowLeft,
  Loader2,
  Languages,
} from "lucide-vue-next";
import { useTheme } from "../../../../composables/useTheme";
import { useLocale } from "../../../../composables/useLocale";
import { workbenchLanguage } from "../../../../i18n";
import { adminAccessKey, type AdminLayoutConfig, type AdminMenuItem } from "../../navigation";
import { governanceReturnPath } from "../../../knowledge-governance";

const props = defineProps<AdminLayoutConfig>();
provide(adminAccessKey, props.access);

const router = useRouter();
const route = useRoute();
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
const { supported: locales, switchEnabled: languageSwitch } = workbenchLanguage();
const ADMIN_SIDEBAR_COLLAPSED_KEY = "admin-sidebar-collapsed";

const showLangMenu = ref(false);
const langMenuTop = ref(0);
const langMenuLeft = ref(0);
const langBtnRef = ref<InstanceType<typeof HTMLDivElement> | null>(null);

function openLangMenu() {
  if (!langBtnRef.value) return;
  const rect = langBtnRef.value.getBoundingClientRect();
  langMenuTop.value = rect.bottom + 6;
  langMenuLeft.value = rect.right - 160;
  showLangMenu.value = true;
}

const collapsed = ref(localStorage.getItem(ADMIN_SIDEBAR_COLLAPSED_KEY) === "1");

// A menu item is visible with any one of its permissions.
const canSeeItem = (item: AdminMenuItem) => item.permissions.some((p) => props.access.can(p));

// A tab is visible if it has permission itself or at least one menu item in its group does; menu items are filtered one by one.
// Landing path when switching groups: the home page for a home-style tab, otherwise the group's first visible menu item.
const navGroups = computed(() =>
  props.groups
    .filter(
      (group) =>
        props.access.can(group.permission) ||
        props.items.some((item) => item.groupKey === group.key && canSeeItem(item))
    )
    .map((group) => {
      const items = props.items
        .filter((item) => item.groupKey === group.key && canSeeItem(item))
        .map((item) => ({ path: item.path, title: t(item.titleKey), icon: item.icon }));
      return { ...group, title: t(group.titleKey), items, landing: group.homePath ?? items[0]?.path };
    })
);

const hasRealGroups = computed(() => navGroups.value.length > 0);

const firstAvailableGroup = computed(() => navGroups.value[0]?.key || "");

const activeGroup = ref("");

const currentGroupItems = computed(() => {
  const group = navGroups.value.find((g) => g.key === activeGroup.value);
  return group?.items || [];
});

// Tabs without menu items (home-style tabs) hide the sidebar so the content fills the page.
const showAside = computed(() => currentGroupItems.value.length > 0);

// The route whose menu item and tab are highlighted: knowledge governance has two entries and follows the page it was opened from.
const navRoute = computed(() =>
  route.name === "KnowledgeGovernance" ? router.resolve(governanceReturnPath(route.query)) : route
);

const activeMenu = computed(() => {
  const path = navRoute.value.path;
  if (path.startsWith("/admin/intelligence-assets/")) {
    return "/admin/intelligence-assets/metric-views";
  }
  return path;
});

// Menu pages show their title and one-line description above the content; other pages (home-style tabs, knowledge governance) do not.
const pageHeading = computed(() => props.items.find((item) => item.path === route.path));

// Every navigation re-syncs the tab with the highlighted route's group. The source is a getter on the current location:
// navRoute itself is the same route object for ordinary pages, so watching it would not fire.
watch(
  () => route.fullPath,
  () => {
    const group = navRoute.value.meta?.group as string;
    if (group && group !== activeGroup.value) {
      activeGroup.value = group;
    }
  },
  { immediate: true }
);

watch(firstAvailableGroup, (group) => {
  if (group && !activeGroup.value) {
    activeGroup.value = group;
  }
});

// Once permissions are ready, pick the tab: the current route's group if visible, otherwise the first visible group.
watch(
  () => props.access.ready,
  (ready) => {
    if (!ready || !hasRealGroups.value) return;
    const currentGroup = navRoute.value.meta?.group as string | undefined;
    if (currentGroup && navGroups.value.some((g) => g.key === currentGroup)) {
      activeGroup.value = currentGroup;
      return;
    }
    activeGroup.value = firstAvailableGroup.value;
  },
  { immediate: true }
);

function handleGroupSelect(key: string) {
  activeGroup.value = key;
  const group = navGroups.value.find((g) => g.key === key);
  if (!group?.landing) return;
  const inGroup =
    route.path === group.homePath || group.items.some((item) => item.path === route.path);
  if (!inGroup) router.push(group.landing);
}

function handleMenuSelect(path: string) {
  router.push(path);
}

function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  localStorage.setItem(ADMIN_SIDEBAR_COLLAPSED_KEY, collapsed.value ? "1" : "0");
}

function goBack() {
  router.push("/chat");
}

function openObserve() {
  const href = router.resolve("/observe").href;
  window.open(href, "_blank");
}
</script>

<template>
  <div class="admin-layout">
    <div v-if="navigationHidden">
      <header class="admin-header">
        <div class="header-left">
          <el-button class="back-btn" text @click="goBack">
            <el-icon><ArrowLeft /></el-icon>
            <span>{{ t("common.backToChat") }}</span>
          </el-button>
          <div class="header-divider"></div>
          <div class="header-title">{{ t("nav.admin") }}</div>
        </div>
        <div class="header-right">
          <el-button class="theme-btn" :icon="isDark ? Sun : Moon" text @click="toggleTheme" />
          <template v-if="account">
            <span class="user-name">{{ account.userName }}</span>
            <el-button class="logout-btn" text @click="account.logout()">
              <el-icon><LogOut /></el-icon>
              <span>{{ t("user.logout") }}</span>
            </el-button>
          </template>
        </div>
      </header>
      <div class="admin-body">
        <main class="admin-main">
          <router-view />
        </main>
      </div>
    </div>
    <div v-else-if="!access.ready" class="permission-loading">
      <el-icon class="is-loading"><Loader2 /></el-icon>
      <span>{{ t("admin.loadingMenuPermission") }}</span>
    </div>
    <template v-else-if="!hasRealGroups">
      <div class="permission-empty">
        <span>{{ t("admin.noAvailableMenuPermission") }}</span>
        <el-button type="primary" @click="goBack">{{ t("common.backToChat") }}</el-button>
      </div>
    </template>
    <template v-else>
      <header class="admin-header">
        <div class="header-left">
          <el-button class="back-btn" text @click="goBack">
            <el-icon><ArrowLeft /></el-icon>
            <span>{{ t("common.backToChat") }}</span>
          </el-button>
          <div class="header-divider"></div>
          <div class="header-title">{{ t("nav.admin") }}</div>
        </div>
        <nav class="header-tabs">
          <div
            v-for="tab in actionTabs"
            :key="tab.key"
            class="tab-item"
            @click="tab.select()"
          >
            <el-icon><component :is="tab.icon" /></el-icon>
            <span>{{ t(tab.titleKey) }}</span>
          </div>
          <div
            v-for="group in navGroups"
            :key="group.key"
            :class="['tab-item', { active: activeGroup === group.key }]"
            @click="handleGroupSelect(group.key)"
          >
            <el-icon><component :is="group.icon" /></el-icon>
            <span>{{ group.title }}</span>
          </div>
        </nav>
        <div class="header-right">
          <div v-if="languageSwitch" ref="langBtnRef" class="lang-switch-wrapper">
            <el-button
              class="lang-btn"
              :icon="Languages"
              text
              :title="t('lang.switch')"
              @click.stop="openLangMenu"
            />
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
          <el-button class="theme-btn" :icon="isDark ? Sun : Moon" text @click="toggleTheme" />
          <el-button
            v-if="access.can('observer')"
            class="icon-btn"
            text
            :title="t('nav.observability')"
            @click="openObserve"
          >
            <el-icon :size="18"><ScanEye /></el-icon>
          </el-button>
          <template v-if="account">
            <span class="user-name">{{ account.userName }}</span>
            <el-button class="logout-btn" text @click="account.logout()">
              <el-icon><LogOut /></el-icon>
              <span>{{ t("user.logout") }}</span>
            </el-button>
          </template>
        </div>
      </header>
      <div class="admin-body">
        <aside v-if="showAside" :class="['admin-aside', { collapsed }]">
          <div class="aside-header">
            <el-button
              class="collapse-btn"
              :icon="collapsed ? PanelLeftOpen : PanelLeftClose"
              text
              @click="toggleCollapsed"
            />
          </div>
          <el-menu
            :default-active="activeMenu"
            :collapse="collapsed"
            class="admin-menu"
            @select="handleMenuSelect"
          >
            <el-menu-item
              v-for="item in currentGroupItems"
              :key="item.path"
              :index="item.path"
              :title="item.title"
            >
              <el-icon><component :is="item.icon" /></el-icon>
              <template #title>
                <span
                  class="menu-item-title"
                  style="
                    display: block;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    min-width: 0;
                    flex: 1;
                  "
                >
                  {{ item.title }}
                </span>
              </template>
            </el-menu-item>
          </el-menu>
        </aside>
        <div class="admin-content">
          <header v-if="pageHeading" class="admin-page-heading">
            <h1>{{ t(pageHeading.titleKey) }}</h1>
            <p>{{ t(pageHeading.descriptionKey) }}</p>
          </header>
          <main class="admin-main">
            <router-view />
          </main>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.admin-layout {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.admin-layout :deep(button),
.admin-layout :deep(.el-button),
.admin-layout :deep(button:hover),
.admin-layout :deep(.el-button:hover),
.admin-layout :deep(button:focus),
.admin-layout :deep(.el-button:focus),
.admin-layout :deep(button:focus-visible),
.admin-layout :deep(.el-button:focus-visible),
.admin-layout :deep(button:active),
.admin-layout :deep(.el-button:active) {
  box-shadow: none !important;
}

.permission-loading,
.permission-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-md);
  color: var(--el-text-color-secondary);
  font-size: var(--text-md);
}

.permission-empty .el-button {
  margin-top: var(--spacing-md);
}

.admin-header {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--spacing-xl);
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
  box-shadow: var(--shadow-sm);
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.back-btn {
  color: var(--el-text-color-secondary);
  padding: var(--spacing-sm);
  border-radius: var(--radius-md);
  transition: all var(--transition-base);
}

.back-btn:hover {
  color: var(--el-text-color-primary);
  background: var(--el-fill-color);
}

.back-btn span {
  font-size: var(--text-sm);
}

.header-divider {
  width: 1px;
  height: 20px;
  background: var(--el-border-color);
}

.header-title {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
  letter-spacing: -0.01em;
}

.header-tabs {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-xs);
  background: var(--el-fill-color-light);
  border-radius: var(--radius-lg);
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-base);
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  white-space: nowrap;
  user-select: none;
}

.tab-item:hover {
  color: var(--el-text-color-primary);
  background: var(--el-fill-color);
}

.tab-item.active {
  color: var(--on-primary);
  background: var(--el-color-primary);
  box-shadow: var(--shadow-primary);
}

.tab-item .el-icon {
  font-size: 16px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.icon-btn {
  padding: var(--spacing-sm);
  color: var(--el-text-color-regular);
}

.user-name {
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
}

.logout-btn {
  color: var(--el-text-color-secondary);
  padding: var(--spacing-sm);
  border-radius: var(--radius-md);
  transition: all var(--transition-base);
}

.logout-btn:hover {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}

.logout-btn span {
  font-size: var(--text-sm);
}

.admin-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

.admin-aside {
  width: 220px;
  background: var(--el-bg-color);
  border-right: 1px solid var(--el-border-color);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: width var(--transition-slow);
}

.admin-aside.collapsed {
  width: 64px;
}

.admin-aside.collapsed .aside-header {
  justify-content: center;
  padding: 0;
}

.aside-header {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color-light);
  flex-shrink: 0;
}

.collapse-btn {
  padding: var(--spacing-sm);
  color: var(--el-text-color-secondary);
  border-radius: var(--radius-md);
  transition: all var(--transition-base);
}

.collapse-btn:hover {
  color: var(--el-text-color-primary);
  background: var(--el-fill-color);
}

.admin-menu {
  flex: 1;
  border-right: none;
  background: transparent;
  overflow-y: auto;
  padding: var(--spacing-sm) 0;
}

.admin-menu :deep(.el-menu-item) {
  height: 44px;
  line-height: 44px;
  margin: 2px var(--spacing-sm);
  border-radius: var(--radius-md);
  transition: all var(--transition-base);
  font-size: 13px;
  overflow: hidden;
}

.menu-item-title {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* Keep the ellipsis working in the selected state */
.admin-menu :deep(.el-menu-item.is-active) .menu-item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  display: block;
}

.admin-menu :deep(.el-menu-item:hover) {
  background-color: var(--el-fill-color);
}

.admin-menu :deep(.el-menu-item.is-active) {
  background-color: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: var(--font-medium);
}

.admin-menu :deep(.el-menu-item.is-active::before) {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 20px;
  background: var(--el-color-primary);
  border-radius: 0 2px 2px 0;
}

/* Centre icons when collapsed - consistent with the collapse button */
.admin-aside.collapsed .admin-menu :deep(li.el-menu-item) {
  margin: 4px auto !important;
  width: 40px !important;
  height: 40px !important;
  padding: 0 !important;
  padding-left: 0 !important;
  border-radius: var(--radius-md) !important;
  display: flex !important;
  justify-content: center !important;
  align-items: center !important;
}

.admin-aside.collapsed .admin-menu :deep(.el-menu-item .el-tooltip__trigger),
.admin-aside.collapsed .admin-menu :deep(.el-menu-item .el-tooltip__trigger:focus-visible) {
  display: flex !important;
  justify-content: center !important;
  align-items: center !important;
  padding: 0 !important;
  padding-left: 0 !important;
  margin: 0 !important;
  width: 100% !important;
  height: 100% !important;
}

.admin-aside.collapsed .admin-menu :deep(.el-menu-item .el-icon) {
  margin: 0 !important;
  font-size: 18px !important;
}

.admin-aside.collapsed .admin-menu :deep(.el-menu-item.is-active) {
  background-color: var(--el-color-primary-light-9) !important;
  color: var(--el-color-primary) !important;
}

.admin-aside.collapsed .admin-menu :deep(.el-menu-item.is-active::before) {
  display: none !important;
}

.admin-aside.collapsed .admin-menu :deep(.el-menu-item span) {
  display: none !important;
  width: 0 !important;
}

.admin-main {
  flex: 1;
  padding: var(--spacing-xl);
  overflow-y: auto;
  background: var(--el-bg-color-page);
  min-width: 0;
  min-height: 0;
}

/* Page heading stays above the scrolling page content. */
.admin-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--el-bg-color-page);
}

.admin-page-heading {
  flex-shrink: 0;
  padding: var(--spacing-xl) var(--spacing-xl) 0;
}

.admin-page-heading h1 {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
}

.admin-page-heading p {
  margin: var(--spacing-xs) 0 0;
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

@media (max-width: 640px) {
  .admin-aside {
    width: 56px;
  }

  .admin-aside .aside-header {
    justify-content: center;
    padding: 0;
  }

  .admin-menu :deep(.el-menu-item) {
    justify-content: center;
    padding: 0 !important;
  }

  .admin-menu :deep(.el-menu-item span) {
    display: none;
  }

  .admin-menu :deep(.el-menu-item .el-icon) {
    margin-right: 0;
  }

  .admin-main {
    padding: var(--spacing-md);
  }

  .admin-page-heading {
    padding: var(--spacing-md) var(--spacing-md) 0;
  }
}

@media (max-width: 1400px) {
  .tab-item span {
    display: none;
  }

  .tab-item {
    padding: var(--spacing-sm);
  }

  .header-tabs {
    gap: 2px;
  }
}
</style>

<style>
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
.lang-popup-item:hover {
  background: var(--el-fill-color-light);
}
.lang-item-active {
  background: var(--el-fill-color-light);
  font-weight: 600;
  color: var(--el-color-primary);
}
</style>
