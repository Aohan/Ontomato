<script setup lang="ts">
import { computed } from "vue";
import { ElButton, ElDialog, useLocale } from "element-plus";
import { TriangleAlert } from "lucide-vue-next";
import { useManagerFeedback } from "./feedback";

// 原 ElMessageBox.confirm 的本实例版本：渲染在工作区内，随工作区卸载而消失。
const { state } = useManagerFeedback();
const { t } = useLocale();
const visible = computed({
  get: () => state.pending !== null,
  set: (open: boolean) => {
    if (!open) state.pending?.settle(false);
  },
});
</script>

<template>
  <el-dialog
    v-model="visible"
    :lock-scroll="false"
    :title="state.pending?.title"
    width="420px"
    class="manager-confirm"
  >
    <p class="manager-confirm__message">
      <TriangleAlert :size="20" />
      <span>{{ state.pending?.message }}</span>
    </p>
    <template #footer>
      <el-button @click="state.pending?.settle(false)">{{ t("el.messagebox.cancel") }}</el-button>
      <el-button type="primary" @click="state.pending?.settle(true)">
        {{ t("el.messagebox.confirm") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.manager-confirm__message {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  margin: 0;
  color: var(--el-text-color-regular);
}

.manager-confirm__message svg {
  flex-shrink: 0;
  color: var(--el-color-warning);
}
</style>
