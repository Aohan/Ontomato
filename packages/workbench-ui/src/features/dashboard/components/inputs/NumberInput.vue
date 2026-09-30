<template>
  <el-input-number v-model="model" size="small" :controls="false" style="width: 100%" />
</template>

<script setup>
import { useI18n } from "vue-i18n";

useI18n();

defineProps({
  cond: { type: Object, required: true },
});

const model = defineModel({ type: Number });
</script>
