<script setup lang="ts">
import type {
  KnowledgeTreeNode,
  KnowledgeMarkdownFile,
} from "@ontomato/contracts/diagnosis";
import type { ComponentPublicInstance } from "vue";
import { computed, onMounted, ref, watch } from "vue";

import { ElMessage } from "element-plus";
import { FileText, Folder, RefreshCw } from "lucide-vue-next";
import { diagnosisApi } from "../../api";
import { formatRelativeTime } from "../../../../utils/relative-time";
import { renderAgentMarkdown } from "../../../../utils/agent-markdown";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

type TreeInstance = ComponentPublicInstance & {
  // eslint-disable-next-line no-unused-vars
  filter: (value: string) => void;
  // eslint-disable-next-line no-unused-vars
  setCurrentKey: (key: string) => void;
};

const treeRef = ref<TreeInstance | null>(null);
const treeData = ref<KnowledgeTreeNode[]>([]);
const selectedFile = ref<KnowledgeMarkdownFile | null>(null);
const selectedPath = ref("");
const loadingTree = ref(false);
const loadingContent = ref(false);
const filterText = ref("");

const treeProps = {
  children: "children",
  label: "name",
};

const renderedContent = computed(() =>
  selectedFile.value ? renderAgentMarkdown(selectedFile.value.content) : ""
);

function contentPathForNode(node: KnowledgeTreeNode): string | null {
  if (node.type === "file") return node.path;
  return node.indexPath || null;
}

function filterNode(value: string, data: KnowledgeTreeNode): boolean {
  if (!value) return true;
  const kw = value.toLowerCase();
  return data.name.toLowerCase().includes(kw) || data.path.toLowerCase().includes(kw);
}

async function loadContent(path: string) {
  loadingContent.value = true;
  try {
    selectedFile.value = await diagnosisApi.getKnowledgeContent(path);
    selectedPath.value = selectedFile.value.path;
    treeRef.value?.setCurrentKey(selectedFile.value.path);
  } catch (e: any) {
    selectedFile.value = null;
    selectedPath.value = "";
    ElMessage.error(`${t("diagnosis.loadKnowledgeFileFailed")}: ${e.message}`);
  } finally {
    loadingContent.value = false;
  }
}

function normalizeKnowledgeHref(href: string): string | null {
  const cleanHref = decodeURIComponent(href.split("#")[0] || "")
    .replace(/\\/g, "/")
    .trim();
  if (!cleanHref || cleanHref.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(cleanHref)) {
    return null;
  }
  if (!cleanHref.toLowerCase().endsWith(".md")) return null;

  const currentPath = selectedFile.value?.path || "";
  const currentDir = currentPath.includes("/")
    ? currentPath.slice(0, currentPath.lastIndexOf("/"))
    : "";
  const parts = `${currentDir ? `${currentDir}/` : ""}${cleanHref}`.split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (normalized.length === 0) return null;
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  return normalized.join("/");
}

async function handleMarkdownClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest("a");
  if (!(link instanceof HTMLAnchorElement)) return;

  const path = normalizeKnowledgeHref(link.getAttribute("href") || "");
  if (!path) return;

  event.preventDefault();
  await loadContent(path);
}

async function selectNode(node: KnowledgeTreeNode) {
  const path = contentPathForNode(node);
  if (!path) {
    selectedFile.value = null;
    selectedPath.value = "";
    return;
  }
  await loadContent(path);
}

async function loadTree() {
  loadingTree.value = true;
  try {
    const data = await diagnosisApi.getKnowledgeTree();
    treeData.value = data.tree ? [data.tree] : [];
    await loadContent("index.md");
  } catch (e: any) {
    treeData.value = [];
    selectedFile.value = null;
    selectedPath.value = "";
    ElMessage.error(`${t("diagnosis.loadKnowledgeFailed")}: ${e.message}`);
  } finally {
    loadingTree.value = false;
  }
}

watch(filterText, (value) => {
  treeRef.value?.filter(value);
});

onMounted(loadTree);
</script>

<template>
  <div class="knowledge-page">
    <aside class="tree-panel">
      <div class="panel-header">
        <span class="panel-title">{{ t("diagnosis.knowledgeBase") }}</span>
        <el-tooltip :content="t('common.refresh')">
          <button class="icon-button" type="button" :disabled="loadingTree" @click="loadTree">
            <RefreshCw :size="16" />
          </button>
        </el-tooltip>
      </div>

      <div class="tree-filter">
        <el-input
          v-model="filterText"
          :placeholder="t('observe.searchFileOrDir')"
          size="small"
          clearable
        />
      </div>

      <div v-loading="loadingTree" class="tree-body">
        <el-tree
          ref="treeRef"
          :data="treeData"
          :props="treeProps"
          node-key="path"
          :filter-node-method="filterNode"
          default-expand-all
          highlight-current
          @node-click="selectNode"
        >
          <template #default="{ data }">
            <span class="tree-node">
              <Folder v-if="data.type === 'directory'" :size="14" />
              <FileText v-else :size="14" />
              <span>{{ data.name }}</span>
            </span>
          </template>
        </el-tree>
        <el-empty
          v-if="treeData.length === 0 && !loadingTree"
          :description="t('knowledge.noFiles')"
        />
      </div>
    </aside>

    <main class="content-panel">
      <template v-if="selectedFile">
        <div class="content-header">
          <div class="content-title-wrap">
            <h2 class="content-title">{{ selectedFile.title }}</h2>
            <span class="content-path">{{ selectedPath }}</span>
          </div>
          <span class="content-time">{{ formatRelativeTime(selectedFile.updatedAt) }}</span>
        </div>
        <div v-loading="loadingContent" class="markdown-scroll">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <article class="markdown-body" @click="handleMarkdownClick" v-html="renderedContent" />
        </div>
      </template>
      <div v-else class="content-empty">
        <el-empty :description="t('knowledge.selectMarkdownHint')" />
      </div>
    </main>
  </div>
</template>

<style scoped>
.knowledge-page {
  display: flex;
  height: 100%;
  gap: 10px;
  overflow: hidden;
}

.tree-panel,
.content-panel {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  background: var(--el-bg-color);
  overflow: hidden;
}

.tree-panel {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.panel-header,
.content-header {
  flex-shrink: 0;
  border-bottom: 1px solid var(--el-border-color-light);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.icon-button {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  color: var(--el-text-color-secondary);
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.icon-button:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}

.icon-button:disabled {
  cursor: default;
  opacity: 0.5;
}

.tree-filter {
  padding: 8px 10px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.tree-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px;
}

.tree-node {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
}

.content-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.content-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 18px;
}

.content-title-wrap {
  min-width: 0;
}

.content-title {
  margin: 0;
  font-size: 17px;
  font-weight: 650;
  color: var(--el-text-color-primary);
}

.content-path,
.content-time {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.content-path {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.content-time {
  flex-shrink: 0;
}

.markdown-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 22px 28px;
}

.markdown-body {
  max-width: 980px;
  color: var(--el-text-color-primary);
  line-height: 1.75;
  font-size: 14px;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  line-height: 1.35;
  margin: 20px 0 10px;
}

.markdown-body :deep(h1) {
  font-size: 24px;
}

.markdown-body :deep(h2) {
  font-size: 19px;
}

.markdown-body :deep(h3) {
  font-size: 16px;
}

.markdown-body :deep(p),
.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 10px 0;
}

.markdown-body :deep(pre) {
  overflow: auto;
  padding: 12px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
}

.markdown-body :deep(code) {
  font-family: var(--font-mono);
}

.content-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

@media (max-width: 768px) {
  .knowledge-page {
    flex-direction: column;
  }

  .tree-panel {
    width: 100%;
    max-height: 280px;
  }

  .content-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .markdown-scroll {
    padding: 16px;
  }
}
</style>
