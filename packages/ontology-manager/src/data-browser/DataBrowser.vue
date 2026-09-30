<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import {
  ElButton,
  ElCheckbox,
  ElDrawer,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElInput,
  ElOption,
  ElPagination,
  ElRadio,
  ElRadioGroup,
  ElSelect,
  ElTable,
  ElTableColumn,
  ElTag,
  vLoading,
} from "element-plus";
import { useManagerFeedback } from "../feedback";
import { Filter, Download, Plus, Trash2, Search } from "lucide-vue-next";
import { useManagerClient, useSharedText } from "../context";

const { t } = useSharedText();
const { message } = useManagerFeedback();
const { getMetas, loadObjectData } = useManagerClient();
const props = defineProps<{ initialClass?: string }>();

interface ClassDef {
  className: string;
  showName: string;
  classDesc: string;
  attrs?: AttrDef[];
}

interface AttrDef {
  name: string;
  showName: string;
  type: string;
}

interface DataItem {
  [key: string]: any;
}

interface FilterCondition {
  field: string;
  operator: string;
  value: string;
}

const classList = ref<ClassDef[]>([]);
const selectedClass = ref("");
const dataList = ref<DataItem[]>([]);
const searchQuery = ref("");
const pageNum = ref(1);
const pageSize = ref(20);
const total = ref(0);
const loading = ref(false);

const currentClassAttrs = computed(() => {
  const cls = classList.value.find((c) => c.className === selectedClass.value);
  return cls?.attrs || [];
});

const filterDrawerVisible = ref(false);
const columnVisibility = ref<Record<string, boolean>>({});
const pendingColumnVisibility = ref<Record<string, boolean>>({});
const filterConditions = ref<FilterCondition[]>([]);
const appliedFilterConditions = ref<FilterCondition[]>([]);
const sortField = ref("");
const sortOrder = ref("");
const appliedSortField = ref("");
const appliedSortOrder = ref("");

const operators = [
  { label: t("dataBrowser.eq"), value: "eq" },
  { label: t("dataBrowser.ne"), value: "ne" },
  { label: t("dataBrowser.contains"), value: "contains" },
  { label: t("dataBrowser.gt"), value: "gt" },
  { label: t("dataBrowser.lt"), value: "lt" },
  { label: t("dataBrowser.gte"), value: "gte" },
  { label: t("dataBrowser.lte"), value: "lte" },
  { label: t("dataBrowser.null"), value: "null" },
  { label: t("dataBrowser.notnull"), value: "notnull" },
];

const availableColumns = computed(() => currentClassAttrs.value);

const filteredData = computed(() => {
  let data = dataList.value;

  appliedFilterConditions.value.forEach((cond) => {
    if (!cond.field || !cond.operator) return;
    data = data.filter((row) => {
      const val = row[cond.field];
      const target = cond.value;
      switch (cond.operator) {
        case "eq":
          return val == target;
        case "ne":
          return val != target;
        case "contains":
          return val != null && String(val).includes(target);
        case "gt":
          return Number(val) > Number(target);
        case "lt":
          return Number(val) < Number(target);
        case "gte":
          return Number(val) >= Number(target);
        case "lte":
          return Number(val) <= Number(target);
        case "null":
          return val === null || val === undefined || val === "";
        case "notnull":
          return val !== null && val !== undefined && val !== "";
        default:
          return true;
      }
    });
  });

  if (appliedSortField.value && appliedSortOrder.value) {
    data = [...data].sort((a, b) => {
      const aVal = a[appliedSortField.value];
      const bVal = b[appliedSortField.value];
      if (aVal === bVal) return 0;
      if (aVal == null) return appliedSortOrder.value === "asc" ? -1 : 1;
      if (bVal == null) return appliedSortOrder.value === "asc" ? 1 : -1;
      const direction = appliedSortOrder.value === "asc" ? 1 : -1;
      return (aVal > bVal ? 1 : -1) * direction;
    });
  }

  return data;
});

const visibleColumns = computed(() => {
  return availableColumns.value
    .filter((column) => columnVisibility.value[column.name] !== false)
    .map((column) => column.name);
});

const visibleAttrs = computed(() =>
  currentClassAttrs.value.filter((attr) => columnVisibility.value[attr.name] !== false)
);

function openFilterDrawer() {
  if (!availableColumns.value.length) {
    message.warning(t("dataBrowser.loadDataFirst"));
    return;
  }
  availableColumns.value.forEach((column) => {
    if (columnVisibility.value[column.name] === undefined) {
      columnVisibility.value[column.name] = true;
    }
  });
  pendingColumnVisibility.value = { ...columnVisibility.value };
  filterConditions.value = appliedFilterConditions.value.map((condition) => ({ ...condition }));
  sortField.value = appliedSortField.value;
  sortOrder.value = appliedSortOrder.value;
  filterDrawerVisible.value = true;
}

function addFilterCondition() {
  filterConditions.value.push({ field: "", operator: "", value: "" });
}

function removeFilterCondition(index: number) {
  filterConditions.value.splice(index, 1);
}

function clearAllFilters() {
  filterConditions.value = [];
  appliedFilterConditions.value = [];
  sortField.value = "";
  sortOrder.value = "";
  appliedSortField.value = "";
  appliedSortOrder.value = "";
}

function applyFilters() {
  appliedFilterConditions.value = filterConditions.value
    .filter(
      (condition) =>
        condition.field &&
        condition.operator &&
        (condition.operator === "null" ||
          condition.operator === "notnull" ||
          condition.value.trim())
    )
    .map((condition) => ({ ...condition }));
  appliedSortField.value = sortField.value;
  appliedSortOrder.value = sortOrder.value;
  columnVisibility.value = { ...pendingColumnVisibility.value };
  filterDrawerVisible.value = false;
  message.success(t("dataBrowser.filterApplied"));
}

async function loadClassList() {
  try {
    const res = await getMetas();
    classList.value = (res.data?.classDef || []).map((cls: any) => ({
      className: cls.className,
      showName: cls.showName || cls.classDesc || cls.className,
      classDesc: cls.classDesc || "",
      attrs: (cls.attrs || []).map((a: any) => ({
        name: a.name,
        showName: a.showName || a.name,
        type: a.type || "",
      })),
    }));
    if (classList.value.length > 0) {
      selectedClass.value =
        classList.value.find((item) => item.className === props.initialClass)?.className ||
        classList.value[0].className;
      loadData();
    }
  } catch (e: any) {
    message.error(e.message || t("dataBrowser.loadClassFailed"));
  }
}

async function loadData() {
  if (!selectedClass.value) return;
  loading.value = true;
  try {
    const { rows, total: totalCount } = await loadObjectData(
      selectedClass.value,
      pageNum.value,
      pageSize.value,
      searchQuery.value.trim() || undefined
    );
    dataList.value = rows;
    total.value = totalCount;
    columnVisibility.value = {};
    pendingColumnVisibility.value = {};
    filterConditions.value = [];
    appliedFilterConditions.value = [];
    sortField.value = "";
    sortOrder.value = "";
    appliedSortField.value = "";
    appliedSortOrder.value = "";
  } catch (e: any) {
    message.error(e.message || t("dataBrowser.loadDataFailed"));
    dataList.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function handleClassChange() {
  pageNum.value = 1;
  searchQuery.value = "";
  loadData();
}

function handleSearch() {
  pageNum.value = 1;
  loadData();
}

function handleSearchClear() {
  searchQuery.value = "";
  pageNum.value = 1;
  loadData();
}

function handlePageChange(p: number) {
  pageNum.value = p;
  loadData();
}

function handleSizeChange(size: number) {
  pageSize.value = size;
  pageNum.value = 1;
  loadData();
}

function exportData() {
  const dataToExport = filteredData.value;
  if (!dataToExport.length) {
    message.warning(t("dataBrowser.noDataExport"));
    return;
  }
  const headers =
    visibleColumns.value.length > 0 ? visibleColumns.value : Object.keys(dataToExport[0]);
  const csv = [
    headers.join(","),
    ...dataToExport.map((row) => headers.map((h) => row[h] ?? "").join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${selectedClass.value}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  message.success(t("dataBrowser.exportSuccess"));
}

function exportExcel() {
  message.info(t("dataBrowser.exportExcelMock"));
}

onMounted(() => {
  loadClassList();
});

watch(
  () => props.initialClass,
  (className) => {
    if (!className || !classList.value.some((item) => item.className === className)) return;
    selectedClass.value = className;
    pageNum.value = 1;
    loadData();
  }
);
</script>

<template>
  <div class="data-browser">
    <div class="toolbar">
      <el-select
        v-model="selectedClass"
        :placeholder="t('common.selectObjectClass')"
        style="width: 300px"
        @change="handleClassChange"
      >
        <el-option
          v-for="cls in classList"
          :key="cls.className"
          :label="cls.showName"
          :value="cls.className"
        />
      </el-select>

      <el-input
        v-model="searchQuery"
        :placeholder="t('dataBrowser.fullTextSearch')"
        :prefix-icon="Search"
        clearable
        style="width: 240px"
        @keyup.enter="handleSearch"
        @clear="handleSearchClear"
      />

      <div class="toolbar-actions">
        <el-button
          class="toolbar-action"
          :icon="Filter"
          :aria-label="t('dataBrowser.advancedFilter')"
          @click="openFilterDrawer"
        >
          <span class="toolbar-action-label">{{ t("dataBrowser.advancedFilter") }}</span>
        </el-button>

        <el-dropdown>
          <el-button class="toolbar-action" :icon="Download" :aria-label="t('common.export')">
            <span class="toolbar-action-label">{{ t("common.export") }}</span>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="exportData">
                {{ t("dataBrowser.exportCsv") }}
              </el-dropdown-item>
              <el-dropdown-item @click="exportExcel">
                {{ t("dataBrowser.exportExcel") }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <el-tag
        v-if="appliedFilterConditions.length > 0"
        type="info"
        closable
        @close="clearAllFilters"
      >
        {{ t("dataBrowser.filterCount", { n: appliedFilterConditions.length }) }}
      </el-tag>
    </div>

    <el-table
      v-loading="loading"
      :data="filteredData"
      border
      stripe
      class="admin-table"
      style="width: 100%"
      max-height="600"
    >
      <el-table-column type="index" width="50" />
      <el-table-column
        v-for="attr in visibleAttrs"
        :key="attr.name"
        :prop="attr.name"
        :label="attr.showName"
        :min-width="Math.max(120, attr.showName.length * 16 + 24)"
        show-overflow-tooltip
      />
    </el-table>

    <div class="pagination">
      <el-pagination
        background
        layout="prev, pager, next, jumper, ->, total, sizes"
        :current-page="pageNum"
        :page-size="pageSize"
        :page-sizes="[20, 50, 100]"
        :total="total"
        @current-change="handlePageChange"
        @size-change="handleSizeChange"
      />
    </div>

    <el-drawer
      v-model="filterDrawerVisible"
      :lock-scroll="false"
      class="data-browser-filter-drawer"
      :title="t('dataBrowser.advancedFilter')"
      size="400px"
    >
      <div class="filter-section">
        <div class="filter-title">{{ t("dataBrowser.columnVisibility") }}</div>
        <div v-for="column in availableColumns" :key="column.name" class="col-checkbox">
          <el-checkbox v-model="pendingColumnVisibility[column.name]">
            {{ column.showName }}
          </el-checkbox>
        </div>
      </div>

      <div class="filter-section">
        <div class="filter-title">{{ t("dataBrowser.filterConditions") }}</div>
        <el-button type="primary" size="small" :icon="Plus" @click="addFilterCondition">
          {{ t("dataBrowser.addCondition") }}
        </el-button>

        <div v-for="(cond, idx) in filterConditions" :key="idx" class="filter-condition">
          <el-select v-model="cond.field" :placeholder="t('common.selectField')">
            <el-option
              v-for="column in availableColumns"
              :key="column.name"
              :label="column.showName"
              :value="column.name"
            />
          </el-select>
          <el-select v-model="cond.operator" :placeholder="t('dataBrowser.operator')">
            <el-option
              v-for="op in operators"
              :key="op.value"
              :label="op.label"
              :value="op.value"
            />
          </el-select>
          <el-input
            v-model="cond.value"
            :placeholder="t('common.value')"
            :disabled="cond.operator === 'null' || cond.operator === 'notnull'"
          />
          <el-button type="danger" :icon="Trash2" link @click="removeFilterCondition(idx)" />
        </div>
      </div>

      <div class="filter-section">
        <div class="filter-title">{{ t("common.sort") }}</div>
        <el-select v-model="sortField" :placeholder="t('dataBrowser.selectSortField')" clearable>
          <el-option
            v-for="column in availableColumns"
            :key="column.name"
            :label="column.showName"
            :value="column.name"
          />
        </el-select>
        <el-radio-group v-model="sortOrder" style="margin-left: 12px">
          <el-radio value="asc">{{ t("dataBrowser.asc") }}</el-radio>
          <el-radio value="desc">{{ t("dataBrowser.desc") }}</el-radio>
        </el-radio-group>
      </div>

      <template #footer>
        <el-button @click="clearAllFilters">{{ t("dataBrowser.clearAll") }}</el-button>
        <el-button type="primary" @click="applyFilters">{{ t("dataBrowser.apply") }}</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.data-browser {
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.data-browser :deep(.el-table) {
  max-height: min(600px, calc(100cqh - 260px)) !important;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
  flex-wrap: wrap;
  /* Not squeezed by the table in the fixed-height column layout; otherwise on narrow screens the action buttons wrap into a second column outside the viewport. */
  flex-shrink: 0;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  flex-shrink: 0;
}

.toolbar-action {
  white-space: nowrap;
}

.pagination {
  margin-top: var(--spacing-lg);
  display: flex;
  justify-content: flex-end;
  min-width: 0;
  overflow-x: auto;
  padding-bottom: 2px;
  /* In short containers the table shrinks so the pagination bar keeps its full, clickable height. */
  flex-shrink: 0;
}

@container ontology-manager (max-width: 1024px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar .el-input,
  .toolbar .el-select {
    width: 100%;
  }

  .toolbar :deep(.el-dropdown),
  .toolbar :deep(.el-dropdown .el-button) {
    width: 100%;
  }

  .toolbar-actions {
    align-self: flex-start;
  }

  .toolbar-actions :deep(.el-dropdown),
  .toolbar-actions :deep(.el-dropdown .el-button) {
    width: auto;
  }

  .toolbar-action-label {
    display: none;
  }
}

@container ontology-manager (max-width: 768px) {
  .operation-cell .el-button + .el-button {
    margin-left: 0;
  }
}

@container ontology-manager (max-width: 640px) {
  .data-browser :deep(.el-table) {
    max-height: calc(100cqh - 330px) !important;
  }

  .filter-condition {
    grid-template-columns: minmax(0, 1fr) 28px;
  }

  .filter-condition .el-select:nth-child(2),
  .filter-condition .el-input {
    grid-column: 1 / -1;
  }

  .filter-condition .el-button {
    grid-column: 2;
    grid-row: 1;
  }

  .pagination {
    justify-content: flex-start;
  }
}

.filter-section {
  margin-bottom: 20px;
}

.filter-title {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: var(--spacing-md);
  color: var(--el-text-color-regular);
}

.filter-condition {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 96px minmax(0, 1fr) 28px;
  align-items: center;
  gap: 8px;
  margin-top: var(--spacing-md);
}

.filter-condition .el-select,
.filter-condition .el-input {
  min-width: 0;
  width: 100%;
}

.admin-table :deep(th.el-table__cell .cell) {
  white-space: nowrap;
  overflow: visible;
  text-overflow: clip;
}

/* The value is supplied by the host presentation (open source: square corners). */
:global(.ontology-manager .el-drawer.data-browser-filter-drawer) {
  border-radius: var(--manager-filter-drawer-radius) !important;
}
</style>
