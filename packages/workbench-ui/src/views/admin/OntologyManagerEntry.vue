<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTheme } from "../../composables/useTheme";
import { useLocale } from "../../composables/useLocale";
import { ONTOLOGY_MANAGER_URL } from "../../config/app";
import { managerViewQuery } from "../../router/admin-routes";
import { authHost } from "../../utils/auth";
import { useAdminAccess } from "../../features/admin";
import { ontologyManagerEntryConfig } from "./manager-entry-config";

const route = useRoute();
const router = useRouter();
const access = useAdminAccess();
const iframeRef = ref<HTMLIFrameElement | null>(null);
const { isDark } = useTheme();
const { currentLocale } = useLocale();
const config = ontologyManagerEntryConfig();
const initialTheme = isDark.value ? "dark" : "light";
const initialLocale = currentLocale.value;

// The credential is handed to the Manager only in the launch query; updates rebuild the iframe URL on route changes or re-entry (a full reload).
const managerUrl = computed(() => {
  if (!ONTOLOGY_MANAGER_URL) return "";
  const url = new URL(ONTOLOGY_MANAGER_URL, window.location.origin);
  const view = typeof route.query.view === "string" ? route.query.view : "";
  if (view) url.searchParams.set("view", view);
  for (const [key, value] of Object.entries(managerViewQuery(route.query))) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("theme", initialTheme);
  if (config.localeMessage) url.searchParams.set("locale", initialLocale);
  url.searchParams.set("embedded", "1");
  // Absolute URL of the business knowledge governance page: the Manager shows an entry on its knowledge page and opens it in the top window; not passed without governance permission.
  // from makes the governance page return to (and highlight) the Manager's knowledge page.
  if (access.can("business-knowledge")) {
    const governance = router.resolve({
      name: "KnowledgeGovernance",
      query: { from: "/admin/ontology-manager?view=knowledge" },
    }).href;
    url.searchParams.set("knowledgeGovernanceUrl", new URL(governance, window.location.origin).href);
  }
  const token = authHost().getToken();
  if (token) {
    url.searchParams.set("tk", token);
  } else {
    const apiKey = authHost().getApiKey();
    if (apiKey) url.searchParams.set("apiKey", apiKey);
  }
  return url.toString();
});

function postPreferences() {
  iframeRef.value?.contentWindow?.postMessage(
    { type: config.themeMessage, theme: isDark.value ? "dark" : "light" },
    "*"
  );
  if (config.localeMessage) {
    iframeRef.value?.contentWindow?.postMessage(
      { type: config.localeMessage, locale: currentLocale.value },
      "*"
    );
  }
}

watch([isDark, currentLocale], () => {
  void nextTick(postPreferences);
});
</script>

<template>
  <section class="manager-entry">
    <iframe
      v-if="managerUrl"
      ref="iframeRef"
      class="manager-frame"
      :src="managerUrl"
      :title="config.frameTitle"
      @load="postPreferences"
    />
    <el-alert
      v-else
      :title="config.missingUrlTitle"
      type="info"
      :closable="false"
      :description="config.missingUrlDescription"
    />
  </section>
</template>

<style scoped>
.manager-entry {
  display: flex;
  height: 100%;
  min-height: 0;
  max-height: 100%;
  padding: 0;
  overflow: hidden;
}
.manager-frame {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  max-height: 100%;
  flex: 1 1 auto;
  border: 0;
  background: var(--el-bg-color-page);
}
.manager-entry :deep(.el-alert) {
  margin: 24px;
}
</style>
