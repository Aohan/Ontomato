<template>
  <el-select
    v-model="model"
    multiple
    filterable
    allow-create
    default-first-option
    size="small"
    :placeholder="t('dashboard.enterMultipleNumbers')"
    style="width: 100%"
  >
    <el-option v-for="item in model" :key="item" :label="item" :value="item" />
  </el-select>
</template>

<script setup>
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps({
  cond: { type: Object, required: true },
});

const model = defineModel({ type: Array, default: () => [] });
</script>
