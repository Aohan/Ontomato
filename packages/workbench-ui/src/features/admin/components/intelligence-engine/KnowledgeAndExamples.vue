<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import KnowledgeManager from "./KnowledgeManager.vue";
import ExamplesManager from "./ExamplesManager.vue";
import type { KnowledgeManagerProps } from "./knowledge-manager";

defineProps<{
  knowledgeManager: KnowledgeManagerProps;
}>();

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const activeSection = computed({
  get: () => (route.query.section === "examples" ? "examples" : "knowledge"),
  set: (section: string) => {
    router.replace({ query: { ...route.query, section } });
  },
});
</script>

<template>
  <div class="knowledge-and-examples">
    <el-tabs v-model="activeSection" class="knowledge-tabs">
      <el-tab-pane :label="t('nav.businessKnowledge')" name="knowledge">
        <KnowledgeManager v-if="activeSection === 'knowledge'" v-bind="knowledgeManager" />
      </el-tab-pane>
      <el-tab-pane :label="t('nav.queryExamples')" name="examples">
        <ExamplesManager v-if="activeSection === 'examples'" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.knowledge-and-examples,
.knowledge-tabs,
.knowledge-tabs :deep(.el-tabs__content),
.knowledge-tabs :deep(.el-tab-pane) {
  height: 100%;
  min-height: 0;
}

.knowledge-and-examples {
  display: flex;
  flex-direction: column;
}

.knowledge-tabs :deep(.el-tabs__content) {
  overflow: visible;
}
</style>
