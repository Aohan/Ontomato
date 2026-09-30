<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import SkillManager from "./SkillManager.vue";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const activeCategory = computed({
  get: () => {
    const tab = route.query.tab || route.query.category;
    if (tab === "visualization") return tab;
    return "analysis";
  },
  set: (tab: string) => {
    const query: Record<string, string> = Object.fromEntries(
      Object.entries(route.query).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value]] : []
      )
    );
    query.tab = tab;
    delete query.category;
    router.replace({ query });
  },
});
</script>

<template>
  <div class="skill-library">
    <el-tabs v-model="activeCategory" class="library-tabs">
      <el-tab-pane :label="t('admin.analysisSkills')" name="analysis">
        <SkillManager v-if="activeCategory === 'analysis'" category="analysis" />
      </el-tab-pane>
      <el-tab-pane :label="t('admin.visualizationSkills')" name="visualization">
        <SkillManager v-if="activeCategory === 'visualization'" category="visualization" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.skill-library,
.library-tabs,
.library-tabs :deep(.el-tabs__content),
.library-tabs :deep(.el-tab-pane) {
  height: 100%;
  min-height: 0;
}

.skill-library {
  display: flex;
  flex-direction: column;
}

.library-tabs :deep(.el-tabs__content) {
  overflow: visible;
}
</style>
