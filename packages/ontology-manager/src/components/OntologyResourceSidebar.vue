<script setup lang="ts">
import {
  BookOpen,
  Boxes,
  ChartColumn,
  Clock3,
  MousePointerClick,
  Network,
  Link2,
  SquareFunction,
  Tags,
  Table2,
  Workflow,
} from "lucide-vue-next";
import { useSharedText } from "../context";
import type { AssetTab, ModelResource, OntologyResourceCounts, Workspace } from "../workspace";

const { t } = useSharedText();

defineProps<{
  activeWorkspace: Workspace;
  activeAssetTab: AssetTab;
  activeModelResource: ModelResource;
  counts: OntologyResourceCounts;
}>();

defineEmits<{
  workspace: [workspace: Workspace];
  modelResource: [resource: ModelResource];
  asset: [asset: AssetTab];
  visualModeling: [];
  playground: [];
  knowledge: [];
}>();
</script>

<template>
  <aside class="resource-sidebar">
    <nav class="resource-nav" :aria-label="t('nav.ontologyManager')">
      <section class="nav-group">
        <p class="nav-heading">{{ t("nav.ontologyBrowse") }}</p>
        <button
          :class="['nav-item', { active: activeWorkspace === 'playground' }]"
          :title="t('nav.ontologyGraph')"
          @click="$emit('playground')"
        >
          <Network :size="16" />
          <span>{{ t("nav.ontologyGraph") }}</span>
        </button>
      </section>

      <section class="nav-group">
        <p class="nav-heading">{{ t("nav.ontologyResources") }}</p>
        <button
          :class="[
            'nav-item',
            { active: activeWorkspace === 'model' && activeModelResource === 'objects' },
          ]"
          @click="$emit('modelResource', 'objects')"
        >
          <Boxes :size="16" />
          <span>{{ t("nav.objectTypes") }}</span>
          <small v-if="counts.objects !== null">{{ counts.objects }}</small>
        </button>
        <button
          :class="[
            'nav-item',
            { active: activeWorkspace === 'model' && activeModelResource === 'attributes' },
          ]"
          @click="$emit('modelResource', 'attributes')"
        >
          <Tags :size="16" />
          <span>{{ t("nav.ontologyAttributes") }}</span>
          <small v-if="counts.attributes !== null">{{ counts.attributes }}</small>
        </button>
        <button
          :class="[
            'nav-item',
            { active: activeWorkspace === 'model' && activeModelResource === 'relations' },
          ]"
          @click="$emit('modelResource', 'relations')"
        >
          <Link2 :size="16" />
          <span>{{ t("nav.relationTypes") }}</span>
          <small v-if="counts.relations !== null">{{ counts.relations }}</small>
        </button>
        <button
          :class="['nav-item', { active: activeWorkspace === 'visual-modeling' }]"
          @click="$emit('visualModeling')"
        >
          <Workflow :size="16" />
          <span>{{ t("nav.visualModeling") }}</span>
        </button>
        <button
          :class="['nav-item', { active: activeWorkspace === 'browser' }]"
          @click="$emit('workspace', 'browser')"
        >
          <Table2 :size="16" />
          <span>{{ t("nav.dataBrowser") }}</span>
        </button>
      </section>

      <section class="nav-group">
        <p class="nav-heading">{{ t("nav.intelligenceAssets") }}</p>
        <button
          :class="[
            'nav-item',
            { active: activeWorkspace === 'assets' && activeAssetTab === 'actions' },
          ]"
          @click="$emit('asset', 'actions')"
        >
          <MousePointerClick :size="16" />
          <span>{{ t("nav.actionManagement") }}</span>
          <small v-if="counts.actions !== null">{{ counts.actions }}</small>
        </button>
        <button
          :class="[
            'nav-item',
            { active: activeWorkspace === 'assets' && activeAssetTab === 'metrics' },
          ]"
          @click="$emit('asset', 'metrics')"
        >
          <ChartColumn :size="16" />
          <span>{{ t("nav.metrics") }}</span>
          <small v-if="counts.metrics !== null">{{ counts.metrics }}</small>
        </button>
        <button
          :class="[
            'nav-item',
            { active: activeWorkspace === 'assets' && activeAssetTab === 'functions' },
          ]"
          @click="$emit('asset', 'functions')"
        >
          <SquareFunction :size="16" />
          <span>{{ t("nav.functionDefinitions") }}</span>
          <small v-if="counts.functions !== null">{{ counts.functions }}</small>
        </button>
        <button
          :class="[
            'nav-item',
            { active: activeWorkspace === 'assets' && activeAssetTab === 'tasks' },
          ]"
          @click="$emit('asset', 'tasks')"
        >
          <Clock3 :size="16" />
          <span>{{ t("nav.scheduledWriteTasks") }}</span>
          <small v-if="counts.tasks !== null">{{ counts.tasks }}</small>
        </button>
      </section>

      <section class="nav-group">
        <button
          :class="['nav-item', { active: activeWorkspace === 'knowledge' }]"
          @click="$emit('knowledge')"
        >
          <BookOpen :size="16" />
          <span>{{ t("nav.businessKnowledge") }}</span>
        </button>
      </section>
    </nav>
  </aside>
</template>

<style scoped>
.resource-sidebar {
  display: flex;
  width: 248px;
  min-height: 0;
  flex: 0 0 248px;
  flex-direction: column;
  border-right: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.resource-nav {
  flex: 1;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: var(--spacing-md) var(--spacing-sm);
}
.nav-group + .nav-group {
  margin-top: var(--spacing-lg);
  padding-top: var(--spacing-lg);
  border-top: 1px solid var(--el-border-color-light);
}
.nav-heading {
  margin: 0 var(--spacing-sm) var(--spacing-xs);
  color: var(--el-text-color-tertiary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.nav-item {
  display: flex;
  width: 100%;
  min-height: 36px;
  align-items: center;
  gap: var(--spacing-sm);
  margin: 2px 0;
  padding: 7px var(--spacing-sm);
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--el-text-color-regular);
  background: transparent;
  cursor: pointer;
  font-size: var(--text-sm);
  text-align: left;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}
.nav-item:hover {
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-light);
}
.nav-item.active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  font-weight: var(--font-medium);
}
.nav-item span {
  min-width: 0;
  flex: 1;
}
.nav-item small {
  min-width: 20px;
  padding: 1px 5px;
  border-radius: var(--radius-full);
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  font-size: var(--text-xs);
  line-height: 16px;
  text-align: center;
}
.nav-item.active small {
  color: var(--el-color-primary);
  background: var(--el-bg-color);
}
@container ontology-manager (max-width: 900px) {
  .resource-sidebar {
    width: 58px;
    flex-basis: 58px;
  }
  .nav-heading,
  .nav-item span,
  .nav-item small {
    display: none;
  }
  .resource-nav {
    padding: var(--spacing-sm) 6px;
  }
  .nav-group + .nav-group {
    margin-top: var(--spacing-sm);
    padding-top: var(--spacing-sm);
  }
  .nav-item {
    justify-content: center;
    padding: var(--spacing-sm) 0;
  }
}
</style>
