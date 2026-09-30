<script setup lang="ts">
import { Bookmark, BookmarkCheck } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

defineProps<{
  kept?: boolean;
  loading?: boolean;
}>();

defineEmits<{
  toggle: [];
}>();

const { t } = useI18n();
</script>

<template>
  <el-button
    size="small"
    :icon="kept ? BookmarkCheck : Bookmark"
    :loading="loading"
    @click="$emit('toggle')"
  >
    {{ kept ? t("diagnosis.unkeepArtifact") : t("diagnosis.keepArtifact") }}
  </el-button>
</template>
