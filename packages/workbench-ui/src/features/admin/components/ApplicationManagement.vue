<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ScanEye, BookOpen } from "lucide-vue-next";
import AnalysisAgentManager from "./AnalysisAgentManager.vue";
import HotReportManager from "./hot-report/HotReportManager.vue";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const activeSection = computed({
  get: () => (route.query.section === "reports" ? "reports" : "agents"),
  set: (section: string) => {
    router.replace({ query: { ...route.query, section } });
  },
});

function openKnowledgeGovernance() {
  router.push("/admin/knowledge-governance");
}

function openObservability() {
  const href = router.resolve("/observe").href;
  window.open(href, "_blank");
}
</script>

<template>
  <div class="application-management">
    <div class="agents-toolbar">
      <el-button :icon="BookOpen" @click="openKnowledgeGovernance">
        {{ t("governance.title") }}
      </el-button>
      <el-button :icon="ScanEye" @click="openObservability">
        {{ t("nav.observability") }}
      </el-button>
    </div>
    <el-tabs v-model="activeSection" class="application-tabs">
      <el-tab-pane :label="t('analysis.agent')" name="agents">
        <AnalysisAgentManager v-if="activeSection === 'agents'" />
      </el-tab-pane>
      <el-tab-pane :label="t('nav.hotReportManagement')" name="reports">
        <HotReportManager v-if="activeSection === 'reports'" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.application-management,
.application-tabs,
.application-tabs :deep(.el-tabs__content),
.application-tabs :deep(.el-tab-pane) {
  height: 100%;
  min-height: 0;
}

.application-management {
  display: flex;
  flex-direction: column;
}

.agents-toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
  flex-shrink: 0;
}

.application-tabs :deep(.el-tabs__content) {
  overflow: visible;
}
</style>
