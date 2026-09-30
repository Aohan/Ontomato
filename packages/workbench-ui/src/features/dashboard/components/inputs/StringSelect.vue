<template>
  <el-select
    v-model="model"
    filterable
    remote
    clearable
    size="small"
    :loading="uiState.loading"
    :remote-method="(q) => emit('remote-query', q)"
    :placeholder="t('common.enterKeyword')"
    style="width: 100%"
    @visible-change="(v) => emit('remote-visible', v)"
  >
    <el-option v-for="item in options" :key="item" :label="item" :value="item" />
  </el-select>
</template>

<script setup>
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps({
  options: { type: Array, default: () => [] },
  uiState: { type: Object, required: true },
  cond: { type: Object, required: true },
});

const emit = defineEmits(["remote-query", "remote-visible"]);

const model = defineModel({ type: String, default: "" });
</script>
