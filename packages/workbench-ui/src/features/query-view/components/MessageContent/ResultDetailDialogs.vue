<script setup lang="ts">
/**
 * The single dialog for result details: DSL view, post-calculation program, and field lineage.
 *
 * Dataset details and technical details without a dataset share it; the caller only submits one
 * view request, and closing is reported by the dialog itself rather than each caller maintaining
 * its own dialog.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { DslViewer } from "../../../dashboard";
import type { ResultDetailRequest } from "./types";

const props = defineProps<{ request: ResultDetailRequest | null }>();

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();

const visible = computed({
  get: () => !!props.request,
  set: (value: boolean) => {
    if (!value) emit("close");
  },
});
</script>

<template>
  <el-dialog
    v-if="request && request.kind === 'dsl'"
    v-model="visible"
    :title="`DSL - ${request.title}`"
    width="700px"
    top="5vh"
    destroy-on-close
    class="dsl-dialog"
  >
    <DslViewer :value="request.dsl" />
  </el-dialog>
  <el-dialog
    v-else-if="request && request.kind === 'code'"
    v-model="visible"
    :title="`${t('analysis.code')} - ${request.title}`"
    width="700px"
    top="5vh"
    destroy-on-close
    class="code-dialog"
  >
    <pre class="code-pre"><code>{{ request.code }}</code></pre>
  </el-dialog>
  <el-dialog
    v-else-if="request && request.kind === 'lineage'"
    v-model="visible"
    :title="`${t('common.lineage')} - ${request.title}`"
    width="800px"
    top="5vh"
    destroy-on-close
    class="lineage-dialog"
  >
    <el-table :data="request.outKeyRefs || []" border stripe size="small" max-height="64vh">
      <el-table-column prop="key" label="Key" width="200" />
      <el-table-column prop="attrName" :label="t('common.attrName')" min-width="120" />
      <el-table-column prop="className" :label="t('common.className')" min-width="150" />
      <el-table-column prop="asGroupBy" :label="t('common.asGroupBy')" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="row.asGroupBy ? 'success' : 'info'" size="small">
            {{ row.asGroupBy ? t("common.yes") : t("common.no") }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="statCal" :label="t('common.statCal')" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="row.statCal ? 'success' : 'info'" size="small">
            {{ row.statCal ? t("common.yes") : t("common.no") }}
          </el-tag>
        </template>
      </el-table-column>
    </el-table>
  </el-dialog>
</template>

<style scoped>
.code-pre {
  margin: 0;
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  max-height: 64vh;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre;
}
.code-pre code {
  font-family: var(--font-mono);
}
</style>
