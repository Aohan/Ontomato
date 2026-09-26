<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { ElMessage } from "element-plus";
import { RefreshCw, Search } from "lucide-vue-next";
import { adminApi } from "../../api";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  operation: string;
  bussiness: string;
  description: string;
  timestamp: number;
}

const loading = ref(false);
const logList = ref<AuditLog[]>([]);

const pageNum = ref(1);
const pageSize = ref(20);
const total = ref(0);

const filterForm = reactive({
  bussiness: "",
  operation: "",
});

const businessTypes = [
  { label: t("admin.knowledgeBase"), value: "BKNOWLEDGE" },
  { label: t("admin.glossary"), value: "BTERM" },
  { label: t("admin.exampleBase"), value: "BEXAMPLE" },
  { label: "Schema", value: "SCHEMA" },
  { label: t("admin.analysisMgmt"), value: "ANALYSIS" },
];

const operationTypes = [
  { label: t("common.add"), value: "ADD" },
  { label: t("common.modify"), value: "UPD" },
  { label: t("common.delete"), value: "DEL" },
];

async function loadLogs() {
  loading.value = true;
  try {
    const params: Record<string, any> = {
      pageNum: pageNum.value,
      pageSize: pageSize.value,
    };
    if (filterForm.bussiness) {
      params.bussiness = filterForm.bussiness;
    }
    if (filterForm.operation) {
      params.operation = filterForm.operation;
    }
    const res = await adminApi.queryAuditLogs(params);
    logList.value = res.data || [];
    total.value = res.totalRows || 0;
  } catch (e: any) {
    ElMessage.error(e.message || t("audit.loadFailed"));
    logList.value = [];
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  pageNum.value = 1;
  loadLogs();
}

function handlePageChange(page: number) {
  pageNum.value = page;
  loadLogs();
}

onMounted(() => {
  loadLogs();
});
</script>

<template>
  <div class="audit-log-manager">
    <div class="toolbar">
      <el-select
        v-model="filterForm.bussiness"
        :placeholder="t('admin.bizType')"
        clearable
        style="width: 150px"
      >
        <el-option
          v-for="item in businessTypes"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      <el-select
        v-model="filterForm.operation"
        :placeholder="t('admin.operationType')"
        clearable
        style="width: 120px"
      >
        <el-option
          v-for="op in operationTypes"
          :key="op.value"
          :label="op.label"
          :value="op.value"
        />
      </el-select>
      <el-button type="primary" :icon="Search" @click="handleSearch">
        {{ t("common.query") }}
      </el-button>
      <el-button :icon="RefreshCw" @click="loadLogs">{{ t("common.refresh") }}</el-button>
    </div>

    <el-table
      v-loading="loading"
      :data="logList"
      border
      stripe
      class="admin-table"
      style="width: 100%"
    >
      <el-table-column :label="t('common.time')" width="180">
        <template #default="{ row }">
          {{ new Date(row.timestamp).toLocaleString() }}
        </template>
      </el-table-column>
      <el-table-column prop="userName" :label="t('common.user')" width="120" />
      <el-table-column prop="bussiness" :label="t('admin.bizType')" width="120">
        <template #default="{ row }">
          <el-tag v-if="row.bussiness === 'BKNOWLEDGE'">{{ t("admin.knowledgeBase") }}</el-tag>
          <el-tag v-else-if="row.bussiness === 'BTERM'">{{ t("admin.glossary") }}</el-tag>
          <el-tag v-else-if="row.bussiness === 'BEXAMPLE'">{{ t("admin.exampleBase") }}</el-tag>
          <el-tag v-else-if="row.bussiness === 'SCHEMA'">Schema</el-tag>
          <el-tag v-else-if="row.bussiness === 'ANALYSIS'">{{ t("admin.analysisMgmt") }}</el-tag>
          <el-tag v-else>{{ row.bussiness }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="operation" :label="t('admin.operationType')" width="100">
        <template #default="{ row }">
          <el-tag v-if="row.operation === 'ADD'" type="primary">{{ t("common.add") }}</el-tag>
          <el-tag v-else-if="row.operation === 'UPD'" type="warning">
            {{ t("common.modify") }}
          </el-tag>
          <el-tag v-else-if="row.operation === 'DEL'" type="danger">
            {{ t("common.delete") }}
          </el-tag>
          <el-tag v-else>{{ row.operation }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column
        prop="description"
        :label="t('common.detail')"
        min-width="300"
        show-overflow-tooltip
      />
    </el-table>

    <div class="pagination">
      <el-pagination
        background
        layout="prev, pager, next, jumper, ->, total"
        :total="total"
        :page-size="pageSize"
        :current-page="pageNum"
        @current-change="handlePageChange"
      />
    </div>
  </div>
</template>

<style scoped>
.audit-log-manager {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
}

.pagination {
  margin-top: var(--spacing-lg);
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 1024px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar .el-input,
  .toolbar .el-select {
    width: 100%;
  }
}

@media (max-width: 768px) {
  .operation-cell .el-button + .el-button {
    margin-left: 0;
  }
}
</style>
