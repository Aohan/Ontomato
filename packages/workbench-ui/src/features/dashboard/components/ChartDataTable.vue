<template>
  <div class="ai-chart-data-table">
    <template v-if="tabular && tabular.headers.length">
      <table>
        <thead>
          <tr>
            <th v-for="h in tabular.headers" :key="h">{{ h }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIdx) in tabular.rows.slice(0, maxRows)" :key="rowIdx">
            <td v-for="(h, colIdx) in tabular.headers" :key="h + '-' + colIdx">
              {{ formatCellValue(Array.isArray(row) ? row[colIdx] : "") }}
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <div v-else class="ai-chart-data-empty">{{ t("dashboard.noDataToDisplay") }}</div>
  </div>
</template>

<script setup>
import { formatCellValue } from "./utils/chartTabular";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps({
  tabular: { type: Object, default: null },
  maxRows: { type: Number, default: 500 },
});
</script>

<style scoped>
.ai-chart-data-table {
  flex: 1;
  overflow: auto;
}

table {
  width: max-content;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: auto;
  font-size: 12px;
  color: var(--el-text-color-primary);
}

th,
td {
  min-width: 120px;
  border-right: 1px solid var(--el-border-color-lighter);
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding: 6px 8px;
  vertical-align: top;
  word-break: break-word;
  background: var(--el-bg-color);
}

tr > :first-child {
  border-left: 1px solid var(--el-border-color-lighter);
}

thead tr:first-child th {
  border-top: 1px solid var(--el-border-color-lighter);
}

thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--el-fill-color-light);
  box-shadow: 0 1px 0 var(--el-border-color);
  white-space: nowrap;
}

.ai-chart-data-empty {
  padding: 8px 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
