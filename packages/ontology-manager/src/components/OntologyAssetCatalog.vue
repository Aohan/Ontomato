<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElButton, ElEmpty, ElInput, vLoading } from "element-plus";
import {
  ChartColumn,
  ChevronRight,
  Clock3,
  MousePointerClick,
  Search,
  SquareFunction,
} from "lucide-vue-next";
import type { SmartAsset } from "../api";
import type { AssetTab } from "../workspace";
import { useManagerClient, useOntologyText } from "../context";

const { ot } = useOntologyText();
const { loadSmartAssets } = useManagerClient();

const props = defineProps<{ kind: AssetTab }>();
const emit = defineEmits<{
  select: [asset: SmartAsset];
  create: [];
}>();

const assets = ref<SmartAsset[]>([]);
const loading = ref(false);
const query = ref("");

const meta: Record<
  AssetTab,
  {
    title: Parameters<typeof ot>[0];
    description: Parameters<typeof ot>[0];
    create: Parameters<typeof ot>[0];
    icon: typeof ChartColumn;
  }
> = {
  metrics: {
    title: "metricsTitle",
    description: "metricsDesc",
    create: "createMetric",
    icon: ChartColumn,
  },
  actions: {
    title: "actionsTitle",
    description: "actionsDesc",
    create: "generateFromNaturalLanguage",
    icon: MousePointerClick,
  },
  functions: {
    title: "functionsTitle",
    description: "functionsDesc",
    create: "createFunction",
    icon: SquareFunction,
  },
  tasks: {
    title: "tasksTitle",
    description: "tasksDesc",
    create: "createTask",
    icon: Clock3,
  },
};

const currentMeta = computed(() => {
  const item = meta[props.kind];
  return {
    ...item,
    title: ot(item.title),
    description: ot(item.description),
    create: ot(item.create),
  };
});
const filteredAssets = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  if (!keyword) return assets.value;
  return assets.value.filter((asset) =>
    `${asset.name} ${asset.description || ""}`.toLowerCase().includes(keyword)
  );
});

function statusLabel(status?: string) {
  if (status === "PUBLISHED" || status === "RUNNING")
    return status === "RUNNING" ? ot("running") : ot("published");
  if (status === "PENDING_REVIEW") return ot("pendingReview");
  if (status === "STOPPED") return ot("stopped");
  if (status === "UNUSED") return ot("unused");
  return status || "-";
}

function statusClass(status?: string) {
  if (status === "PUBLISHED" || status === "RUNNING") return "success";
  if (status === "PENDING_REVIEW") return "warning";
  return "info";
}

function formatTime(timestamp?: number) {
  return timestamp ? new Date(timestamp).toLocaleString() : "-";
}

async function loadCatalog() {
  loading.value = true;
  try {
    assets.value = await loadSmartAssets(props.kind);
  } catch {
    assets.value = [];
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.kind,
  () => void loadCatalog()
);
onMounted(() => void loadCatalog());
</script>

<template>
  <section v-loading="loading" class="asset-catalog">
    <header class="catalog-titlebar">
      <div>
        <h1>{{ currentMeta.title }}</h1>
        <p>{{ currentMeta.description }}</p>
      </div>
      <el-button type="primary" @click="emit('create')">
        <component :is="currentMeta.icon" :size="16" />
        {{ currentMeta.create }}
      </el-button>
    </header>

    <div class="catalog-toolbar">
      <el-input
        v-model="query"
        :prefix-icon="Search"
        :placeholder="ot('filterPrefix', { title: currentMeta.title })"
        clearable
      />
      <span class="resource-count">{{ filteredAssets.length }} {{ ot("items") }}</span>
    </div>

    <div class="resource-table">
      <div class="resource-table-head">
        <span>{{ currentMeta.title }}</span>
        <span>{{ ot("linkedFunction") }}</span>
        <span>{{ ot("source") }}</span>
        <span>{{ ot("status") }}</span>
        <span>{{ ot("lastUpdated") }}</span>
        <span></span>
      </div>
      <button
        v-for="asset in filteredAssets"
        :key="asset.id || asset.name"
        class="resource-table-row"
        @click="emit('select', asset)"
      >
        <span class="resource-name">
          <span>
            <strong>{{ asset.name }}</strong>
            <small>{{ asset.description || ot("notFilledDescription") }}</small>
          </span>
        </span>
        <span>{{ asset.function?.name || "-" }}</span>
        <span>
          {{
            asset.origin === "SYSTEM" ? ot("system") : asset.origin === "USER" ? ot("user") : "-"
          }}
        </span>
        <span>
          <span :class="['status-pill', statusClass(asset.status)]">
            {{ statusLabel(asset.status) }}
          </span>
        </span>
        <span>{{ formatTime(asset.modifyTimestamp) }}</span>
        <ChevronRight :size="16" class="row-chevron" />
      </button>
      <el-empty
        v-if="!loading && filteredAssets.length === 0"
        :description="ot('notFoundNamed', { title: currentMeta.title })"
      />
    </div>
  </section>
</template>

<style scoped>
.asset-catalog {
  min-height: 100%;
  padding: var(--spacing-xl) var(--spacing-2xl);
  background: var(--el-bg-color);
}
.catalog-titlebar {
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-lg);
}
.catalog-titlebar :deep(.el-button) {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-sm);
}
h1 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-2xl);
  font-weight: var(--font-semibold);
}
p {
  margin: 5px 0 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.catalog-toolbar {
  display: flex;
  min-height: 54px;
  align-items: center;
  gap: var(--spacing-md);
  margin-top: var(--spacing-lg);
  padding: 9px var(--spacing-md);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
}
.catalog-toolbar :deep(.el-input) {
  width: 260px;
}
.resource-count {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.resource-table {
  overflow: hidden;
  margin-top: var(--spacing-lg);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
}
.resource-table-head,
.resource-table-row {
  display: grid;
  grid-template-columns: minmax(250px, 1.7fr) minmax(150px, 1fr) 88px 100px 170px 20px;
  width: 100%;
  align-items: center;
  column-gap: var(--spacing-md);
  text-align: left;
}
.resource-table-head {
  min-height: 40px;
  padding: 0 var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color-dark);
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.resource-table-row {
  min-height: 62px;
  padding: 8px var(--spacing-md);
  border: 0;
  border-bottom: 1px solid var(--el-border-color-light);
  color: var(--el-text-color-regular);
  background: var(--el-bg-color);
  cursor: pointer;
  font-size: var(--text-sm);
  transition: background-color var(--transition-fast);
}
.resource-table-row:last-child {
  border-bottom: 0;
}
.resource-table-row:hover {
  background: var(--el-fill-color-light);
}
.resource-name {
  display: flex;
  min-width: 0;
  align-items: center;
}
.resource-name > span:last-child {
  min-width: 0;
}
.resource-name strong,
.resource-name small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.resource-name strong {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}
.resource-name small {
  margin-top: 2px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.status-pill {
  display: inline-flex;
  padding: 2px 7px;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  line-height: 16px;
}
.status-pill.success {
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}
.status-pill.warning {
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}
.status-pill.info {
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
}
.row-chevron {
  color: var(--el-text-color-tertiary);
}
@container ontology-manager (max-width: 900px) {
  .asset-catalog {
    padding: var(--spacing-md);
  }
  h1 {
    font-size: var(--text-xl);
  }
  .resource-table-head,
  .resource-table-row {
    grid-template-columns: minmax(180px, 1fr) 100px 20px;
  }
  .resource-table-head span:nth-child(2),
  .resource-table-head span:nth-child(3),
  .resource-table-head span:nth-child(5),
  .resource-table-row > span:nth-child(2),
  .resource-table-row > span:nth-child(3),
  .resource-table-row > span:nth-child(5) {
    display: none;
  }
}
@container ontology-manager (max-width: 560px) {
  .catalog-titlebar {
    align-items: flex-start;
    flex-direction: column;
  }
  .catalog-titlebar :deep(.el-button),
  .catalog-toolbar :deep(.el-input) {
    width: 100%;
  }
  .catalog-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
