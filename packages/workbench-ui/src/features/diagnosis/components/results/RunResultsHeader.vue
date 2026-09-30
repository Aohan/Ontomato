<script setup lang="ts">
import type { RetainedRunMeta as RunMeta } from "@ontomato/contracts/autotest";
import { useI18n } from "vue-i18n";
import {
  formatDuration,
  getExecutionStatusLabel,
  getExecutionStatusTagType,
} from "../../utils/autotest-display";

import ArtifactRetentionButton from "../ArtifactRetentionButton.vue";

defineProps<{
  runId: string;
  runDetail: RunMeta;
  summary: {
    total: number;
    accuracyRate: string;
    avgMs: number;
  } | null;
  deleteDisabled: boolean;
  kept?: boolean;
  retentionLoading?: boolean;
}>();

const emit = defineEmits<{
  "download-results": [];
  "delete-run": [];
  "toggle-retention": [];
}>();

const { t } = useI18n();
</script>

<template>
  <div class="detail-header">
    <div class="header-left">
      <span class="detail-run-id">{{ runId }}</span>
      <el-tag :type="getExecutionStatusTagType(runDetail.status)" size="small">
        {{ getExecutionStatusLabel(runDetail.status) }}
      </el-tag>
      <span v-if="summary" class="header-summary">
        {{
          t("autotest.summaryLine", {
            n: summary.total,
            rate: summary.accuracyRate,
            avg: formatDuration(summary.avgMs),
          })
        }}
      </span>
    </div>
    <div class="header-actions">
      <ArtifactRetentionButton
        :kept="kept"
        :loading="retentionLoading"
        @toggle="emit('toggle-retention')"
      />
      <el-button size="small" @click="emit('download-results')">
        {{ t("autotest.downloadResults") }}
      </el-button>
      <el-button size="small" type="danger" :disabled="deleteDisabled" @click="emit('delete-run')">
        {{ t("common.delete") }}
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--observe-border, var(--el-border-color-light));
  flex-shrink: 0;
  gap: 10px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.detail-run-id {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.header-summary {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.header-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
</style>
