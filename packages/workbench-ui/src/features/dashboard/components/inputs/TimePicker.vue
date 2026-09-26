<template>
  <el-date-picker
    v-model="model"
    type="datetime"
    format="YYYY-MM-DD"
    value-format="YYYY-MM-DD"
    :show-footer="false"
    size="small"
    style="width: 100%"
  />
</template>

<script setup>
import { useI18n } from "vue-i18n";

useI18n();

defineProps({
  cond: { type: Object, required: true },
});

const model = defineModel({ type: String });
</script>
