<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft } from "lucide-vue-next";
import ArtifactDetail from "../ArtifactDetail.vue";
import { diagnosisApi } from "../../api";
import { useI18n } from "vue-i18n";

useI18n();

const route = useRoute();
const router = useRouter();

const runId = computed(() => String(route.params.runId || ""));
const caseId = computed(() => String(route.params.caseId || ""));
const apiPrefix = computed(() => diagnosisApi.caseArtifactUrl(runId.value, caseId.value));

const title = computed(() => `Case ${caseId.value}`);

function goBack() {
  if (window.history.length > 1) {
    router.back();
  } else {
    router.push("/observe/results");
  }
}
</script>

<template>
  <div class="case-artifact-page">
    <div class="page-header">
      <el-button text @click="goBack">
        <el-icon><ArrowLeft /></el-icon>
        Back
      </el-button>
      <span class="page-title">Case Artifacts</span>
      <code class="case-id-badge">{{ caseId }}</code>
      <code v-if="runId" class="run-id-badge">Run: {{ runId.slice(0, 12) }}</code>
    </div>
    <div class="page-body">
      <ArtifactDetail v-if="runId && caseId" :api-prefix="apiPrefix" :title="title" />
    </div>
  </div>
</template>

<style scoped>
.case-artifact-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-light);
  flex-shrink: 0;
}

.page-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.case-id-badge,
.run-id-badge {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--el-fill-color-lighter);
  padding: 2px 8px;
  border-radius: 4px;
  color: var(--el-text-color-secondary);
}

.page-body {
  flex: 1;
  overflow: hidden;
  min-height: 0;
  background: var(--el-bg-color);
}
</style>
