<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  RefreshCw,
  Cpu,
  Monitor,
  Coins,
  CircleCheck,
  CircleX,
  Timer,
  User,
  Gauge,
} from "lucide-vue-next";
import { adminApi } from "../../api";
import { useI18n } from "vue-i18n";
import {
  formatMemoryGB,
  formatUptime,
  type SystemMonitorSlots,
  type SystemStatus,
} from "../../system-monitor";

// Service panel slot between the resource overview and the backend card (provided by the app's composed page); service actions go back through handleAction for confirmation and execution here.
defineSlots<SystemMonitorSlots>();

const { t } = useI18n();

const status = ref<SystemStatus | null>(null);
const loading = ref(false);
const actionLoading = ref<Record<string, boolean>>({});
const refreshInterval = ref<number | null>(null);
const lastRefresh = ref("");

async function fetchStatus() {
  loading.value = true;
  try {
    const data = await adminApi.getServiceInfo();
    status.value = data as SystemStatus;
    lastRefresh.value = new Date().toLocaleTimeString();
  } catch (err: any) {
    ElMessage.error(err?.message || t("admin.operationFailed"));
  } finally {
    loading.value = false;
  }
}

async function executeAction(serviceName: string, action: string) {
  const key = `${serviceName}:${action}`;
  actionLoading.value[key] = true;
  try {
    const res = await adminApi.runServiceAction({
      service_name: serviceName,
      action,
    });
    const actionLabel = getActionLabel(action);
    if (res.success) {
      ElMessage.success(res.message || t("hotData.actionSuccess", { serviceName, actionLabel }));
    } else {
      ElMessage.error(res.message || t("hotData.actionFailed", { serviceName, actionLabel }));
    }
    await fetchStatus();
  } catch (err: any) {
    ElMessage.error(err?.message || t("admin.executeFailed"));
  } finally {
    actionLoading.value[key] = false;
  }
}

function getActionLabel(action: string) {
  const map: Record<string, string> = {
    stop: t("common.stop"),
    start: t("common.start"),
    restart: t("admin.restart"),
  };
  return map[action] || action;
}

function handleAction(serviceName: string, action: string) {
  const actionLabel = getActionLabel(action);
  ElMessageBox.confirm(
    t("admin.serviceActionConfirm", { serviceName, actionLabel }),
    t("admin.actionConfirmTitle", { actionLabel }),
    { confirmButtonText: actionLabel, cancelButtonText: t("common.cancel"), type: "warning" }
  )
    .then(() => executeAction(serviceName, action))
    .catch(() => {});
}

const cpuColor = computed(() => {
  if (!status.value) return "";
  const u = status.value.server.cpu.userate;
  if (u >= 90) return "#F56C6C";
  if (u >= 70) return "#E6A23C";
  return "#67C23A";
});

const memColor = computed(() => {
  if (!status.value) return "";
  const u = status.value.server.memory.usage_percent;
  if (u >= 90) return "#F56C6C";
  if (u >= 70) return "#E6A23C";
  return "#67C23A";
});

const frontendActions = computed(() => {
  return status.value?.frontend?.docker?.actions || [];
});

onMounted(() => {
  fetchStatus();
  refreshInterval.value = window.setInterval(fetchStatus, 30000);
});

onUnmounted(() => {
  if (refreshInterval.value) clearInterval(refreshInterval.value);
});
</script>

<template>
  <div class="system-monitor">
    <!-- Skeleton screen -->
    <template v-if="loading && !status">
      <!-- Top bar skeleton -->
      <div class="top-bar">
        <div class="top-left">
          <el-skeleton style="width: 180px" animated>
            <template #template>
              <el-skeleton-item variant="text" style="width: 120px; height: 20px" />
            </template>
          </el-skeleton>
          <el-skeleton style="width: 60px" animated>
            <template #template>
              <el-skeleton-item variant="text" style="width: 50px; height: 20px" />
            </template>
          </el-skeleton>
        </div>
        <div class="top-right">
          <el-skeleton style="width: 160px" animated>
            <template #template>
              <el-skeleton-item variant="text" style="width: 140px; height: 20px" />
            </template>
          </el-skeleton>
          <el-skeleton animated>
            <template #template>
              <el-skeleton-item variant="button" style="width: 52px; height: 24px" />
            </template>
          </el-skeleton>
        </div>
      </div>

      <!-- Resource overview skeleton -->
      <el-row :gutter="16" class="resource-overview">
        <el-col v-for="i in 3" :key="i" :span="8">
          <div class="resource-card">
            <div class="resource-header">
              <el-skeleton style="width: 60px" animated>
                <template #template>
                  <el-skeleton-item variant="text" style="width: 60px; height: 18px" />
                </template>
              </el-skeleton>
              <el-skeleton style="width: 60px" animated>
                <template #template>
                  <el-skeleton-item variant="text" style="width: 50px; height: 28px" />
                </template>
              </el-skeleton>
            </div>
            <el-skeleton animated>
              <template #template>
                <el-skeleton-item variant="text" style="height: 8px" />
              </template>
            </el-skeleton>
            <div class="resource-detail" style="margin-top: 10px">
              <el-skeleton v-for="j in 4" :key="j" style="width: 70px" animated>
                <template #template>
                  <el-skeleton-item variant="text" style="width: 60px; height: 14px" />
                </template>
              </el-skeleton>
            </div>
          </div>
        </el-col>
      </el-row>

      <!-- Card skeleton -->
      <div v-for="i in 2" :key="'card-' + i" class="skeleton-card">
        <div class="skeleton-card-header">
          <el-skeleton style="width: 100px" animated>
            <template #template>
              <el-skeleton-item variant="text" style="width: 80px; height: 18px" />
            </template>
          </el-skeleton>
        </div>
        <div class="skeleton-card-body">
          <el-skeleton :rows="3" animated />
        </div>
      </div>

      <!-- Table skeleton -->
      <div class="skeleton-card">
        <div class="skeleton-card-header">
          <el-skeleton style="width: 120px" animated>
            <template #template>
              <el-skeleton-item variant="text" style="width: 100px; height: 18px" />
            </template>
          </el-skeleton>
        </div>
        <div class="skeleton-card-body">
          <el-skeleton :rows="5" animated />
        </div>
      </div>

      <!-- backend single-column skeleton -->
      <div class="skeleton-card">
        <div class="skeleton-card-header">
          <el-skeleton style="width: 100px" animated>
            <template #template>
              <el-skeleton-item variant="text" style="width: 80px; height: 18px" />
            </template>
          </el-skeleton>
        </div>
        <div class="skeleton-card-body">
          <el-skeleton :rows="4" animated />
        </div>
      </div>

      <!-- Bottom table skeleton -->
      <div class="skeleton-card">
        <div class="skeleton-card-header">
          <el-skeleton style="width: 120px" animated>
            <template #template>
              <el-skeleton-item variant="text" style="width: 100px; height: 18px" />
            </template>
          </el-skeleton>
        </div>
        <div class="skeleton-card-body">
          <el-skeleton :rows="4" animated />
        </div>
      </div>
    </template>

    <!-- Real content -->
    <template v-else>
      <!-- Top status bar -->
      <div class="top-bar">
        <div class="top-left">
          <span class="hostname">
            <el-icon><Monitor /></el-icon>
            {{ status?.hostname || "—" }}
          </span>
          <el-tag v-if="status" type="success" size="small">{{ t("hotData.running") }}</el-tag>
          <el-tag v-else type="danger" size="small">{{ t("hotData.notConnected") }}</el-tag>
          <span v-if="status?.timestamp" class="timestamp">{{ status.timestamp }}</span>
        </div>
        <div class="top-right">
          <span v-if="lastRefresh" class="last-refresh">
            {{ t("hotData.lastRefresh") }}: {{ lastRefresh }}
          </span>
          <el-button size="small" :icon="RefreshCw" :loading="loading" @click="fetchStatus">
            {{ t("common.refresh") }}
          </el-button>
        </div>
      </div>

      <!-- Resource overview -->
      <el-row v-if="status" :gutter="16" class="resource-overview">
        <el-col :span="8">
          <div class="resource-card cpu-card">
            <div class="resource-header">
              <span class="resource-title">
                <el-icon><Cpu /></el-icon>
                CPU
              </span>
              <span class="resource-value" :style="{ color: cpuColor }">
                {{ status.server.cpu.userate }}%
              </span>
            </div>
            <el-progress
              :percentage="status.server.cpu.userate"
              :color="cpuColor"
              :stroke-width="8"
            />
            <div class="resource-detail">
              <span>{{ t("common.user") }} {{ status.server.cpu.user }}%</span>
              <span>{{ t("hotData.system") }} {{ status.server.cpu.system }}%</span>
              <span>{{ t("hotData.waiting") }} {{ status.server.cpu.wait }}%</span>
              <span>{{ t("hotData.idle") }} {{ status.server.cpu.idle }}%</span>
            </div>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="resource-card mem-card">
            <div class="resource-header">
              <span class="resource-title">
                <el-icon><Gauge /></el-icon>
                {{ t("hotData.memory") }}
              </span>
              <span class="resource-value" :style="{ color: memColor }">
                {{ status.server.memory.usage_percent }}%
              </span>
            </div>
            <el-progress
              :percentage="status.server.memory.usage_percent"
              :color="memColor"
              :stroke-width="8"
            />
            <div class="resource-detail">
              <span>{{ t("hotData.used") }} {{ status.server.memory.used_gb }} GB</span>
              <span>{{ t("hotData.idle") }} {{ status.server.memory.free_gb }} GB</span>
              <span>{{ t("hotData.total") }} {{ status.server.memory.total_gb }} GB</span>
            </div>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="resource-card disk-card">
            <div class="resource-header">
              <span class="resource-title">
                <el-icon><Coins /></el-icon>
                {{ t("hotData.disk") }}
              </span>
              <span class="resource-value">
                {{ status.server.disk.map((d) => d.usage_percent).join(" / ") }}%
              </span>
            </div>
            <div v-for="disk in status.server.disk" :key="disk.partition" class="disk-row">
              <span class="disk-partition">{{ disk.partition }}</span>
              <el-progress
                :percentage="disk.usage_percent"
                :color="
                  disk.usage_percent >= 90
                    ? '#F56C6C'
                    : disk.usage_percent >= 70
                      ? '#E6A23C'
                      : '#67C23A'
                "
                :stroke-width="6"
              />
              <span class="disk-detail">{{ disk.used }} / {{ disk.size }} GB</span>
            </div>
          </div>
        </el-col>
      </el-row>

      <slot
        name="service-panels"
        :status="status"
        :action-loading="actionLoading"
        :handle-action="handleAction"
        :get-action-label="getActionLabel"
      />

      <!-- backend services -->
      <el-card v-if="status" shadow="never" class="section-card">
        <template #header>
          <div class="section-header">
            <span class="section-title">
              <el-tag type="success" effect="dark" round size="small">backend</el-tag>
              {{ status.backend.service.name }}
            </span>
            <div v-if="status.backend.service.actions?.length" class="docker-global-actions">
              <el-button
                v-for="action in status.backend.service.actions"
                :key="action"
                size="small"
                :type="action === 'stop' ? 'danger' : action === 'restart' ? 'warning' : 'success'"
                :loading="actionLoading[`${status.backend.service.name}:${action}`]"
                @click="handleAction(status.backend.service.name, action)"
              >
                {{ getActionLabel(action) }}
              </el-button>
            </div>
          </div>
        </template>
        <div class="single-service-info">
          <div class="single-service-status" :class="status.backend.service.status">
            <el-icon v-if="status.backend.service.status === 'running'" size="18">
              <CircleCheck />
            </el-icon>
            <el-icon v-else size="18"><CircleX /></el-icon>
            <span>
              {{
                status.backend.service.status === "running"
                  ? t("hotData.running")
                  : t("hotData.stopped")
              }}
            </span>
          </div>
          <div class="single-service-meta">
            <span>
              <el-icon><User /></el-icon>
              PID {{ status.backend.service.pid }} ({{ status.backend.service.user }})
            </span>
            <span>
              <el-icon><Cpu /></el-icon>
              CPU {{ status.backend.service.cpu_percent }}%
            </span>
            <span>
              <el-icon><Gauge /></el-icon>
              {{ formatMemoryGB(status.backend.service.memory_mb) }}
            </span>
            <span>
              <el-icon><Timer /></el-icon>
              {{ formatUptime(status.backend.service.uptime_seconds) }}
            </span>
          </div>
        </div>
      </el-card>

      <!-- Frontend Docker container -->
      <el-card v-if="status?.frontend?.docker" shadow="never" class="section-card">
        <template #header>
          <div class="section-header">
            <span class="section-title">
              <el-tag type="danger" effect="dark" round size="small">frontend</el-tag>
              {{ t("hotData.dockerContainers") }}
            </span>
            <div v-if="frontendActions.length" class="docker-global-actions">
              <el-button
                v-for="action in frontendActions"
                :key="action"
                size="small"
                :type="action === 'stop' ? 'danger' : action === 'restart' ? 'warning' : 'success'"
                :loading="actionLoading[`frontend:${action}`]"
                @click="handleAction('frontend', action)"
              >
                {{ getActionLabel(action) }}
              </el-button>
            </div>
          </div>
        </template>
        <el-table
          :data="status.frontend.docker.containers"
          stripe
          size="small"
          class="service-table"
        >
          <el-table-column :label="t('hotData.containerName')" min-width="120">
            <template #default="{ row }">
              <div class="service-name-cell">
                <el-icon v-if="row.status === 'running'" size="16" class="status-running">
                  <CircleCheck />
                </el-icon>
                <el-icon v-else size="16" class="status-stopped"><CircleX /></el-icon>
                <span>{{ row.name }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column
            :label="t('hotData.image')"
            min-width="170"
            prop="image"
            show-overflow-tooltip
          />
          <el-table-column :label="t('common.status')" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 'running' ? 'success' : 'danger'" size="small">
                {{ row.status === "running" ? t("hotData.running") : t("hotData.stopped") }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="CPU" width="120" align="right">
            <template #default="{ row }">{{ row.cpu_percent }}%</template>
          </el-table-column>
          <el-table-column :label="t('hotData.memory')" width="120" align="right">
            <template #default="{ row }">{{ formatMemoryGB(row.memory_mb) }}</template>
          </el-table-column>
          <el-table-column :label="t('hotData.uptime')" width="150" align="right">
            <template #default="{ row }">{{ formatUptime(row.uptime_seconds) }}</template>
          </el-table-column>
          <el-table-column :label="t('dataSource.port')" width="150">
            <template #default="{ row }">
              {{ Array.isArray(row.ports) ? row.ports.join(", ") : row.ports }}
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>
  </div>
</template>

<style scoped src="../../../../styles/system-monitor-common.css"></style>

<style scoped>
.system-monitor {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  overflow-x: hidden;
  min-width: 0;
}

.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
}

.top-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.hostname {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.timestamp {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.top-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.last-refresh {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.resource-overview {
  flex-shrink: 0;
}

.resource-card {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.resource-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.resource-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.resource-value {
  font-size: 28px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.resource-detail {
  display: flex;
  gap: 16px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.disk-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.disk-row .el-progress {
  flex: 1;
}

.disk-partition {
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-regular);
  white-space: nowrap;
  min-width: 70px;
}

.disk-detail {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.single-service-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.single-service-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  padding: 8px 12px;
  border-radius: 6px;
  width: fit-content;
}

.single-service-status.running {
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}

.single-service-status.stopped {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}

.single-service-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.single-service-meta span {
  display: flex;
  align-items: center;
  gap: 4px;
}

.single-service-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.docker-global-actions {
  display: flex;
  gap: 8px;
}

.skeleton-card {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
}

.skeleton-card-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.skeleton-card-body {
  padding: 16px;
}
</style>
