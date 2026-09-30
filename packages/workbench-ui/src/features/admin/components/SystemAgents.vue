<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { BookOpen, ScanEye } from "lucide-vue-next";
import { useAdminAccess } from "../composables/useAdminAccess";

const router = useRouter();
const { t } = useI18n();
const access = useAdminAccess();

// Entry cards show by their own permission: the operations agent uses the same permission as the header observe icon and also opens in a new window; knowledge governance opens inside the admin console and returns here.
const canOpenOpsAgent = computed(() => access.can("observer"));
const canOpenGovernance = computed(() => access.can("business-knowledge"));

function openOpsAgent() {
  window.open(router.resolve({ name: "ObserveDiagnosis" }).href, "_blank");
}

function openGovernance() {
  router.push({ name: "KnowledgeGovernance", query: { from: "/admin/system-agents" } });
}
</script>

<template>
  <div class="system-agent-grid">
    <section v-if="canOpenOpsAgent" class="system-agent-card">
      <div class="system-agent-icon"><ScanEye :size="20" /></div>
      <div class="system-agent-body">
        <h3>{{ t("admin.opsAgent") }}</h3>
        <p>{{ t("admin.opsAgentDescription") }}</p>
      </div>
      <el-button type="primary" @click="openOpsAgent">{{ t("admin.openEntry") }}</el-button>
    </section>
    <section v-if="canOpenGovernance" class="system-agent-card">
      <div class="system-agent-icon"><BookOpen :size="20" /></div>
      <div class="system-agent-body">
        <h3>{{ t("governance.title") }}</h3>
        <p>{{ t("governance.subtitle") }}</p>
      </div>
      <el-button type="primary" @click="openGovernance">{{ t("admin.openEntry") }}</el-button>
    </section>
  </div>
</template>

<style scoped>
.system-agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--spacing-lg);
}

.system-agent-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-2xl);
  background: var(--el-bg-color);
  box-shadow: var(--shadow-card);
}

.system-agent-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.system-agent-body {
  flex: 1;
  min-width: 0;
}

.system-agent-body h3 {
  margin: 0 0 var(--spacing-xs);
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.system-agent-body p {
  margin: 0;
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
