<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import SystemMonitor from "./SystemMonitor.vue";
import AuditLogManager from "./AuditLogManager.vue";
import FeedbackRecords from "./FeedbackRecords.vue";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const activeSection = computed({
  get: () => {
    const section = route.query.section;
    return section === "audit" || section === "feedback" ? section : "monitor";
  },
  set: (section: string) => {
    router.replace({ query: { ...route.query, section } });
  },
});
</script>

<template>
  <div class="operations-governance">
    <el-tabs v-model="activeSection" class="operations-tabs">
      <el-tab-pane :label="t('nav.systemMonitoring')" name="monitor">
        <SystemMonitor v-if="activeSection === 'monitor'" />
      </el-tab-pane>
      <el-tab-pane :label="t('nav.auditLogs')" name="audit">
        <AuditLogManager v-if="activeSection === 'audit'" />
      </el-tab-pane>
      <el-tab-pane :label="t('nav.feedbackRecords')" name="feedback">
        <FeedbackRecords v-if="activeSection === 'feedback'" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.operations-governance,
.operations-tabs,
.operations-tabs :deep(.el-tabs__content),
.operations-tabs :deep(.el-tab-pane) {
  height: 100%;
  min-height: 0;
}

.operations-governance {
  display: flex;
  flex-direction: column;
}

.operations-tabs :deep(.el-tabs__content) {
  overflow: visible;
}
</style>
