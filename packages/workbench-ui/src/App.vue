<script setup lang="ts">
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { workbenchLanguage, type SupportedLocale } from "./i18n";

const { locale } = useI18n();
const language = workbenchLanguage();

const elLocale = computed(() => language.elementLocale(locale.value));

watch(
  locale,
  (val) => {
    const nextLocale = language.supported.includes(val as SupportedLocale)
      ? (val as SupportedLocale)
      : language.defaultLocale;
    if (nextLocale !== val) {
      locale.value = nextLocale;
      return;
    }
    language.save?.(nextLocale);
    document.documentElement.lang = nextLocale;
  },
  { immediate: true }
);
</script>

<template>
  <el-config-provider :locale="elLocale">
    <router-view />
  </el-config-provider>
</template>
